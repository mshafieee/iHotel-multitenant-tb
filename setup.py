#!/usr/bin/env python3
"""
iHotel Platform — ThingsBoard Setup Script v3
==============================================
Provisions ESP32 room gateway devices on a ThingsBoard tenant.
Room type is determined by position within each floor:
  Rooms 1–4  → STANDARD
  Rooms 5–6  → SUITE
  Rooms 7–8  → VIP

Default target: Azhar tenant (admin@azhar.com / azhar123)
10 floors × 8 rooms = 80 devices

Usage:
  python3 setup.py
  python3 setup.py --host http://192.168.1.100:8080
  python3 setup.py --user azhar --password azhar123
  python3 setup.py --cleanup          # Remove all gateway-room-* devices
  python3 setup.py --seed-telemetry   # Push initial telemetry after creation
  python3 setup.py --dry-run          # Preview what would be created
  python3 setup.py --status           # Show current state
"""

import requests
import json
import sys
import time
import argparse
import random
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

# ══════════════════════════════════════════════════════════════════════════════
# DEVELOPER CONFIGURATION — Edit these values before running
# ══════════════════════════════════════════════════════════════════════════════

# ThingsBoard connection
TB_HOST = 'http://localhost:8080'
TB_USER = 'admin@azhar.com'
TB_PASS = 'azhar123'

# Hotel layout
FLOORS          = 10   # number of floors
ROOMS_PER_FLOOR = 8    # rooms per floor

# Room type ranges — list of (first_idx, last_idx, type_name)
# room index runs 1..ROOMS_PER_FLOOR; inclusive on both ends
ROOM_TYPE_RANGES = [
    (1, 4, 'STANDARD'),
    (5, 6, 'SUITE'),
    (7, 8, 'VIP'),
]

# Rack rates per night (SAR) — must include every type in ROOM_TYPE_RANGES
RACK_RATES = {
    'STANDARD': 600,
    'SUITE':    1500,
    'VIP':      2500,
}

# AC defaults pushed as shared attributes on device creation
AC_MIN_TEMP               = 16.0
AC_MAX_TEMP               = 30.0
AC_DEFAULT_MODE           = 0    # 0=OFF
AC_DEFAULT_FAN_SPEED      = 3    # 3=AUTO
DOOR_DEFAULT_UNLOCK_DURATION = 5  # seconds

# ThingsBoard device profile name
DEVICE_PROFILE_NAME = 'room_gateway'

# Output files (written next to this script)
TOKEN_FILE = 'gateway_tokens.json'
CSV_FILE   = 'gateway_tokens.csv'

# Provisioning tuning
BATCH_SIZE  = 10
BATCH_PAUSE = 0.3   # seconds between batches
MAX_RETRIES = 3
RETRY_DELAY = 1.0   # seconds (multiplied by attempt number)

# ══════════════════════════════════════════════════════════════════════════════
# END OF CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

TOTAL_ROOMS = FLOORS * ROOMS_PER_FLOOR
ROOM_TYPES  = [t for _, _, t in ROOM_TYPE_RANGES]


def _validate_config():
    covered = set()
    for start, end, _ in ROOM_TYPE_RANGES:
        covered.update(range(start, end + 1))
    expected = set(range(1, ROOMS_PER_FLOOR + 1))
    missing = expected - covered
    if missing:
        raise ValueError(f"ROOM_TYPE_RANGES does not cover room indices: {sorted(missing)}")

_validate_config()


def room_type_for_index(room_idx):
    for start, end, rtype in ROOM_TYPE_RANGES:
        if start <= room_idx <= end:
            return rtype
    return ROOM_TYPES[0]


DEFAULT_SHARED_ATTRS = {
    "defaultUnlockDuration": DOOR_DEFAULT_UNLOCK_DURATION,
    "acDefaultMode":         AC_DEFAULT_MODE,
    "acDefaultFanSpeed":     AC_DEFAULT_FAN_SPEED,
    "acMaxTemp":             AC_MAX_TEMP,
    "acMinTemp":             AC_MIN_TEMP,
    # Relay states (all OFF on provision)
    "relay1": False, "relay2": False, "relay3": False,
    "relay4": False, "relay5": False, "relay6": False,
    "relay7": False, "relay8": False,
    "doorUnlock": False,
}


class ThingsBoardClient:
    """Thin REST client for ThingsBoard tenant admin API."""

    def __init__(self, host, username, password):
        self.host = host.rstrip("/")
        self.username = username
        self.password = password
        self.token = None
        self.token_exp = 0
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    def login(self):
        print(f"\n  Host:     {self.host}")
        print(f"  User:     {self.username}")
        try:
            r = self.session.post(
                f"{self.host}/api/auth/login",
                json={"username": self.username, "password": self.password},
                timeout=10,
            )
            if r.status_code == 200:
                self.token = r.json()["token"]
                self.token_exp = time.time() + 3500
                self.session.headers["X-Authorization"] = f"Bearer {self.token}"
                print("  ✓ Authenticated\n")
                return True
            else:
                print(f"  ✗ Login failed: HTTP {r.status_code}")
                print(f"    Response: {r.text[:200]}")
                return False
        except requests.ConnectionError:
            print(f"  ✗ Cannot connect to {self.host}")
            print("    Is ThingsBoard running?")
            return False
        except requests.Timeout:
            print(f"  ✗ Connection timed out")
            return False

    def _ensure_auth(self):
        if time.time() >= self.token_exp:
            self.login()

    def _retry_request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", 15)
        for attempt in range(MAX_RETRIES):
            try:
                self._ensure_auth()
                r = self.session.request(method, url, **kwargs)
                if r.status_code == 401:
                    self.token_exp = 0
                    self._ensure_auth()
                    r = self.session.request(method, url, **kwargs)
                return r
            except (requests.ConnectionError, requests.Timeout):
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                else:
                    raise

    # ─── Device Profile ───
    def get_or_create_device_profile(self, name="room_gateway"):
        print(f"Setting up device profile '{name}'...")
        r = self._retry_request("GET", f"{self.host}/api/deviceProfiles",
                                params={"pageSize": 100, "page": 0})
        if r.status_code == 200:
            for p in r.json().get("data", []):
                if p["name"] == name:
                    pid = p["id"]["id"]
                    print(f"  ✓ Profile already exists: {pid[:12]}...")
                    return pid

        profile = {
            "name": name,
            "type": "DEFAULT",
            "transportType": "MQTT",
            "description": "iHotel ESP32 Room Gateway",
            "profileData": {
                "configuration": {"type": "DEFAULT"},
                "transportConfiguration": {
                    "type": "MQTT",
                    "deviceTelemetryTopic": "v1/devices/me/telemetry",
                    "deviceAttributesTopic": "v1/devices/me/attributes",
                    "deviceAttributesSubscribeTopic": "v1/devices/me/attributes",
                },
            },
        }
        r = self._retry_request("POST", f"{self.host}/api/deviceProfile", json=profile)
        if r.status_code == 200:
            pid = r.json()["id"]["id"]
            print(f"  ✓ Profile created: {pid[:12]}...")
            return pid
        else:
            print(f"  ✗ Failed to create profile: HTTP {r.status_code} — {r.text[:200]}")
            return None

    # ─── Device CRUD ───
    def get_device_token(self, device_id):
        r = self._retry_request("GET", f"{self.host}/api/device/{device_id}/credentials")
        if r.status_code == 200:
            return r.json().get("credentialsId")
        return None

    def find_device_by_name(self, name):
        r = self._retry_request("GET", f"{self.host}/api/tenant/devices",
                                params={"pageSize": 1, "page": 0, "textSearch": name})
        if r.status_code == 200:
            for d in r.json().get("data", []):
                if d["name"] == name:
                    return d["id"]["id"]
        return None

    def create_device(self, name, profile_id, label=""):
        """Create device or return existing. Returns (device_id, token, is_new)."""
        existing_id = self.find_device_by_name(name)
        if existing_id:
            token = self.get_device_token(existing_id)
            return existing_id, token, False

        device = {
            "name": name,
            "type": "room_gateway",
            "label": label,
            "deviceProfileId": {"id": profile_id, "entityType": "DEVICE_PROFILE"},
        }
        r = self._retry_request("POST", f"{self.host}/api/device", json=device)
        if r.status_code == 200:
            did = r.json()["id"]["id"]
            token = self.get_device_token(did)
            return did, token, True
        return None, None, False

    def delete_device(self, device_id):
        r = self._retry_request("DELETE", f"{self.host}/api/device/{device_id}")
        return r.status_code == 200

    # ─── Attributes & Telemetry ───
    def set_shared_attributes(self, device_id, attrs):
        r = self._retry_request(
            "POST",
            f"{self.host}/api/plugins/telemetry/DEVICE/{device_id}/attributes/SHARED_SCOPE",
            json=attrs,
        )
        return r.status_code == 200

    def push_telemetry(self, device_id, data):
        r = self._retry_request(
            "POST",
            f"{self.host}/api/plugins/telemetry/DEVICE/{device_id}/timeseries/ANY",
            json=data,
        )
        return r.status_code == 200

    # ─── Bulk fetch ───
    def get_all_gateway_devices(self):
        devices = []
        page = 0
        while True:
            r = self._retry_request("GET", f"{self.host}/api/tenant/devices",
                                    params={"pageSize": 100, "page": page,
                                            "sortProperty": "name", "sortOrder": "ASC"})
            if r.status_code != 200:
                break
            data = r.json()
            devices.extend(d for d in data.get("data", []) if d["name"].startswith("gateway-room-"))
            if not data.get("hasNext"):
                break
            page += 1
        return devices


def progress_bar(current, total, prefix="", width=40):
    pct = current / total if total else 0
    filled = int(width * pct)
    bar = "█" * filled + "░" * (width - filled)
    sys.stdout.write(f"\r  {prefix} [{bar}] {current}/{total} ({pct*100:.0f}%)")
    sys.stdout.flush()
    if current == total:
        print()


def generate_initial_telemetry(room_num, floor, room_type):
    """Generate realistic initial telemetry for a room."""
    occupied = random.random() < 0.35
    temp = round(random.uniform(22, 26) if occupied else random.uniform(24, 28), 1)
    return {
        "roomStatus": 1 if occupied else 0,
        "pirMotionStatus": occupied and random.random() < 0.5,
        "doorStatus": False,
        "doorLockBattery": round(random.uniform(75, 100), 1),
        "doorContactsBattery": round(random.uniform(70, 100), 1),
        "co2": round(random.uniform(380, 600) if not occupied else random.uniform(500, 900), 1),
        "temperature": temp,
        "humidity": round(random.uniform(35, 55), 1),
        "airQualityBattery": round(random.uniform(80, 100), 1),
        "elecConsumption": round(random.uniform(0, 20), 2),
        "waterConsumption": round(random.uniform(0, 2), 3),
        "waterMeterBattery": round(random.uniform(75, 100), 1),
        "line1": occupied and random.random() < 0.4,
        "line2": occupied and random.random() < 0.2,
        "line3": False,
        "dimmer1": round(random.uniform(30, 70)) if occupied and random.random() < 0.3 else 0,
        "dimmer2": 0,
        "acTemperatureSet": random.choice([22, 23, 24, 25]),
        "acMode": random.choice([0, 1, 1, 4]) if occupied else 0,
        "fanSpeed": random.choice([0, 1, 2, 3]) if occupied else 3,
        "curtainsPosition": round(random.uniform(0, 100)) if occupied else 0,
        "blindsPosition": round(random.uniform(0, 100)) if occupied else 0,
        "dndService": occupied and random.random() < 0.08,
        "murService": False,
        "sosService": False,
        "pdMode": False,
        "lastCleanedTime": str(int(time.time() * 1000) - random.randint(3600000, 86400000)),
        "lastTelemetryTime": str(int(time.time() * 1000)),
        "firmwareVersion": "2.1.5",
        "gatewayVersion": "1.5.1",
        "deviceStatus": 0,
    }


def build_room_list():
    """Build full room list: 10 floors × 8 rooms, type by position."""
    rooms = []
    for floor in range(1, FLOORS + 1):
        for room_idx in range(1, ROOMS_PER_FLOOR + 1):
            room_num = floor * 100 + room_idx
            rtype = room_type_for_index(room_idx)
            rooms.append({
                "room_num": room_num,
                "floor": floor,
                "room_idx": room_idx,
                "type": rtype,
                "name": f"gateway-room-{room_num}",
                "label": f"Floor {floor} — Room {room_num} ({rtype})",
            })
    return rooms


def run_setup(args, tb, all_rooms):
    profile_id = tb.get_or_create_device_profile(DEVICE_PROFILE_NAME)
    if not profile_id:
        print("\n✗ Cannot proceed without device profile")
        sys.exit(1)

    tokens = {}
    created_count = 0
    existing_count = 0
    failed = []

    print(f"\nProvisioning {TOTAL_ROOMS} devices ({FLOORS} floors × {ROOMS_PER_FLOOR} rooms)...")
    if args.dry_run:
        print("  ⚠ DRY RUN — no devices will be created\n")
        for room in all_rooms[:8]:
            print(f"  Would create: {room['name']:25s}  {room['label']}")
        print(f"  ... ({len(all_rooms)} total)")
        print(f"\n  Room type breakdown per floor:")
        for start, end, rtype in ROOM_TYPE_RANGES:
            count = sum(1 for r in all_rooms if r['type'] == rtype)
            rate = RACK_RATES.get(rtype, 0)
            print(f"    {rtype:10s}: {count:3d} rooms  (SAR {rate}/night)")
        return

    def provision_room(room):
        device_id, token, is_new = tb.create_device(room["name"], profile_id, room["label"])
        if not device_id or not token:
            return room["name"], None, None, False, False

        attrs = {
            **DEFAULT_SHARED_ATTRS,
            "roomNumber": str(room["room_num"]),
            "floor": str(room["floor"]),
            "roomType": room["type"],
        }
        tb.set_shared_attributes(device_id, attrs)
        return room["name"], device_id, token, is_new, True

    done = 0
    for batch_start in range(0, len(all_rooms), BATCH_SIZE):
        batch = all_rooms[batch_start:batch_start + BATCH_SIZE]
        with ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
            futures = {executor.submit(provision_room, room): room for room in batch}
            for future in as_completed(futures):
                room = futures[future]
                try:
                    name, device_id, token, is_new, success = future.result()
                    if success:
                        tokens[name] = {
                            "device_id": device_id,
                            "token": token,
                            "room": str(room["room_num"]),
                            "floor": room["floor"],
                            "type": room["type"],
                        }
                        if is_new:
                            created_count += 1
                        else:
                            existing_count += 1
                    else:
                        failed.append(name)
                except Exception:
                    failed.append(room["name"])

                done += 1
                progress_bar(done, TOTAL_ROOMS, "Provisioning")

        time.sleep(BATCH_PAUSE)

    # ─── Save token files ───
    base = os.path.dirname(os.path.abspath(__file__))
    token_path = os.path.join(base, TOKEN_FILE)
    csv_path   = os.path.join(base, CSV_FILE)

    with open(token_path, "w") as f:
        json.dump(tokens, f, indent=2)
    print(f"\n  ✓ Saved {token_path}  ({len(tokens)} devices)")

    with open(csv_path, "w") as f:
        f.write("name,device_id,token,room,floor,type\n")
        for name in sorted(tokens.keys()):
            d = tokens[name]
            f.write(f"{name},{d['device_id']},{d['token']},{d['room']},{d['floor']},{d['type']}\n")
    print(f"  ✓ Saved {csv_path}")

    # ─── Seed telemetry ───
    if args.seed_telemetry:
        print(f"\nSeeding initial telemetry for {len(tokens)} devices...")
        done = 0
        for name in sorted(tokens.keys()):
            d = tokens[name]
            telemetry = generate_initial_telemetry(int(d["room"]), d["floor"], d["type"])
            tb.push_telemetry(d["device_id"], telemetry)
            done += 1
            if done % 10 == 0 or done == len(tokens):
                progress_bar(done, len(tokens), "Seeding    ")
        print(f"  ✓ Telemetry seeded for {done} devices")

    # ─── Summary ───
    print(f"\n{'═' * 60}")
    print(f"  iHotel — Setup Complete")
    print(f"{'═' * 60}")
    print(f"  New devices created : {created_count}")
    print(f"  Existing (re-used)  : {existing_count}")
    if failed:
        print(f"  Failed              : {len(failed)}")
        for name in failed[:10]:
            print(f"    ✗ {name}")
        if len(failed) > 10:
            print(f"    ... and {len(failed) - 10} more")
    print(f"  Total provisioned   : {len(tokens)}")
    print()
    print(f"  Floor layout (each floor identical):")
    for start, end, rtype in ROOM_TYPE_RANGES:
        count_per_floor = end - start + 1
        rate = RACK_RATES.get(rtype, 0)
        print(f"    Rooms {start}–{end}   {rtype:<10s}× {FLOORS} floors = {count_per_floor * FLOORS:3d} rooms  (SAR {rate}/night)")
    print(f"{'═' * 60}")

    # ─── Verify sample ───
    print("\nVerifying random sample...")
    sample = random.sample(sorted(tokens.keys()), min(5, len(tokens)))
    ok = 0
    for name in sample:
        d = tokens[name]
        actual = tb.get_device_token(d["device_id"])
        if actual == d["token"]:
            print(f"  ✓ {name}: token OK")
            ok += 1
        else:
            print(f"  ✗ {name}: token MISMATCH")
    print(f"\n  Verification: {ok}/{len(sample)} passed")

    if ok == len(sample):
        print("\n  Hotel is ready! Next steps:")
        print(f"     1. Start server:     cd server && npm start")
        print(f"     2. Log in as platform admin and create hotel → discover rooms")
        print(f"     3. Open dashboard:   http://localhost:3000")
    else:
        print("\n  ⚠ Some verifications failed — check ThingsBoard logs")


def run_cleanup(args, tb):
    print("Fetching all gateway-room-* devices...")
    devices = tb.get_all_gateway_devices()
    print(f"  Found {len(devices)} devices")

    if not devices:
        print("  Nothing to clean up")
        return

    if not args.force:
        answer = input(f"\n  Delete {len(devices)} devices? This cannot be undone. [y/N] ")
        if answer.lower() != "y":
            print("  Cancelled")
            return

    done = deleted = 0
    for d in devices:
        if tb.delete_device(d["id"]["id"]):
            deleted += 1
        done += 1
        progress_bar(done, len(devices), "Deleting   ")

    print(f"\n  ✓ Deleted {deleted}/{len(devices)} devices")

    base = os.path.dirname(os.path.abspath(__file__))
    for fname in [TOKEN_FILE, CSV_FILE]:
        path = os.path.join(base, fname)
        if os.path.exists(path):
            os.remove(path)
            print(f"  ✓ Removed {fname}")


def run_status(tb):
    devices = tb.get_all_gateway_devices()
    print(f"  Devices found: {len(devices)}")

    if not devices:
        print("  No gateway devices provisioned yet")
        return

    floors = {}
    for d in devices:
        try:
            room_num = int(d["name"].replace("gateway-room-", ""))
            floor = room_num // 100
            floors[floor] = floors.get(floor, 0) + 1
        except ValueError:
            pass

    print(f"\n  Floor breakdown:")
    for floor in sorted(floors.keys()):
        bar = "█" * floors[floor]
        # Reconstruct type counts for this floor
        types = [room_type_for_index(i) for i in range(1, ROOMS_PER_FLOOR + 1)]
        type_summary = f"STD×{types.count('STANDARD')} STE×{types.count('SUITE')} VIP×{types.count('VIP')}"
        print(f"    F{floor:2d} ({type_summary}): {floors[floor]:2d} {bar}")
    print(f"\n  Total: {len(devices)} / {TOTAL_ROOMS} expected")

    base = os.path.dirname(os.path.abspath(__file__))
    token_path = os.path.join(base, TOKEN_FILE)
    if os.path.exists(token_path):
        with open(token_path) as f:
            tokens = json.load(f)
        print(f"  Token file: {len(tokens)} entries")
        if len(tokens) != len(devices):
            print(f"  ⚠ Mismatch — run setup.py again to reconcile")
    else:
        print(f"  ⚠ No {TOKEN_FILE} — run setup.py to generate")


def main():
    parser = argparse.ArgumentParser(
        description="iHotel — ThingsBoard Device Provisioning",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 setup.py                                  # Standard setup
  python3 setup.py --seed-telemetry                 # Setup + seed data
  python3 setup.py --host http://192.168.1.50:8080  # Custom TB host
  python3 setup.py --user admin@azhar.com --password azhar123  # Custom credentials
  python3 setup.py --cleanup --force                # Remove all devices
  python3 setup.py --status                         # Check current state
  python3 setup.py --dry-run                        # Preview without creating
        """,
    )
    parser.add_argument("--host",     default=TB_HOST,
                        help=f"ThingsBoard URL (default: {TB_HOST})")
    parser.add_argument("--user",     default=TB_USER,
                        help=f"Tenant admin username (default: {TB_USER})")
    parser.add_argument("--password", default=TB_PASS,
                        help="Tenant admin password")
    parser.add_argument("--cleanup",        action="store_true", help="Remove all gateway-room-* devices")
    parser.add_argument("--force",          action="store_true", help="Skip confirmation prompts")
    parser.add_argument("--status",         action="store_true", help="Show current provisioning status")
    parser.add_argument("--seed-telemetry", action="store_true", help="Push initial telemetry after creation")
    parser.add_argument("--dry-run",        action="store_true", help="Preview without making changes")
    args = parser.parse_args()

    print("═" * 60)
    print("  iHotel Platform — ThingsBoard Setup v3")
    print(f"  {TOTAL_ROOMS} rooms · {FLOORS} floors · 8 rooms/floor · ESP32 Gateways")
    print(f"  Layout: Rooms 1-4 STANDARD | 5-6 SUITE | 7-8 VIP")
    print("═" * 60)

    tb = ThingsBoardClient(args.host, args.user, args.password)
    if not tb.login():
        sys.exit(1)

    if args.cleanup:
        run_cleanup(args, tb)
    elif args.status:
        run_status(tb)
    else:
        all_rooms = build_room_list()
        run_setup(args, tb, all_rooms)


if __name__ == "__main__":
    main()
