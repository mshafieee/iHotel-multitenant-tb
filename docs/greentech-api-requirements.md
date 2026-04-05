# iHotel ↔ Greentech GRMS — Integration Specification

**To: Greentech GRMS Technical Team**
**From: iHotel Platform Team**
**Subject: API Capabilities, Data Requirements & Proposed Unified Format**

---

## 1. About iHotel

iHotel is a multi-tenant cloud-based Smart Hotel Management Platform. It connects to physical Room Control Units (RCUs) through a universal IoT adapter layer. A single iHotel server simultaneously manages multiple hotels, each with their own staff dashboard, guest portal, and automation engine — all communicating with physical hardware in real time.

---

## 2. What iHotel Does With Your RCU

### 2.1 Device Discovery
On initial hotel setup, iHotel calls your API to discover all rooms and their installed devices:
- Fetches hotel list via `GET /system/dept/open/list`
- Fetches room list via `GET /mqtt/room/list2` with `hotelId`
- Fetches device groups per room via `GET /mqtt/room/device/list2` with `roomId`

From this, iHotel builds a per-room device topology: number of lamps (`d[]`), dimmers (`tgd[]`), AC units (`wk[]`), curtains (`cl[]`), and service flags (`fw[]`). These counts drive the UI — the staff dashboard and guest portal render exactly the right number of control buttons per room.

### 2.2 Real-Time Polling
iHotel polls all rooms every 5 seconds. Each poll cycle:
- Fetches room list for room-level status fields
- Fetches device groups for all rooms in parallel
- Compares current vs previous state
- Broadcasts any changes to all connected clients via SSE within milliseconds

**Current issue**: this requires 2 API calls per room + 1 hotel list call = 13 calls per cycle for 6 rooms. See Section 5 for the proposed unified format that reduces this to 1 call per room.

### 2.3 Device Control
iHotel sends control commands via `PUT /mqtt/room/device` for lamps, dimmers, AC, curtains, and scenes.

### 2.4 Hardware Scene Triggers
iHotel integrates with your pre-programmed RCU scenes for room lifecycle events:
- **Check-out** → triggers `check out` scene
- **Check-in** → triggers `check in` scene

### 2.5 Guest Portal
Each guest accesses their room controls via a QR code link — lights, AC, curtains, DND. Commands go through iHotel server to your RCU API. The portal subscribes to real-time state updates via SSE.

---

## 3. Current API Issues

| Issue | Impact |
|---|---|
| `checkStatus` field is unreliable | iHotel has disabled it — room occupancy conflicts with booking state |
| `outStatus` sometimes returns `null` | DND state flickers in UI |
| `fw[]` array is empty on all rooms | DND/MUR/SOS service flags cannot be controlled or read |
| No door contact sensor field | Auto check-in on door open does not work |
| No PIR motion sensor field | Energy-saving NOT_OCCUPIED automation does not work |
| No ambient sensor fields (temp/humidity/CO₂) | Environmental monitoring unavailable |
| 2 API calls required per room per poll | 2× TLS overhead — contributing to connection errors |

---

## 4. Required Fields

### 4.1 Room-Level (currently in `/mqtt/room/list2`)

| Field | Required Value | iHotel Usage | Status |
|---|---|---|---|
| `hostId` | string | Room identifier | ✅ Working |
| `roomNum` | string | Room number | ✅ Working |
| `deviceOnline` | `true` / `false` | Online indicator | ✅ (`hoststatus`) |
| `cardPower` | `true` / `false` | Card/energy relay | ✅ (`powerStatus`) |
| `doorLock` | `LOCKED` / `UNLOCKED` | Lock state | ✅ (`lockStatus`) |
| `acRunning` | `true` / `false` | AC actively running | ✅ (`airStatus`) |
| `dnd` | `true` / `false` | Do Not Disturb | ⚠️ Sometimes null |
| `mur` | `true` / `false` | Make Up Room request | ❌ Missing |
| `sos` | `true` / `false` | SOS Emergency | ❌ Missing |
| `checkStatus` | `VACANT` / `CHECKED_IN` etc. | Hardware occupancy | ⚠️ Unreliable |
| `doorContact` | `OPEN` / `CLOSED` | Physical door sensor | ❌ **Missing — critical** |
| `pirMotion` | `true` / `false` | Motion sensor | ❌ **Missing — critical** |
| `roomTemperature` | number | Ambient temperature | ❌ Missing |
| `humidity` | number | Ambient humidity | ❌ Missing |
| `co2` | number | CO₂ level ppm | ❌ Missing |

### 4.2 Device Arrays (currently from `/mqtt/room/device/list2`)

All device arrays should be included in the same room uplink (see Section 5).

---

## 5. Proposed Unified Uplink Format (GET Response)

We propose a single unified JSON response per room that combines all room-level state and device state in one payload. This eliminates the need for a second API call per room per poll cycle.

### 5.1 Proposed Response Shape

```json
{
  "hostId": "6C05000020C4",
  "roomNum": "102A",

  "deviceOnline":    true,
  "cardPower":       true,
  "checkStatus":     "CHECKED_IN",
  "doorLock":        "LOCKED",
  "doorContact":     "CLOSED",
  "pirMotion":       false,
  "dnd":             false,
  "mur":             false,
  "sos":             false,
  "acRunning":       true,

  "roomTemperature": 24.5,
  "humidity":        55,
  "co2":             420,
  "lightLevel":      320,

  "lamps": [
    { "id": 1, "name": "CEILING LIGHT",  "on": true  },
    { "id": 2, "name": "BEDSIDE LIGHT",  "on": false },
    { "id": 3, "name": "ENTRANCE LIGHT", "on": true  },
    { "id": 4, "name": "SOCKET",         "on": true  }
  ],

  "dimmers": [
    { "id": 10, "name": "SPOTLIGHT 1", "on": true,  "brightness": 80 },
    { "id": 11, "name": "SPOTLIGHT 2", "on": false, "brightness": 0  },
    { "id": 12, "name": "SPOTLIGHT 3", "on": true,  "brightness": 60 }
  ],

  "ac": [
    {
      "id":          20,
      "name":        "MAIN THERMOSTAT",
      "on":          true,
      "mode":        "COOL",
      "setTemp":     22,
      "currentTemp": 24.5,
      "fanSpeed":    "AUTO"
    }
  ],

  "curtains": [
    { "id": 30, "name": "MAIN CURTAIN", "position": 100, "state": "OPEN"   },
    { "id": 31, "name": "BLACKOUT",     "position": 0,   "state": "CLOSED" }
  ],

  "scenes": [
    { "id": 40, "name": "CHECK IN"      },
    { "id": 41, "name": "CHECK OUT"     },
    { "id": 42, "name": "WELCOME"       },
    { "id": 43, "name": "SLEEP"         },
    { "id": 44, "name": "DO NOT DISTURB"},
    { "id": 45, "name": "POWER MODE"    },
    { "id": 46, "name": "DOOR CONTACT"  },
    { "id": 47, "name": "SENSOR 1"      },
    { "id": 48, "name": "SENSOR 2"      }
  ]
}
```

### 5.2 Field Value Standards

| Field | Allowed Values |
|---|---|
| `checkStatus` | `VACANT` / `RESERVED` / `CHECKED_IN` / `CHECKED_OUT` / `SERVICE` / `MAINTENANCE` |
| `doorLock` | `LOCKED` / `UNLOCKED` |
| `doorContact` | `OPEN` / `CLOSED` |
| `mode` (AC) | `COOL` / `HEAT` / `FAN` / `AUTO` |
| `fanSpeed` | `AUTO` / `LOW` / `MEDIUM` / `HIGH` |
| `curtain state` | `OPEN` / `CLOSED` / `MOVING` |
| Boolean fields | `true` / `false` |
| `brightness` / `position` | Integer `0–100` |
| Temperature / humidity / CO₂ | Numeric, no unit suffix |

### 5.3 Benefits of Unified Format

| | Current | Proposed |
|---|---|---|
| API calls per room per cycle | 2 | 1 |
| Total calls per cycle (6 rooms) | 13 | 6 |
| TLS connections/minute | ~156 | ~72 |
| State consistency | Two calls can capture different moments in time | Single atomic snapshot |
| Parser complexity | Two different response shapes to merge | One flat structure |

---

## 6. Proposed PUT Command Format (Sparse / Partial Updates)

### Design Principle
PUT commands should be **sparse** — only include the fields you want to change. All omitted fields remain untouched on the RCU. This is standard PATCH semantics.

**`hostId` is the only required field in every PUT request.** Everything else is optional.

### 6.1 Examples

**Turn a single lamp on:**
```json
{ "hostId": "6C05000020C4", "lamps": [{ "id": 1, "on": true }] }
```

**Turn multiple lamps off in one atomic command:**
```json
{
  "hostId": "6C05000020C4",
  "lamps": [
    { "id": 1, "on": false },
    { "id": 2, "on": false },
    { "id": 3, "on": false }
  ]
}
```

**Set dimmer brightness only (keep on/off state):**
```json
{ "hostId": "6C05000020C4", "dimmers": [{ "id": 10, "brightness": 60 }] }
```

**Turn AC on in COOL mode at 22°C:**
```json
{ "hostId": "6C05000020C4", "ac": [{ "id": 20, "on": true, "mode": "COOL", "setTemp": 22 }] }
```

**Change AC temperature only (keep mode and fan speed):**
```json
{ "hostId": "6C05000020C4", "ac": [{ "id": 20, "setTemp": 24 }] }
```

**Activate DND:**
```json
{ "hostId": "6C05000020C4", "dnd": true }
```

**Trigger a scene by ID:**
```json
{ "hostId": "6C05000020C4", "scene": { "id": 41 } }
```

**Checkout — turn off all devices and trigger scene atomically:**
```json
{
  "hostId": "6C05000020C4",
  "scene": { "id": 41 },
  "dnd": false,
  "mur": false
}
```

### 6.2 Rules Summary

1. **Only include what you want to change** — omitted fields are untouched on the hardware
2. **Device arrays are partial** — sending one item in `lamps[]` targets only that lamp; others are unaffected
3. **`hostId` is always required**
4. **Multiple device types in one PUT are applied atomically** — reduces round-trips and ensures consistency
5. **Scene trigger + flag update can be combined** in a single PUT

---

## 7. Summary of Requests

| Priority | Request |
|---|---|
| 🔴 Critical | Add `doorContact` field to room uplink (`OPEN`/`CLOSED`) |
| 🔴 Critical | Add `pirMotion` boolean to room uplink |
| 🔴 Critical | Expose `mur` and `sos` as readable/writable room-level fields |
| 🔴 Critical | Make `dnd` writable via PUT (currently read-only from `outStatus`) |
| 🟠 High | Fix `checkStatus` reliability — should reflect card-in/card-out hardware state only |
| 🟠 High | Fix `outStatus` null values — always return `true`/`false` |
| 🟠 High | Adopt unified single-call uplink format (Section 5) |
| 🟠 High | Adopt sparse PUT format (Section 6) |
| 🟡 Medium | Add `roomTemperature`, `humidity`, `co2` to room uplink if sensors are present |
| 🟡 Medium | Use English field values throughout (Section 5.2) |
