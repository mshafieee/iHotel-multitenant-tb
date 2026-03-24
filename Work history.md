# iHotel Platform — Work History

---

## Session: 2026-03-24 — Bug Fixes + Housekeeping Workflow

### Summary
Two separate work packages delivered in this session:

**Part 1 — Bug fixes (branch: `claude/fix-room-status-checkout-I2xY6`)**
Four bugs found during a full codebase review and fixed before merging to main.

**Part 2 — Housekeeping workflow feature (branch: `claude/feat-housekeeping-workflow`)**
Full end-to-end housekeeping system: new `housekeeper` role, room assignment by managers,
real-time SSE notifications, start/done flow with automatic room reset.

---

### Part 1 — Bug Fixes

#### Bug 1 — Checkout date hidden on RESERVED rooms
`client/src/components/RoomModal.jsx` lines 582 & 592 had an `r.roomStatus !== 0` guard that
blocked the checkout-date badge whenever a room was in RESERVED state (roomStatus=0 + active
reservation). The guard was redundant — `r.reservation?.checkOut` already implies a reservation.
Removed from both the staff badge and the guest header. Also added checkout date to both Heatmap
hover tooltips which never showed it at all.

#### Bug 2 — Sensor/appliance activity not correctly triggering OCCUPIED
Three sub-bugs in `server/index.js → detectAndLogChanges()`:
- **Door-open → OCCUPIED**: MAINTENANCE rooms (status 3) with a reservation were being auto-flipped
  to OCCUPIED when a worker opened the door. Fixed with `&& curStatus !== 3`.
- **pirMotionStatus missing**: Motion was not wired into the reserved-room guest-activity block.
  Door, lights, AC, curtains already worked; motion was silently dropped. Added.
- **Appliance block maintenance gap**: same `curStatus !== 3` guard added there too.

#### Bug 3 — Stale reservation in server cache after checkout / cancellation
After checkout or reservation deletion, `lastOverviewRooms[room].reservation` was never cleared.
Housekeeping entering a SERVICE room would pass the `reservation !== null` check and auto-flip the
room back to OCCUPIED. Fixed by nulling the cache entry and broadcasting `{ reservation: null }`
via SSE immediately in both the checkout and reservation-deletion endpoints.

#### Bug 4 — Server cache not updated after reservation creation
After `POST /api/pms/reservations`, the overview cache kept `reservation: null` for up to 60 seconds.
Any pirMotionStatus or appliance event in that window would miss the reservation guard and never
trigger OCCUPIED. Also caused the checkout-date badge to be invisible for up to a minute. Fixed by
updating the cache and broadcasting via SSE immediately after the INSERT.

---

### Part 2 — Housekeeping Workflow

#### 1. Database (`server/db.js`)
- New table `housekeeping_assignments`:
  `id, hotel_id, room, assigned_to, assigned_by, assigned_at, status, started_at, completed_at, notes`
  Status lifecycle: `pending → in_progress → done` (or `cancelled` by manager).
- Migration `020_housekeeping_assignments` marks the table as applied.

#### 2. Server (`server/index.js`)

**New SSE helper**
- `sseBroadcastUser(hotelId, username, event, data)` — targets a single staff member's live
  connection. Requires `username` to be stored in the SSE client metadata (added to `sseConnect`).

**`housekeeper` role**
- Added `'housekeeper'` to the allowed-roles list in `POST /api/users` and `PUT /api/users/:id`.

**New endpoints (all under `/api/housekeeping/`)**

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/queue` | manager + housekeeper | Managers: unassigned SERVICE rooms. Housekeepers: their own pending/in_progress tasks. |
| GET | `/assignments` | manager + housekeeper | Active assignments. Managers see all; housekeepers see only their own. |
| GET | `/housekeepers` | manager | List active housekeeper accounts (for assignment dropdown). |
| POST | `/assign` | manager | Bulk-assign rooms to one housekeeper. Sends `housekeeping_assign` SSE to that user. |
| POST | `/assignments/:id/start` | manager + housekeeper | pending → in_progress. |
| POST | `/assignments/:id/complete` | manager + housekeeper | in_progress → done. Resets appliances + sets VACANT. Does **not** cancel reservations or reset meters. |
| DELETE | `/assignments/:id` | manager | Cancel — sends `housekeeping_cancel` SSE to the housekeeper. |

**Room reset on complete**
Calls `sendControl` in sequence: `setPDMode(false)` → `setLines(off)` → `setAC(0, 26°C)` →
`setCurtainsBlinds(0)` → `resetServices` → `setRoomStatus(0)`.
`setRoomStatus(0)` auto-writes `lastCleanedTime` (existing behaviour in `controlToTelemetry`).

#### 3. Store (`client/src/store/hotelStore.js`)
New state: `hkQueue`, `hkAssignments`, `hkHousekeepers`, `hkNotifications`.
New actions: `fetchHKQueue`, `fetchHKAssignments`, `fetchHKHousekeepers`, `hkAssign`, `hkStart`,
`hkComplete`, `hkCancel`, `dismissHKNotification`.
New SSE listeners in `connectSSE`: `housekeeping_update`, `housekeeping_assign`, `housekeeping_cancel`.

#### 4. HousekeepingPanel (`client/src/components/HousekeepingPanel.jsx`) — NEW
Dual-mode component:

**Manager view** — two inner tabs:
- *Dirty Rooms*: grid of unassigned SERVICE rooms. Click to multi-select → pick housekeeper
  from dropdown → optional note → Assign button.
- *Active Assignments*: table of all pending/in_progress tasks with status badges and Cancel button.

**Housekeeper view**:
- Personal task list (pending + in_progress) shown as card-based UI.
- "🧹 Start" button → in_progress. "✅ Mark Done" button → complete + reset + VACANT.
- Confirmation dialog on "Mark Done" explains the room will be reset.

#### 5. DashboardPage (`client/src/pages/DashboardPage.jsx`)
- Imports `HousekeepingPanel` and `BedDouble` icon.
- New "Housekeeping" tab visible to all staff roles including `housekeeper`.
- Housekeepers land directly on the housekeeping tab (redirected by `useEffect`).
- Tab badge: pending count for managers; own-pending count for housekeepers.
- Real-time assignment notification toasts: amber card at top-right with room info, manager name,
  and note. Clicking navigates to the housekeeping tab.
- `roleLabels` updated to include `'housekeeper': 'Housekeeper'`.

#### 6. UsersPanel (`client/src/components/UsersPanel.jsx`)
- Added `housekeeper` to `ROLE_LABELS` and `ROLE_COLORS` (amber badge).
- Added "Housekeeper" option to the role dropdown in the create-user form.
- Default new-user role changed to `housekeeper` (most common new account type).

---

## Session: 2026-03-11 (Part 2) — Self-Booking System, Hotel Profile Management

### Summary
Added a complete guest self-booking system allowing guests to book rooms directly from a public page without staff involvement. Hotel owners can configure their public profile, upload room type images, and toggle online booking on/off.

---

### Changes Made

#### 1. Database Schema (`server/db.js`)
Added three new tables:
- **`hotel_profiles`** — hotel public info: description (EN/AR), location (EN/AR), phone, email, website, amenities (JSON), check-in/out times, currency, booking toggle, booking terms, hero image URL
- **`room_type_images`** — gallery images per room type with caption and sort order
- **`room_type_info`** — room type descriptions (EN/AR), max guests, bed type, area (m²), amenities (JSON)

#### 2. Public Booking APIs (`server/index.js`)
- **`GET /api/public/book/:slug`** — returns hotel profile, room types with rates, images, and descriptions
- **`GET /api/public/book/:slug/availability`** — checks room availability for a date range using interval overlap query
- **`POST /api/public/book/:slug`** — creates a self-booking reservation (rate-limited: 10/15min per IP)
  - Auto-assigns an available room of the requested type
  - Creates reservation + income log entry
  - Marks room NOT_OCCUPIED and fires checkIn event scenes
  - Returns room code (6-digit), guest portal URL, and booking summary

#### 3. Hotel Profile Management APIs (`server/index.js`)
- **`GET /api/hotel/profile`** — owner fetches profile, room type info, and images
- **`PUT /api/hotel/profile`** — owner updates hotel public information
- **`PUT /api/hotel/room-type-info/:roomType`** — owner updates room type descriptions
- **`POST /api/hotel/room-type-images/:roomType`** — owner uploads room type images (multer, 5MB max)
- **`DELETE /api/hotel/room-type-images/:id`** — owner deletes room type image (removes file)
- **`POST /api/hotel/hero-image`** — owner uploads hotel hero/cover image

#### 4. HotelInfoPanel (`client/src/components/HotelInfoPanel.jsx`)
New owner-only tab in the staff dashboard for managing:
- Online booking toggle (disabled by default)
- Hotel description, location, phone, email, website (bilingual EN/AR)
- Amenity selector (WiFi, Pool, Gym, Spa, Restaurant, etc.)
- Hero image upload with preview
- Check-in/out times, currency, booking terms
- Room type editor per type: description, bed type, max guests, area, image gallery

#### 5. BookingPage (`client/src/pages/BookingPage.jsx`)
Public page at `/book/:slug` with a 3-step booking wizard:
1. **Date selection** — check-in/out date pickers with night count
2. **Room type selection** — cards with image carousel, per-night pricing, amenity badges, bed type, area, live availability count
3. **Guest information** — name (required), email, phone
4. **Confirmation** — shows assigned room number, room code, guest portal link, total cost

Features: bilingual EN/AR toggle, responsive layout, mobile-friendly.

#### 6. Routing (`client/src/App.jsx`)
Added public route: `<Route path="/book/:slug" element={<BookingPage />} />`

#### 7. Dashboard Tab (`client/src/pages/DashboardPage.jsx`)
Added "Hotel Info" tab (Hotel icon) visible to owner role only.

#### 8. i18n (`client/src/i18n.js`)
Added `tab_hotelinfo` key (AR: بيانات الفندق / EN: Hotel Info).

---

### Commits

| Hash | Message |
|------|---------|
| `1ed35da` | feat: self-booking system — public booking page, hotel profile management, room type images |

---

### Files Changed

| File | Change |
|------|--------|
| `server/db.js` | `hotel_profiles`, `room_type_images`, `room_type_info` table schemas |
| `server/index.js` | Public booking APIs (3 endpoints); profile management APIs (6 endpoints); multer image upload |
| `client/src/pages/BookingPage.jsx` | New: 3-step public booking wizard with image carousel and confirmation |
| `client/src/components/HotelInfoPanel.jsx` | New: owner panel for hotel profile and room type management |
| `client/src/pages/DashboardPage.jsx` | Added Hotel Info tab for owner role |
| `client/src/App.jsx` | Added `/book/:slug` public route |
| `client/src/i18n.js` | Added `tab_hotelinfo` translation key |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Booking disabled by default | Owners must explicitly enable after configuring their profile — prevents incomplete public pages |
| Rate-limited public booking endpoint | 10 requests per 15 min per IP prevents abuse without requiring CAPTCHA |
| Auto room assignment | Guest picks room type, system assigns specific room — avoids conflicts and simplifies UX |
| Separate tables for profile/images/info | Normalized schema allows multiple images per room type and independent updates |
| Reuse existing reservation logic | Self-booking creates the same reservation + income_log rows as staff PMS — no separate booking system |
| No payment gateway yet | Uses `payment_method: 'pending'` — can integrate Stripe/PayTabs/HyperPay later without schema changes |

---

---

## Session: 2026-03-11 — Admin Room Reservation, Command Debounce, Consumption Dashboard

### Summary
This session covered five areas:
1. **Admin room reservation from modal** — staff can create reservations directly from the RoomModal for vacant rooms
2. **Doorlock UX improvements** — visual feedback and safety controls for door unlock flow
3. **DND/MUR mutual exclusivity** — activating DND auto-cancels MUR and vice versa, enforced on both client and server
4. **Command feedback & debounce system** — UI updates instantly but actual server RPC calls are debounced by 500ms to prevent command failures from rapid interactions
5. **Consumption dashboard** — utility cost configuration, total hotel consumption view, and per-room cost calculations in the Finance panel

---

### Changes Made

#### 1. Reserve Room from RoomModal (`client/src/components/RoomModal.jsx`, `client/src/pages/DashboardPage.jsx`)
**Change:** When a staff member opens a RoomModal for a VACANT room with no active reservation, a "Reserve Room" button is shown. Clicking it closes the modal and navigates to the PMS tab with the room number pre-filled.

- Added `onReserveRoom` callback prop to RoomModal
- DashboardPage passes a handler that switches to the PMS tab and sets `prefillRoom` state
- PMSPanel receives `prefillRoom` prop and auto-populates the room field in the reservation form

#### 2. Doorlock UX & "Sent!" Confirmation (`client/src/components/RoomModal.jsx`)
**Change:** After pressing the door unlock button:
- Button shows countdown text: "Sent — locking in Xs"
- A green "Sent!" confirmation banner with checkmark appears for 2.5 seconds
- Auto-lock fires after 5 seconds if door is still closed

#### 3. DND/MUR Mutual Exclusivity (`server/index.js`, `client/src/components/RoomModal.jsx`, `client/src/store/hotelStore.js`)
**Change:** Activating DND automatically clears MUR, and vice versa. Enforced at three levels:
- **Server** (`controlToTelemetry`): if `dndService=true`, sets `murService=false` and vice versa
- **Client optimistic update** (`applyOptimistic` in RoomModal + `applyLocal` in hotelStore): same logic
- **Guest path**: same logic in the guest optimistic update

#### 4. Command Feedback System — Server Verification (`server/index.js`)
**Change:** After `sendControl()` writes shared attributes to ThingsBoard, a non-blocking 2-second timer verifies that the device received the values by reading back shared attributes. Result is broadcast as an SSE `command-ack` event:
```json
{ "room": "101", "method": "setAC", "success": true, "message": "confirmed" }
```
- Client stores acks in `commandAcks` array in hotelStore (auto-removed after 4 seconds)
- SSE listener added for `command-ack` events

#### 5. Command Debounce System — 500ms (`client/src/components/RoomModal.jsx`)
**Change:** Replaced direct `rpc()` / `api()` calls in `send()` with a debounced architecture:
- **Optimistic UI updates** fire immediately via `applyOptimistic()` — user sees changes in real-time
- **Server RPC calls** are debounced by 500ms per method type (`setLines`, `setAC`, `setCurtainsBlinds`, `setService`)
- Params are **merged** across rapid calls — e.g., dragging a dimmer from 0→80 sends one final call with `dimmer1: 80`
- **Immediate methods** (not debounced): `setDoorUnlock`, `setDoorLock`, `resetServices`, `setRoomStatus`, `setPDMode`
- Pending commands are **flushed on unmount** so nothing is lost when the modal closes

#### 6. Utility Costs & Consumption Dashboard (`server/index.js`, `server/db.js`, `client/src/components/FinancePanel.jsx`)
**Change:** Added utility cost management and hotel-wide consumption tracking:
- **DB**: new `utility_costs` table with `hotel_id`, `cost_type` (kwh/m3), `cost_per_unit`, `updated_by`
- **API**: `GET/PUT /api/finance/utility-costs` — owner can set cost per kWh and cost per m³
- **API**: `GET /api/hotel/consumption` — returns total kWh, total m³, cost rates, and calculated total costs summed from all room meters in the in-memory cache
- **FinancePanel**: new "Consumption" section showing total electricity (kWh), total water (m³), per-unit costs (editable), and total estimated costs in SAR

#### 7. KPI Row Consumption Display (`client/src/components/KPIRow.jsx`)
**Change:** Added total electricity and water consumption KPI cards to the dashboard header, visible to owner and admin roles. Values are summed from all rooms in the store.

#### 8. i18n Updates (`client/src/i18n.js`)
Added translation keys: `rm_reserve_room` (AR: حجز الغرفة), `rm_reserve_room_num` (AR: حجز الغرفة {room}).

---

### Commits

| Hash | Message |
|------|---------|
| `56b09c1` | feat: room reservation from modal, doorlock UX, DND/MUR exclusivity, command feedback, consumption dashboard |
| `711dd7d` | Add command debounce system for room controls (500ms) |

---

### Files Changed

| File | Change |
|------|--------|
| `server/index.js` | DND/MUR exclusivity in `controlToTelemetry`; command-ack verification timer in `sendControl`; utility costs CRUD endpoints; hotel consumption endpoint |
| `server/db.js` | `utility_costs` table schema |
| `client/src/components/RoomModal.jsx` | Reserve button for vacant rooms; doorlock sent confirmation; debounce system with `fireRpc`, `applyOptimistic`, merged pending params; DND/MUR exclusivity |
| `client/src/components/PMSPanel.jsx` | `prefillRoom` prop to auto-populate room field |
| `client/src/components/FinancePanel.jsx` | Consumption section with utility cost editor and hotel-wide totals |
| `client/src/components/KPIRow.jsx` | Electricity and water consumption KPI cards |
| `client/src/pages/DashboardPage.jsx` | `onReserveRoom` handler; `prefillRoom` state wired to PMSPanel |
| `client/src/store/hotelStore.js` | `commandAcks` state; `command-ack` SSE listener; DND/MUR exclusivity in `applyLocal` |
| `client/src/i18n.js` | `rm_reserve_room`, `rm_reserve_room_num` keys |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Debounce per method, not per control | Merging all params for the same method (e.g., multiple `setLines` calls) into one server call avoids race conditions and reduces load |
| Flush on unmount | User closing the modal should not discard their last adjustment — always send the final state |
| 500ms debounce interval | Fast enough that the user doesn't notice delay; slow enough to batch rapid slider drags into a single command |
| DND/MUR exclusivity at 3 levels | Server is the source of truth, but client-side enforcement gives instant feedback without waiting for server roundtrip |
| Command-ack via SSE | Non-blocking verification — doesn't slow down the control flow; UI can optionally show confirmation/warning badges |
| Utility costs in separate table | Decoupled from room rates; per-hotel scoping; easy to extend with more cost types later |

---

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

---

---

## Session: 2026-03-09 — Scenes Engine, UX Polish, Heatmap Redesign, Simulator Fix

### Summary
This session covered several major improvements and bug fixes:
1. **Scenes engine** — time/status/sensor triggered automations with "apply to all rooms"
2. **Heatmap redesign** — floor-box mode with SVG arc charts + original rooms mode toggle
3. **Force-close shift modal** — collects actual Cash/Visa amounts and compares to expected
4. **Simulator virtual mode** — works without ThingsBoard device mapping
5. **Bug fixes** — Arabic login default, table column alignment, room status label

---

### Changes Made

#### 1. Scenes Engine (`server/index.js`, `client/src/components/ScenesPanel.jsx`)
Added a full automation scenes engine with CRUD API (`GET/POST/PUT/DELETE /api/scenes`) and manual trigger endpoint. Scenes support three trigger types: time-of-day, room status change, and sensor threshold.

**"Apply to all rooms" checkbox** added to the scene builder modal. When checked, the room input is disabled and `handleSave` iterates over all hotel rooms, creating the scene for each.

#### 2. Heatmap Floor Boxes (`client/src/components/Heatmap.jsx`)
Complete redesign. Two modes toggled by a `⊞ Floors / ⊟ Rooms` button:

- **Floors mode** (default): grid of 120×130px floor summary boxes. Each box shows:
  - SVG `ArcProgress` component — circular arc indicating % vacancy, coloured green/amber/red
  - Vacant room count and breakdown by type (Std/Dlx/Ste/VIP)
  - Alert badges: 🚨SOS, 🧹MUR, ⚡PD counts
  - Click to expand and see individual rooms for that floor inline below the box
- **Rooms mode**: original all-rooms heatmap grid with configurable column count and keyboard room search overlay

#### 3. Force-Close Shift Modal (`client/src/components/ShiftsPanel.jsx`, `server/index.js`)
Replaced the `confirm()` dialog with a full modal:
- `openForceClose(shift)` fetches shift entries to calculate expected Cash and Visa amounts
- Modal displays expected amounts (in blue), then collects actual Cash, actual Visa, and optional notes
- `submitForceClose()` POSTs to `/api/shifts/:id/force-close` with actual amounts
- Server calculates discrepancy (`diffCash`, `diffVisa`) and stores all four values

Updated `/api/shifts/:id/force-close` to accept `{ actualCash, actualVisa, notes }` in the request body and persist them properly.

#### 4. Simulator Virtual Mode (`server/index.js`, `client/src/components/SimulatorPanel.jsx`)
Fixed the simulator to work without a ThingsBoard device mapping:
- Updates `_lastOverviewRooms[room]` directly so the in-memory state reflects simulated values
- Calls `detectAndLogChanges` to trigger any matching scenes/automation
- Broadcasts SSE `telemetry` event to all connected dashboards
- If a real TB device is mapped, also writes to ThingsBoard (best-effort, non-blocking)
- Returns `{ mode: 'hardware' | 'virtual' }` in the response

Changed the "Room not found" red error in `SimulatorPanel.jsx` to an amber info notice: "Virtual room — no physical device. SSE broadcast only (great for testing!)."

#### 5. Login Page Arabic Default (`client/src/pages/LoginPage.jsx`)
Changed from reading `useLangStore()` (which persists the last-used language) to a local `useState('ar')` so the login page always opens in Arabic, regardless of any stored preference.

Added `useEffect` to sync `document.documentElement.dir/lang` with the local state.

#### 6. Room Table: Guest Name Column + Column Alignment (`client/src/components/RoomTable.jsx`)
- Added `dir="ltr"` to the `<table>` element to fix header/data column misalignment in RTL layouts
- Added a **Guest** column (`rt_guest` i18n key) after the Status column showing `reservation.guestName`

#### 7. Room Status Label Fix (`client/src/i18n.js`)
Changed `rm_not_occupied` label:
- Before: `'🟣 الغرفة محجوزة - لم يصل الضيف بعد'` / `'🟣 Room Reserved - Guest not checked in yet'`
- After: `'🟣 الغرفة محجوزة'` / `'🟣 Room Reserved'`

Removed the "guest hasn't arrived" qualifier because NOT_OCCUPIED also covers the low-power mode state (guest inactive 5 min).

#### 8. Mobile Tab Bar (`client/src/pages/DashboardPage.jsx`)
Made the dashboard tab navigation scrollable horizontally on small screens using `overflow-x-auto` with `scrollbar-none` CSS. Tab buttons use `whitespace-nowrap` and `min-w-max` to prevent wrapping.

---

### Commits

| Hash | Message |
|------|---------|
| `79462c0` | feat: scenes engine, password reset, NOT_OCCUPIED guard, CI/CD deploy |
| *(pending)* | feat: heatmap floor boxes, force-close modal, simulator virtual mode, UX fixes |

---

### Files Changed

| File | Change |
|------|--------|
| `server/index.js` | Scenes CRUD + engine; force-close body params; simulator virtual mode |
| `client/src/components/Heatmap.jsx` | Complete rewrite — floor boxes with SVG arcs + rooms mode toggle |
| `client/src/components/ShiftsPanel.jsx` | Force-close modal with actual amount input and discrepancy display |
| `client/src/components/ScenesPanel.jsx` | "Apply to all rooms" checkbox in scene builder |
| `client/src/components/SimulatorPanel.jsx` | Virtual room amber notice instead of red error |
| `client/src/components/RoomTable.jsx` | `dir="ltr"` fix; Guest name column |
| `client/src/pages/LoginPage.jsx` | Local `useState('ar')` — always opens in Arabic |
| `client/src/pages/DashboardPage.jsx` | Scrollable mobile tab bar |
| `client/src/i18n.js` | Removed "guest hasn't arrived" from NOT_OCCUPIED label; added `rt_guest` key |
| `README.md` | Full update with all new features, scenes section, new API endpoints |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Local state for login language | Prevents stored language preference from changing the login page; always Arabic for this hotel's staff |
| `dir="ltr"` on table element | In RTL document context, table column order reverses; forcing LTR on the table alone fixes alignment without affecting surrounding UI |
| Virtual simulator mode | Enables end-to-end testing of automation, SSE, and scenes without physical IoT hardware |
| Floor boxes as default heatmap | 600-room hotel makes individual room grid cluttered; floor summary with expand is more actionable at a glance |
| Force-close requires actual amounts | Prevents lazy shift closing; discrepancy is logged and visible in shift history for accountability |
