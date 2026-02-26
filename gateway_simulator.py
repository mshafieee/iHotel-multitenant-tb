#!/usr/bin/env python3
"""
╔═══════════════════════════════════════════════════════════╗
║  Hilton Grand Hotel — IoT Gateway Simulator               ║
║  Sends realistic telemetry to ThingsBoard for all rooms   ║
╚═══════════════════════════════════════════════════════════╝

Usage:
  python3 gateway_simulator.py                         # all 300 rooms, 15 s interval
  python3 gateway_simulator.py --rooms 1001,1002,1010  # specific rooms only
  python3 gateway_simulator.py --interval 5            # faster updates
  python3 gateway_simulator.py --tb-host http://192.168.43.212:8080
  python3 gateway_simulator.py --workers 20            # concurrent threads
  python3 gateway_simulator.py --no-attributes         # skip relay attributes
  python3 gateway_simulator.py --verbose               # print every send
"""

import csv
import json
import math
import random
import sys
import time
import threading
import argparse
import os
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
    SESSION = requests.Session()
    USE_REQUESTS = True
except ImportError:
    import urllib.request
    import urllib.error
    USE_REQUESTS = False
    SESSION = None

# ── ANSI colours ──────────────────────────────────────────────────────────────
R  = '\033[91m'
G  = '\033[92m'
Y  = '\033[93m'
B  = '\033[94m'
M  = '\033[95m'
C  = '\033[96m'
W  = '\033[97m'
DIM = '\033[2m'
RST = '\033[0m'
BOLD= '\033[1m'

def ts():
    return datetime.now().strftime('%H:%M:%S')

# ── State machine for one room ────────────────────────────────────────────────

class RoomState:
    FW  = '2.1.4'
    GW  = '1.8.2'

    def __init__(self, room, floor, room_type, token):
        self.room      = str(room)
        self.floor     = int(floor)
        self.room_type = room_type
        self.token     = token

        occupied = random.random() < 0.55

        # ── Room state ──
        self.roomStatus        = 1 if occupied else random.choice([0, 2])
        self.pirMotionStatus   = occupied and random.random() < 0.4
        self.doorStatus        = False
        self.doorLockBattery   = random.randint(55, 100)
        self.doorContactsBattery = random.randint(55, 100)
        self.co2               = random.randint(410, 800 if not occupied else 1100)
        self.temperature       = round(random.uniform(20.0, 26.0), 1)
        self.humidity          = round(random.uniform(38.0, 68.0), 1)
        self.airQualityBattery = random.randint(55, 100)

        # ── Consumption (cumulative kWh / m³) ──
        self.elecConsumption  = round(random.uniform(0, 600), 2)
        self.waterConsumption = round(random.uniform(0,  60), 3)
        self.waterMeterBattery = random.randint(55, 100)

        # ── Lighting ──
        self.line1   = occupied and random.random() < 0.7
        self.line2   = occupied and random.random() < 0.55
        self.line3   = occupied and random.random() < 0.35
        self.dimmer1 = random.randint(20, 100) if self.line1 else 0
        self.dimmer2 = random.randint(10, 100) if self.line2 else 0

        # ── AC ──
        self.acMode          = random.randint(1, 4) if occupied else 0
        self.acTemperatureSet = round(random.uniform(20.0, 24.0), 1)
        self.fanSpeed        = random.randint(0, 3)

        # ── Curtains / Blinds ──
        self.curtainsPosition = random.randint(0, 100)
        self.blindsPosition   = random.randint(0, 100)

        # ── Services ──
        self.dndService = occupied and random.random() < 0.15
        self.murService = False
        self.sosService = False

        # ── System ──
        self.lastCleanedTime  = str(int(time.time() * 1000) - random.randint(3600_000, 86400_000))
        self.lastTelemetryTime = str(int(time.time() * 1000))
        self.firmwareVersion  = self.FW
        self.gatewayVersion   = self.GW
        self.deviceStatus     = 0   # 0=normal 1=boot 2=fault

        # ── Relay attributes ──
        self.relay1 = self.line1
        self.relay2 = self.line2
        self.relay3 = self.line3
        self.relay4 = self.acMode == 1
        self.relay5 = self.fanSpeed == 2
        self.relay6 = self.fanSpeed == 1
        self.relay7 = self.fanSpeed == 0
        self.relay8 = False
        self.doorUnlock = False

        # ── Internal counters ──
        self._tick          = 0
        self._door_open_for = 0   # ticks door has been open

    # ── Per-tick update ──────────────────────────────────────────────────────

    def tick(self):
        self._tick += 1
        occupied = self.roomStatus == 1

        # Temperature — slow drift toward AC setpoint when occupied
        target = self.acTemperatureSet if (occupied and self.acMode != 0) else 24.0
        self.temperature = round(
            self.temperature + (target - self.temperature) * 0.02
            + random.uniform(-0.1, 0.1), 1
        )
        self.temperature = max(16.0, min(35.0, self.temperature))

        # Humidity
        self.humidity = round(
            max(25.0, min(90.0, self.humidity + random.uniform(-0.4, 0.4))), 1
        )

        # CO2 — rises with occupancy
        co2_delta = random.randint(-15, 40) if occupied else random.randint(-8, 5)
        self.co2  = max(400, min(2000, self.co2 + co2_delta))

        # PIR — motion pulses when occupied
        if occupied:
            self.pirMotionStatus = random.random() < 0.30
        else:
            self.pirMotionStatus = False

        # Door — occasional open/close when occupied
        if occupied:
            if not self.doorStatus and random.random() < 0.025:
                self.doorStatus       = True
                self._door_open_for   = 0
            elif self.doorStatus:
                self._door_open_for += 1
                if self._door_open_for >= random.randint(1, 4):
                    self.doorStatus = False
        else:
            self.doorStatus = False

        # Door unlock auto-clears after one tick
        if self.doorUnlock:
            self.doorUnlock = False
            self.relay8     = False

        # Consumption always ticks up
        self.elecConsumption  = round(self.elecConsumption  + random.uniform(0, 0.4  if occupied else 0.08), 2)
        self.waterConsumption = round(self.waterConsumption + random.uniform(0, 0.04 if occupied else 0.002), 3)

        # ── Random events (low probability) ──
        rnd = random.random()
        if   rnd < 0.004 and occupied:                 # MUR request
            self.murService = True
        elif rnd < 0.0015 and occupied:                # SOS emergency
            self.sosService = True
        elif rnd < 0.001:                              # transient device fault
            self.deviceStatus = 2
        else:
            self.deviceStatus = 0

        # Auto-clear services after a while
        if self.murService and random.random() < 0.08:
            self.murService = False
        if self.sosService and random.random() < 0.04:
            self.sosService = False

        # Battery drain (very slow)
        for attr in ('doorLockBattery', 'doorContactsBattery',
                     'airQualityBattery', 'waterMeterBattery'):
            if random.random() < 0.008:
                setattr(self, attr, max(5, getattr(self, attr) - 1))

        # Timestamp
        self.lastTelemetryTime = str(int(time.time() * 1000))

        # Sync relay outputs to logical state
        self.relay1 = self.line1
        self.relay2 = self.line2
        self.relay3 = self.line3
        self.relay4 = self.acMode == 1
        self.relay5 = self.fanSpeed == 2
        self.relay6 = self.fanSpeed == 1
        self.relay7 = self.fanSpeed == 0

    # ── Payload builders ─────────────────────────────────────────────────────

    def telemetry(self):
        return {
            'roomStatus':          self.roomStatus,
            'pirMotionStatus':     self.pirMotionStatus,
            'doorStatus':          self.doorStatus,
            'doorLockBattery':     self.doorLockBattery,
            'doorContactsBattery': self.doorContactsBattery,
            'co2':                 self.co2,
            'temperature':         self.temperature,
            'humidity':            self.humidity,
            'airQualityBattery':   self.airQualityBattery,
            'elecConsumption':     self.elecConsumption,
            'waterConsumption':    self.waterConsumption,
            'waterMeterBattery':   self.waterMeterBattery,
            'line1':               self.line1,
            'line2':               self.line2,
            'line3':               self.line3,
            'dimmer1':             self.dimmer1,
            'dimmer2':             self.dimmer2,
            'acTemperatureSet':    self.acTemperatureSet,
            'acMode':              self.acMode,
            'fanSpeed':            self.fanSpeed,
            'curtainsPosition':    self.curtainsPosition,
            'blindsPosition':      self.blindsPosition,
            'dndService':          self.dndService,
            'murService':          self.murService,
            'sosService':          self.sosService,
            'lastCleanedTime':     self.lastCleanedTime,
            'lastTelemetryTime':   self.lastTelemetryTime,
            'firmwareVersion':     self.firmwareVersion,
            'gatewayVersion':      self.gatewayVersion,
            'deviceStatus':        self.deviceStatus,
        }

    def attributes(self):
        return {
            'relay1':    self.relay1,
            'relay2':    self.relay2,
            'relay3':    self.relay3,
            'relay4':    self.relay4,
            'relay5':    self.relay5,
            'relay6':    self.relay6,
            'relay7':    self.relay7,
            'relay8':    self.relay8,
            'doorUnlock': self.doorUnlock,
        }

    def status_line(self):
        STATUS_ICONS = ['🟢', '🔵', '🩵', '🔴', '🩷', '🟠', '🚨']
        AC_ICONS     = ['—', '❄', '🔥', '💨', '🔄']
        icon  = STATUS_ICONS[self.roomStatus] if self.roomStatus < 7 else '?'
        ac    = AC_ICONS[self.acMode] if self.acMode < 5 else '?'
        flags = ''
        if self.dndService: flags += ' DND'
        if self.murService: flags += f' {Y}MUR{RST}'
        if self.sosService: flags += f' {R}SOS{RST}'
        if self.doorStatus: flags += ' 🚪'
        if self.pirMotionStatus: flags += ' 👁'
        return (f'Rm{self.room:<4} {icon} {self.temperature:4.1f}°C '
                f'H{self.humidity:4.1f}% CO₂{self.co2:4d} '
                f'AC{ac} L{"1" if self.line1 else "·"}{"2" if self.line2 else "·"}{"3" if self.line3 else "·"}'
                f'{flags}')


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def http_post(url, payload, timeout=8):
    data    = json.dumps(payload).encode()
    headers = {'Content-Type': 'application/json'}
    if USE_REQUESTS:
        r = SESSION.post(url, data=data, headers=headers, timeout=timeout)
        return r.status_code
    else:
        req = urllib.request.Request(url, data=data, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status
        except urllib.error.HTTPError as e:
            return e.code


def send_room(state, tb_host, send_attrs, verbose):
    """Send telemetry (and optionally attributes) for one room. Returns (ok, ms)."""
    t0 = time.monotonic()
    ok = True
    try:
        base = f'{tb_host}/api/v1/{state.token}'
        code = http_post(f'{base}/telemetry', state.telemetry())
        if code not in (200, 201):
            ok = False
        if send_attrs and ok:
            code2 = http_post(f'{base}/attributes', state.attributes())
            if code2 not in (200, 201):
                ok = False
    except Exception as e:
        ok = False
        if verbose:
            print(f'  {R}ERR{RST} room {state.room}: {e}')
    ms = int((time.monotonic() - t0) * 1000)
    return ok, ms


# ── Main simulator loop ───────────────────────────────────────────────────────

def load_rooms(csv_path, filter_rooms=None):
    rooms = []
    with open(csv_path, newline='') as f:
        for row in csv.DictReader(f):
            rn = row['room']
            if filter_rooms and rn not in filter_rooms:
                continue
            rooms.append(RoomState(
                room=rn, floor=row['floor'],
                room_type=row['type'], token=row['token']
            ))
    return rooms


def run(args):
    csv_path = os.path.join(os.path.dirname(__file__), 'gateway_tokens.csv')
    if not os.path.exists(csv_path):
        print(f'{R}ERROR:{RST} gateway_tokens.csv not found at {csv_path}')
        sys.exit(1)

    filter_rooms = None
    if args.rooms:
        filter_rooms = set(r.strip() for r in args.rooms.split(','))

    rooms = load_rooms(csv_path, filter_rooms)
    if not rooms:
        print(f'{R}ERROR:{RST} No rooms matched. Check --rooms values against gateway_tokens.csv')
        sys.exit(1)

    tb_host    = args.tb_host.rstrip('/')
    interval   = args.interval
    workers    = min(args.workers, len(rooms))
    send_attrs = not args.no_attributes
    verbose    = args.verbose

    print(f'\n{BOLD}{"═"*60}{RST}')
    print(f'  {C}Hilton Grand Hotel — Gateway Simulator{RST}')
    print(f'{"═"*60}')
    print(f'  ThingsBoard : {W}{tb_host}{RST}')
    print(f'  Rooms       : {W}{len(rooms)}{RST}')
    print(f'  Interval    : {W}{interval}s{RST}')
    print(f'  Workers     : {W}{workers}{RST}')
    print(f'  Attributes  : {W}{"yes" if send_attrs else "no"}{RST}')
    print(f'{"═"*60}\n')

    # ── Verify connectivity with a single room first ──
    print(f'{DIM}Verifying ThingsBoard connection...{RST}', end=' ', flush=True)
    try:
        ok, ms = send_room(rooms[0], tb_host, send_attrs, verbose=True)
        if ok:
            print(f'{G}OK{RST} ({ms} ms)\n')
        else:
            print(f'{Y}WARNING: first send returned non-200. Check TB connection.{RST}\n')
    except Exception as e:
        print(f'{R}FAILED: {e}{RST}')
        print(f'{Y}Continuing anyway — errors will be reported per room.{RST}\n')

    tick = 0
    try:
        while True:
            tick += 1
            t_start = time.monotonic()

            # Update all room states
            for r in rooms:
                r.tick()

            # Send in parallel
            sent_ok = 0
            sent_err = 0
            total_ms = 0

            with ThreadPoolExecutor(max_workers=workers) as ex:
                futures = {ex.submit(send_room, r, tb_host, send_attrs, verbose): r for r in rooms}
                for fut in as_completed(futures):
                    ok, ms = fut.result()
                    total_ms += ms
                    if ok:
                        sent_ok += 1
                    else:
                        sent_err += 1

            elapsed = time.monotonic() - t_start
            avg_ms  = total_ms // max(1, len(rooms))

            # ── Summary line ──
            occ     = sum(1 for r in rooms if r.roomStatus == 1)
            sos     = sum(1 for r in rooms if r.sosService)
            mur     = sum(1 for r in rooms if r.murService)
            dnd     = sum(1 for r in rooms if r.dndService)

            err_str = f' {R}ERR:{sent_err}{RST}' if sent_err else ''
            sos_str = f' {R}🚨SOS:{sos}{RST}'  if sos  else ''
            mur_str = f' {Y}🧹MUR:{mur}{RST}'  if mur  else ''

            print(
                f'[{DIM}{ts()}{RST}] tick#{tick:04d} '
                f'sent={G}{sent_ok}{RST}{err_str} '
                f'occ={B}{occ}/{len(rooms)}{RST} '
                f'DND={dnd}{sos_str}{mur_str} '
                f'avg={avg_ms}ms wall={elapsed:.1f}s'
            )

            # ── Verbose: print changed rooms ──
            if verbose:
                for r in rooms:
                    if r.murService or r.sosService or r.doorStatus:
                        print(f'  {DIM}{r.status_line()}{RST}')

            # ── Sleep for remainder of interval ──
            sleep_for = max(0, interval - elapsed)
            time.sleep(sleep_for)

    except KeyboardInterrupt:
        print(f'\n{Y}Simulator stopped.{RST}')


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description='Hilton Grand Hotel — IoT Gateway Simulator',
        formatter_class=argparse.RawTextHelpFormatter
    )
    p.add_argument('--tb-host',
                   default=os.environ.get('TB_HOST', 'http://localhost:8080'),
                   help='ThingsBoard host URL (default: http://localhost:8080)\n'
                        'Also reads $TB_HOST environment variable')
    p.add_argument('--rooms',
                   default=None,
                   help='Comma-separated room numbers to simulate (default: all)\n'
                        'Example: --rooms 1001,1002,1010')
    p.add_argument('--interval',
                   type=float, default=15.0,
                   help='Seconds between telemetry pushes (default: 15)')
    p.add_argument('--workers',
                   type=int, default=30,
                   help='Parallel HTTP threads (default: 30)')
    p.add_argument('--no-attributes',
                   action='store_true',
                   help='Skip sending relay shared-attributes (faster)')
    p.add_argument('--verbose', '-v',
                   action='store_true',
                   help='Print status line for rooms with active events')
    p.add_argument('--fast',
                   action='store_true',
                   help='Shortcut: --interval 5 --verbose')
    args = p.parse_args()

    if args.fast:
        args.interval = 5
        args.verbose  = True

    if not USE_REQUESTS:
        print(f'{Y}[INFO]{RST} `requests` not installed — using urllib (slower). '
              f'Install with: pip3 install requests\n')

    run(args)


if __name__ == '__main__':
    main()
