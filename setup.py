#!/usr/bin/env python3
"""
Hilton Grand Hotel — ThingsBoard Setup Script v2
==================================================
Provisions 300 ESP32 room gateway devices (15 floors × 20 rooms)
on ThingsBoard with device profiles, shared attributes, and
initial telemetry. Outputs gateway_tokens.json for the simulator
and Node.js server.

Prerequisites:
  - ThingsBoard running at localhost:8080
  - Tenant admin account created (default: admin@hiltongrand.com / hilton)

Usage:
  python3 setup.py
  python3 setup.py --host http://192.168.1.100:8080
  python3 setup.py --user tenant@hotel.com --password secret
  python3 setup.py --cleanup          # Remove all gateway-room-* devices
  python3 setup.py --seed-telemetry   # Push initial telemetry after creation
  python3 setup.py --dry-run          # Preview what would be created
"""

import requests
import json
import sys
import time
import argparse
import random
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# ═══ HOTEL CONFIGURATION ═══
FLOORS = 15
ROOMS_PER_FLOOR = 20
TOTAL_ROOMS = FLOORS * ROOMS_PER_FLOOR

ROOM_TYPES = ['STANDARD', 'DELUXE', 'SUITE', 'VIP']
RACK_RATES = {'STANDARD': 600, 'DELUXE': 950, 'SUITE': 1500, 'VIP': 2500}

# Floor → room type index mapping
FLOOR_TYPE = {
    1: 1,   # DELUXE
    2: 0,   # STANDARD
    3: 0,   # STANDARD
    4: 1,   # DELUXE
    5: 2,   # SUITE
    6: 0,   # STANDARD
    7: 1,   # DELUXE
    8: 0,   # STANDARD
    9: 2,   # SUITE
    10: 0,  # STANDARD
    11: 1,  # DELUXE
    12: 0,  # STANDARD
    13: 2,  # SUITE
    14: 3,  # VIP
    15: 3,  # VIP
}

# ═══ INITIAL SHARED ATTRIBUTES (pushed to ESP32 via MQTT) ═══
DEFAULT_SHARED_ATTRS = {
    "defaultUnlockDuration": 5,
    "acDefaultMode": 0,       # OFF
    "acDefaultFanSpeed": 3,   # AUTO
    "acMaxTemp": 30.0,
    "acMinTemp": 16.0,
    # Relay states (all OFF on provision)
    "relay1": False, "relay2": False, "relay3": False,
    "relay4": False, "relay5": False, "relay6": False,
    "relay7": False, "relay8": False,
    "doorUnlock": False,
}

# Retry config
MAX_RETRIES = 3
RETRY_DELAY = 1.0
BATCH_SIZE = 10        # concurrent device creations per batch
BATCH_PAUSE = 0.3      # pause between batches (seconds)


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
                body = r.text[:200]
                print(f"  ✗ Login failed: HTTP {r.status_code}")
                print(f"    Response: {body}")
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
        """Execute request with retry logic."""
        kwargs.setdefault("timeout", 15)
        for attempt in range(MAX_RETRIES):
            try:
                self._ensure_auth()
                r = self.session.request(method, url, **kwargs)
                if r.status_code == 401:
                    # Token expired mid-run
                    self.token_exp = 0
                    self._ensure_auth()
                    r = self.session.request(method, url, **kwargs)
                return r
            except (requests.ConnectionError, requests.Timeout) as e:
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
            "description": "Hilton Grand Hotel ESP32 Room Gateway",
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
        """Search for existing device by exact name."""
        r = self._retry_request("GET", f"{self.host}/api/tenant/devices",
                                params={"pageSize": 1, "page": 0, "textSearch": name})
        if r.status_code == 200:
            for d in r.json().get("data", []):
                if d["name"] == name:
                    return d["id"]["id"]
        return None

    def create_device(self, name, profile_id, label=""):
        """Create device or return existing. Returns (device_id, token, is_new)."""
        # Check existing first
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

    # ─── Bulk Operations ───
    def get_all_gateway_devices(self):
        """Fetch all gateway-room-* devices with pagination."""
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


def generate_initial_telemetry(room_num, floor, room_type_id):
    """Generate realistic initial telemetry for a room."""
    occupied = random.random() < 0.35  # 35% occupancy on setup
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
        "lastCleanedTime": str(int(time.time() * 1000) - random.randint(3600000, 86400000)),
        "lastTelemetryTime": str(int(time.time() * 1000)),
        "firmwareVersion": "2.1.5",
        "gatewayVersion": "1.5.1",
        "deviceStatus": 0,
    }


def run_setup(args):
    """Main setup: create profile + 300 devices + shared attributes."""
    tb = ThingsBoardClient(args.host, args.user, args.password)
    if not tb.login():
        sys.exit(1)

    profile_id = tb.get_or_create_device_profile()
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

    all_rooms = []
    for floor in range(1, FLOORS + 1):
        room_type_id = FLOOR_TYPE[floor]
        type_name = ROOM_TYPES[room_type_id]
        for room_idx in range(1, ROOMS_PER_FLOOR + 1):
            room_num = floor * 100 + room_idx
            all_rooms.append({
                "room_num": room_num,
                "floor": floor,
                "type_id": room_type_id,
                "type_name": type_name,
                "name": f"gateway-room-{room_num}",
                "label": f"Floor {floor} — Room {room_num} ({type_name})",
            })

    if args.dry_run:
        for room in all_rooms[:5]:
            print(f"  Would create: {room['name']}  [{room['label']}]")
        print(f"  ... and {len(all_rooms) - 5} more")
        print(f"\n  Floor distribution:")
        for t in range(4):
            count = sum(1 for v in FLOOR_TYPE.values() if v == t)
            print(f"    {ROOM_TYPES[t]:10s}: {count} floors = {count * ROOMS_PER_FLOOR} rooms")
        return

    def provision_room(room):
        """Provision a single room device (thread-safe)."""
        device_id, token, is_new = tb.create_device(room["name"], profile_id, room["label"])
        if not device_id or not token:
            return room["name"], None, None, False, False

        # Always push shared attributes (idempotent — safe for existing devices too)
        attrs = {
            **DEFAULT_SHARED_ATTRS,
            "roomNumber": str(room["room_num"]),
            "floor": str(room["floor"]),
            "roomType": room["type_id"],
        }
        tb.set_shared_attributes(device_id, attrs)

        return room["name"], device_id, token, is_new, True

    # Process in batches with concurrent execution
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
                            "type": room["type_name"],
                            "type_id": room["type_id"],
                        }
                        if is_new:
                            created_count += 1
                        else:
                            existing_count += 1
                    else:
                        failed.append(name)
                except Exception as e:
                    failed.append(room["name"])

                done += 1
                progress_bar(done, TOTAL_ROOMS, "Provisioning")

        time.sleep(BATCH_PAUSE)

    # ─── Save tokens ───
    token_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gateway_tokens.json")
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gateway_tokens.csv")

    with open(token_path, "w") as f:
        json.dump(tokens, f, indent=2)
    print(f"\n  ✓ Saved {token_path} ({len(tokens)} devices)")

    with open(csv_path, "w") as f:
        f.write("name,device_id,token,room,floor,type\n")
        for name in sorted(tokens.keys()):
            d = tokens[name]
            f.write(f"{name},{d['device_id']},{d['token']},{d['room']},{d['floor']},{d['type']}\n")
    print(f"  ✓ Saved {csv_path}")

    # ─── Seed telemetry if requested ───
    if args.seed_telemetry:
        print(f"\nSeeding initial telemetry for {len(tokens)} devices...")
        done = 0
        for name in sorted(tokens.keys()):
            d = tokens[name]
            telemetry = generate_initial_telemetry(
                int(d["room"]), d["floor"], d["type_id"]
            )
            tb.push_telemetry(d["device_id"], telemetry)
            done += 1
            if done % 20 == 0 or done == len(tokens):
                progress_bar(done, len(tokens), "Seeding    ")
        print(f"  ✓ Telemetry seeded for {done} devices")

    # ─── Summary ───
    print(f"\n{'═' * 55}")
    print(f"  HILTON GRAND HOTEL — Setup Complete")
    print(f"{'═' * 55}")
    print(f"  New devices created:  {created_count}")
    print(f"  Existing (re-used):   {existing_count}")
    if failed:
        print(f"  Failed:               {len(failed)}")
        for name in failed[:10]:
            print(f"    ✗ {name}")
        if len(failed) > 10:
            print(f"    ... and {len(failed) - 10} more")
    print(f"  Total provisioned:    {len(tokens)}")
    print()
    for t in range(4):
        count = sum(1 for v in FLOOR_TYPE.values() if v == t)
        rate = RACK_RATES[ROOM_TYPES[t]]
        print(f"    {ROOM_TYPES[t]:10s}: {count:2d} floors × {ROOMS_PER_FLOOR} rooms = {count * ROOMS_PER_FLOOR:3d} rooms  (SAR {rate}/night)")
    print(f"{'═' * 55}")

    # ─── Verify sample ───
    print("\nVerifying random sample...")
    sample_names = random.sample(sorted(tokens.keys()), min(5, len(tokens)))
    ok = 0
    for name in sample_names:
        d = tokens[name]
        actual_token = tb.get_device_token(d["device_id"])
        if actual_token == d["token"]:
            print(f"  ✓ {name}: token OK")
            ok += 1
        else:
            print(f"  ✗ {name}: token MISMATCH (expected {d['token'][:8]}..., got {(actual_token or '???')[:8]}...)")
    print(f"\n  Verification: {ok}/{len(sample_names)} passed")

    if ok == len(sample_names):
        print("\n  🏨 Hotel is ready! Next steps:")
        print(f"     1. Start simulator:  python3 gateway_simulator_rest.py")
        print(f"     2. Start server:     npm start")
        print(f"     3. Open dashboard:   http://localhost:3000")
    else:
        print("\n  ⚠ Some verifications failed — check ThingsBoard logs")


def run_cleanup(args):
    """Remove all gateway-room-* devices from ThingsBoard."""
    tb = ThingsBoardClient(args.host, args.user, args.password)
    if not tb.login():
        sys.exit(1)

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

    done = 0
    deleted = 0
    for d in devices:
        if tb.delete_device(d["id"]["id"]):
            deleted += 1
        done += 1
        progress_bar(done, len(devices), "Deleting   ")

    print(f"\n  ✓ Deleted {deleted}/{len(devices)} devices")

    # Clean up local token files
    for f in ["gateway_tokens.json", "gateway_tokens.csv"]:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f)
        if os.path.exists(path):
            os.remove(path)
            print(f"  ✓ Removed {f}")


def run_status(args):
    """Show current status of provisioned devices."""
    tb = ThingsBoardClient(args.host, args.user, args.password)
    if not tb.login():
        sys.exit(1)

    devices = tb.get_all_gateway_devices()
    print(f"  Devices found: {len(devices)}")

    if not devices:
        print("  No gateway devices provisioned yet")
        return

    # Count by floor
    floors = {}
    for d in devices:
        name = d["name"]
        try:
            room_num = int(name.replace("gateway-room-", ""))
            floor = room_num // 100
            floors[floor] = floors.get(floor, 0) + 1
        except ValueError:
            pass

    print(f"\n  Floor breakdown:")
    for floor in sorted(floors.keys()):
        type_name = ROOM_TYPES[FLOOR_TYPE.get(floor, 0)]
        bar = "█" * floors[floor]
        print(f"    F{floor:2d} ({type_name:8s}): {floors[floor]:2d} {bar}")
    print(f"\n  Total: {len(devices)} / {TOTAL_ROOMS} expected")

    # Check token file
    token_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gateway_tokens.json")
    if os.path.exists(token_path):
        with open(token_path) as f:
            tokens = json.load(f)
        print(f"  Token file: {len(tokens)} entries")
        if len(tokens) != len(devices):
            print(f"  ⚠ Mismatch! Token file has {len(tokens)} but TB has {len(devices)} devices")
            print(f"    Run setup.py again to reconcile")
    else:
        print(f"  ⚠ No gateway_tokens.json found — run setup.py to generate")


def main():
    parser = argparse.ArgumentParser(
        description="Hilton Grand Hotel — ThingsBoard Device Provisioning",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 setup.py                                  # Standard setup
  python3 setup.py --seed-telemetry                 # Setup + seed data
  python3 setup.py --host http://192.168.1.50:8080  # Custom TB host
  python3 setup.py --cleanup --force                # Remove all devices
  python3 setup.py --status                         # Check current state
  python3 setup.py --dry-run                        # Preview without creating
        """,
    )
    parser.add_argument("--host", default="http://localhost:8080",
                        help="ThingsBoard URL (default: http://localhost:8080)")
    parser.add_argument("--user", default="admin@hiltongrand.com",
                        help="Tenant admin username")
    parser.add_argument("--password", default="hilton",
                        help="Tenant admin password")
    parser.add_argument("--cleanup", action="store_true",
                        help="Remove all gateway-room-* devices")
    parser.add_argument("--force", action="store_true",
                        help="Skip confirmation prompts")
    parser.add_argument("--status", action="store_true",
                        help="Show current provisioning status")
    parser.add_argument("--seed-telemetry", action="store_true",
                        help="Push initial telemetry after device creation")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview what would be created without making changes")
    args = parser.parse_args()

    print("═" * 55)
    print("  HILTON GRAND HOTEL — ThingsBoard Setup v2")
    print(f"  {TOTAL_ROOMS} rooms · {FLOORS} floors · ESP32 Gateways")
    print("═" * 55)

    if args.cleanup:
        run_cleanup(args)
    elif args.status:
        run_status(args)
    else:
        run_setup(args)


if __name__ == "__main__":
    main()
