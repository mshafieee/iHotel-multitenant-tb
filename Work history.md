# iHotel Platform — Work History

---

## Session: 2026-02-28 (Part 2) — Security Hardening, Room Automation, UX Polish

### Summary
This session covered three major areas:
1. **UX improvements** to the staff dashboard (Finance tab access, Heatmap for frontdesk, configurable Heatmap columns)
2. **Room automation** — automatic cleanup sequence when a room goes unoccupied, and auto-setting NOT_OCCUPIED on PMS reservation creation
3. **Optimistic SSE broadcast** — instant UI feedback after control commands
4. **Security hardening (Phase 0)** — bcrypt guest passwords and removing JWT from guest SSE URL
5. **AC temperature precision + instant guest response** — 0.5° step locking and optimistic store update for guests

---

### Changes Made

#### 1. Dashboard: Finance Tab — Owner Only (`client/src/pages/DashboardPage.jsx`)
**Change:** `canSeeFinance = isOwner` (removed `|| isAdmin`).
Finance/revenue data is now exclusively visible to the owner role.

#### 2. Dashboard: Heatmap for Frontdesk + Configurable Columns (`client/src/pages/DashboardPage.jsx`, `client/src/components/Heatmap.jsx`)
**Change:** Removed the `!isFrontdesk &&` guard so all staff roles see the heatmap.

Added a column-count selector toolbar (Auto / 5 / 8 / 10 / 12 / 15 / 20) visible to owner and admin, persisted in `localStorage`. The Heatmap component accepts a `cols` prop:
- `cols === 0` → flex-wrap (auto)
- `cols > 0` → CSS grid with `gridTemplateColumns: repeat(N, 5.5rem)`

#### 3. Room Automation on Vacant/Not-Occupied (`server/index.js`)
Added `vacateRoom(hotelId, devId, roomNum, targetStatus, username)` helper that fires four sequential `sendControl` calls:
1. `setLines` — all lights off, dimmers to 0
2. `setAC` — mode=COOL (1), temperature=26°C, fanSpeed=LOW (0)
3. `setCurtainsBlinds` — curtains and blinds to 0%
4. `setRoomStatus` — sets the target status (0=VACANT or 4=NOT_OCCUPIED)

Wired into:
- `startNotOccupiedTimer` — fires `vacateRoom(..., 4, 'auto')` after 5 min no-motion
- `/api/devices/:id/rpc` — intercepts `setRoomStatus` with status 0 or 4 and calls `vacateRoom` instead of a simple status write

#### 4. PMS Reservation → Auto NOT_OCCUPIED (`server/index.js`)
After `POST /api/pms/reservations` responds, a `setImmediate` fires `sendControl(setRoomStatus, 4)` for the room. This lets front desk staff immediately see that a reserved-but-not-yet-checked-in room is NOT_OCCUPIED on the heatmap.

#### 5. Optimistic SSE Broadcast — Instant UI (`server/index.js`)
Restructured `sendControl` to update `lastTelemetry[roomNum]` and call `sseBroadcast` **before** awaiting any ThingsBoard writes. TB calls fire non-blocking with `.catch()`. Result: the dashboard updates in <10ms instead of 1–4 seconds.

#### 6. Phase 0a — Bcrypt Guest Passwords (`server/db.js`, `server/index.js`)

**Problem:** `reservations.password` stored a 6-digit code in plaintext; login compared with `!==`.

**Fix:**
- `server/db.js` — Added `password_hash TEXT` column to `reservations` table schema; added migration `011_guest_password_hash` that runs once on startup, adds the column to existing databases, and bcrypt-hashes all existing plaintext passwords.
- `server/index.js` — Reservation creation: generates `plainPassword`, hashes with `bcrypt.hashSync(plainPassword, 10)`, stores both; returns only `plainPassword` in the HTTP response.
- `server/index.js` — Guest login: replaced `storedPassword !== providedPassword` with `bcrypt.compareSync(providedPassword, r.password_hash || r.password)` (plaintext fallback for any legacy rows).
- `server/index.js` — Removed `GUEST_TEST_PASSWORD` static bypass block entirely.

#### 7. Phase 0b — Remove JWT from Guest SSE URL (`client/src/pages/GuestPortal.jsx`)

**Problem:** `new EventSource('/api/events?token=JWT')` put the long-lived JWT in Nginx access logs, browser history, and referrer headers.

**Fix:** Removed `EventSource` and the 30s polling fallback. Replaced with a single `setInterval(poll, 5000)` that calls `api('/api/guest/room/data')` — the `api()` helper sends `Authorization: Bearer` header, never putting the token in the URL.

Note: The server-side query-token injection block (`index.js:267-272`) is intentionally kept because **staff SSE** (`hotelStore.connectSSE`) also uses `EventSource` with the token query param and still requires it.

#### 8. AC Temperature Precision (`client/src/components/RoomModal.jsx`)

**Problem:** Raw telemetry values (e.g. `22.1°`) were used as the starting point before adding `±0.5`, causing values to drift off the 0.5° grid indefinitely.

**Fix in `adjTemp`:**
```js
const current = Math.round((r.acTemperatureSet ?? 22) * 2) / 2; // snap to nearest 0.5
const t = Math.max(16, Math.min(30, current + delta));
```
The display also shows the snapped value (`Math.round(... * 2) / 2`) so a telemetry value of `22.1` renders as `22°`.

#### 9. Instant AC Response for Guests (`client/src/components/RoomModal.jsx`)

**Problem:** The guest `send()` path called `api('/api/guest/rpc', ...)` with no optimistic update. The display only refreshed on the next 5s poll — up to 5 seconds of perceived lag.

**Fix:** Added an optimistic Zustand store update inside the guest branch of `send()`, mirroring what staff `rpc()` already does. The update fires synchronously before the API call so the UI responds instantly.

---

### Commits

| Hash | Message |
|------|---------|
| `15426c7` | feat: UX polish, room automation, instant SSE updates, multi-tenant improvements |
| `92a1460` | security: hash guest passwords + fix AC temp precision and instant UI response |

---

### Files Changed

| File | Change |
|------|--------|
| `server/db.js` | `password_hash` column in `reservations` schema; migration `011_guest_password_hash` |
| `server/index.js` | `vacateRoom()` helper; PMS → NOT_OCCUPIED; optimistic SSE; bcrypt compare; remove GUEST_TEST_PASSWORD |
| `client/src/pages/DashboardPage.jsx` | Finance → owner only; heatmap cols selector; heatmap for all roles |
| `client/src/components/Heatmap.jsx` | `cols` prop; CSS grid vs flex-wrap based on cols |
| `client/src/components/RoomModal.jsx` | 0.5° snap in `adjTemp`; guest optimistic store update in `send()` |
| `client/src/pages/GuestPortal.jsx` | Replace EventSource with 5s `api()` polling |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Keep server query-token block for SSE | Staff `hotelStore.connectSSE` uses `EventSource` which cannot set headers; block only removed for guest path |
| Bcrypt fallback to plaintext | Allows existing plaintext rows to still work during migration window; migration hashes them on startup |
| `vacateRoom` as orchestrating helper | Keeps automation logic in one place; called identically by timer, RPC intercept, and any future triggers |
| Optimistic broadcast before TB writes | TB API latency (200–2000ms) should never be user-visible for control commands |

---

---

## Session: 2026-02-28 — Multi-Tenant Platform, Performance Fixes, 600-Room Scale Testing

### Summary
This session covered finalizing the multi-tenant platform, fixing several UI and functional bugs
discovered during real-world testing with a 600-room hotel (Hayat: 25 floors × 24 rooms), and
resolving a critical server crash caused by synchronous ThingsBoard API calls in the HTTP path.

---

### Changes Made

#### 1. Developer Configuration Blocks (setup.py, gateway_simulator.py)
Added clearly labeled `# ── DEVELOPER CONFIGURATION ──` sections at the top of both scripts
so operators can configure the hotel without reading the full script.

**setup.py** — configurable constants:
- `TB_HOST`, `TB_USER`, `TB_PASS` — ThingsBoard connection
- `FLOORS`, `ROOMS_PER_FLOOR` — hotel layout
- `ROOM_TYPE_RANGES` — maps room index ranges to types (STANDARD / SUITE / VIP)
- `RACK_RATES` — nightly rate per room type (SAR)
- `DEVICE_PROFILE_NAME`, `TOKEN_FILE`, `CSV_FILE`, `BATCH_SIZE`, etc.
- `_validate_config()` added to catch misconfigured ROOM_TYPE_RANGES at startup

**gateway_simulator.py** — configurable constants:
- `TB_HOST`, `TOKEN_CSV` — connection and token file path
- `DEFAULT_INTERVAL`, `DEFAULT_WORKERS` — simulation speed
- `FIRMWARE_VERSION`, `GATEWAY_VERSION` — reported by simulated devices

#### 2. .gitignore Updates
- Added `server/ihotel.db*`, `*.db`, `*.db-shm`, `*.db-wal` to ignore all SQLite files
- Added `.claude/settings.local.json`
- Kept `gateway_tokens.csv` and `gateway_tokens.json` tracked (used by gateway_simulator.py)
- Kept `SETUP_GUIDE.md` tracked

#### 3. Door Unlock Bug Fix (server/index.js, client/src/store/hotelStore.js)
**Problem:** Pressing "Unlock Door" in the UI did not show the UNLOCKED state.

**Root cause:** `hotelStore.rpc(roomId, method, params)` was called with the room number string
(e.g. `"101"`), but the optimistic update was looking up `rooms[roomId]` which is correct — the
rooms store IS keyed by room number. However the ThingsBoard API call was also using `roomId`
(room number) instead of `room.deviceId` (the ThingsBoard UUID), so the RPC hit TB with the
wrong ID and failed silently.

**Fix in hotelStore.js:**
```js
rpc: async (roomId, method, params) => {
  const rooms = { ...get().rooms };
  const room  = rooms[roomId];           // keyed by room number — correct
  if (room) { applyLocal(room, method, params); set({ rooms: { ...rooms } }); }
  const tbDeviceId = room?.deviceId || roomId;  // use TB UUID for API call
  await api(`/api/devices/${tbDeviceId}/rpc`, { ... });
},
```

#### 4. Header & Browser Tab Title (client/src/pages/DashboardPage.jsx, client/index.html)
**Problem:** Header showed "iHotel" as the big title; hotel name was secondary.

**Fix:**
- Header: `<h1>` now shows `{user?.hotelName}` (big, bold), `<p>` shows `iHotel` (small, faint)
- Browser tab: `useEffect` sets `document.title = \`${user.hotelName} — iHotel\`` on login
- `client/index.html` default title changed from "Hilton Grand Hotel — IoT Platform" to "iHotel"

#### 5. 600-Room Performance: Overview Cache + Batch DB Queries (server/index.js)
**Problem:** Browser periodically froze for several seconds when managing a 600-room hotel.

**Root causes identified:**
1. Server made 1200 ThingsBoard API calls (600 telemetry + 600 attributes) on every poll cycle
2. Server made 1200 individual SQLite queries (600 reservation + 600 room_type lookups) in loops
3. Client double-rendered: HTTP response set `rooms`, then SSE `snapshot` set `rooms` again

**Fixes:**
- Added **30-second in-memory cache** (`_overviewFetchTs`, `OVERVIEW_CACHE_TTL = 30_000`)
  for the overview endpoint — subsequent polls within 30s skip all TB API calls entirely
- Replaced **N+1 SQLite loops** with 2 batch queries + in-memory maps:
  ```js
  // One query for all active reservations → reservationMap[room]
  // One query for all hotel_rooms → hotelRoomMap[room]
  ```
- Client `fetchOverview`: checks `d.cached` flag — if fresh TB data, SSE snapshot is coming
  so HTTP response skips rooms update to avoid double-render
- Poll interval increased from **15s → 60s** (SSE handles real-time updates)

#### 6. Critical Fix: Socket Hang Up / Server Crash (server/index.js, client/src/store/hotelStore.js)
**Problem:** Vite proxy errors: `socket hang up` on `/api/hotel/overview`, then `ECONNREFUSED`
as the server crashed. Occurred repeatedly with 600-room hotel.

**Root cause:** Even with the 30s cache, on a cache miss the server was still making ~1200
ThingsBoard API calls synchronously inside the HTTP handler, in 30 serial batches of 20
parallel calls each. With 600 rooms this took **40–49 seconds** — far beyond the Vite proxy
timeout — causing `socket hang up`. The unhandled timeout crashed the Node.js process.

**Fix — Non-blocking overview route:**

Extracted all TB fetch logic into a standalone `async function fetchAndBroadcast(hotelId)`.
The HTTP route now **always responds immediately** (< 1ms) with whatever is in the cache:

```js
app.get('/api/hotel/overview', authenticate, async (req, res) => {
  const lastOverview = getLastOverviewRooms(hotelId);
  const isStale      = Date.now() - (_overviewFetchTs[hotelId] || 0) >= OVERVIEW_CACHE_TTL;

  // Always respond immediately — never block HTTP waiting for ThingsBoard
  res.json({ rooms: lastOverview, deviceCount: ..., cached: true });

  // Kick off background TB fetch if stale and not already running
  if (!isStale || _fetchingOverview.has(hotelId)) return;
  _fetchingOverview.add(hotelId);
  fetchAndBroadcast(hotelId)
    .catch(e => console.error(...))
    .finally(() => _fetchingOverview.delete(hotelId));
});
```

Added `_fetchingOverview = new Set()` to prevent concurrent background fetches for the same hotel.

When `fetchAndBroadcast` completes (~40s for 600 rooms), fresh data is pushed to all connected
staff browsers via the existing SSE `snapshot` event — no additional client changes needed.

**Client simplification (hotelStore.js):**
Since the server always returns `cached: true` now, `fetchOverview` was simplified:
```js
fetchOverview: async () => {
  const d = await api('/api/hotel/overview');
  if (d.rooms && Object.keys(d.rooms).length) {
    set({ rooms: d.rooms, deviceCount: d.deviceCount, source: 'live' });
  }
},
```
The SSE `snapshot` listener handles the subsequent fresh-data update.

#### 7. Hotel Data: Hayat Hotel (600 rooms)
`setup.py` configuration updated for the Hayat hotel:
- 25 floors × 24 rooms = 600 rooms total
- Room types: indices 1–8 STANDARD, 9–16 SUITE, 17–24 VIP per floor
- `gateway_tokens.csv` / `gateway_tokens.json` regenerated with 600 device tokens

---

### Files Changed

| File | Change |
|------|--------|
| `server/index.js` | Non-blocking overview route; `fetchAndBroadcast()` extracted; `_fetchingOverview` Set; 30s cache; batch DB queries |
| `client/src/store/hotelStore.js` | Simplified `fetchOverview`; fixed `rpc()` deviceId lookup; poll interval 15s→60s |
| `client/src/pages/DashboardPage.jsx` | Hotel name as big title; `document.title` useEffect |
| `client/index.html` | Default tab title changed to "iHotel" |
| `setup.py` | Developer config block; Hayat hotel config (25F×24R) |
| `gateway_simulator.py` | Developer config block |
| `gateway_tokens.csv` | Regenerated for 600 Hayat hotel devices |
| `gateway_tokens.json` | Regenerated for 600 Hayat hotel devices |
| `.gitignore` | Added DB files, claude settings |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Non-blocking HTTP + SSE push for overview | TB fetch for 600 rooms takes 40s+ — must never block HTTP response |
| `_fetchingOverview` Set guard | Prevents thundering herd: multiple simultaneous clients don't each trigger a separate 40s fetch |
| Always return `cached: true` | Simplifies client logic; SSE snapshot is the "fresh" delivery mechanism |
| 30s TTL for background re-fetch | Balances freshness against TB API load (1200 calls/30s vs 1200 calls/15s) |
| Poll interval 60s (was 15s) | SSE delivers sub-second room changes; HTTP poll is only a safety net |
