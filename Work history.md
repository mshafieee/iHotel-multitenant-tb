# iHotel Platform — Work History

---

## Session: 2026-04-01 — Multi-IoT Platform Integration + Dynamic Device UI + Reliability Improvements

### Summary

Seven features delivered on branch `ihotel-greentech-api`. The headline feature is a universal IoT adapter layer enabling iHotel to support multiple physical GRMS/IoT platforms — currently ThingsBoard CE/Cloud and Greentech GRMS — selected per hotel at creation time with no code changes needed.

---

### 1. IoT Adapter Layer (Platform-Agnostic Architecture)

**New files**: `server/adapters/platform-adapter.js`, `server/adapters/tb-adapter.js`, `server/adapters/greentech-adapter.js`, `server/adapters/index.js`

`PlatformAdapter` base class defines the standard interface:
- `authenticate()` / `isAuthenticated()`
- `listDevices()` → `[{ id, name, roomNumber }]`
- `getDeviceState(id, keys)` → flat telemetry object
- `getAllDeviceStates(ids, keys)` → `{ id: rawState }`
- `getDeviceAttributes(id, keys)` → flat attributes object
- `sendTelemetry(id, payload)` / `sendAttributes(id, payload)`
- `subscribe(deviceIdToRoom, onUpdate)` → handle with `.close()`
- `verifyCommand(id, expected)` → boolean
- `getCapabilities()` → `{ realtime, sensors, meters, commandVerify, offlineScenes, relayAttributes, doorLock }`
- `getDeviceConfig(firstRoomId)` → `{ lamps, dimmers, ac, curtains, blinds, lampNames[], dimmerNames[] }`
- `getWsToken()` / `getWsUrl()`

**TBAdapter** — wraps ThingsBoard CE/Cloud REST + WebSocket:
- JWT auth with 58-min token cache
- Paginated device list (100/page), filters `gateway-room-*` naming
- Real-time via WebSocket subscription (batched in 100-cmd chunks)
- Command verification via SHARED_SCOPE attribute read at +2s
- Static `getDeviceConfig()` returns standard 3-lamp/2-dimmer defaults

**GreentechAdapter** — wraps Greentech GRMS REST:
- Token auth via `POST /loginByRemote`
- GET-with-body pattern (`axios data:` field) for `/mqtt/room/list2` and `/mqtt/room/device/list2`
- Device groups: `d[]` = lamps, `tgd[]` = dimmers, `wk[]` = AC, `cl[]` = curtains, `cj[]` = sensors (empty), `fw[]` = service flags
- Chinese field values translated on read and write (e.g. `"制冷"` ↔ `acMode: 2`)
- Control via `PUT /mqtt/room/device` with `id` (lowercase), `turn`, `modern`, `temperature`, `fatSpeed`, `certain`, `brightness`
- Poll-based subscription (no WebSocket available) — 10s interval
- `getDeviceConfig(firstRoomId)` fetches real device groups to return actual lamp/dimmer counts and names

**Adapter pool** (`server/adapters/index.js`):
- `createPool()` — lazy-instantiates one adapter per hotel based on `hotels.platform_type`
- `getAdapter(hotelId)` — used throughout services

**DB migration 033** (`server/db.js`): `platform_type TEXT DEFAULT 'thingsboard'` on `hotels` table
**DB migration 034**: `device_config TEXT DEFAULT NULL` on `hotels` table

---

### 2. Dynamic Device UI

**Problem**: RoomModal had hardcoded 3 light circuits and 2 dimmers, regardless of what the actual hotel hardware had.

**Solution**: `device_config` JSON stored per hotel in the database, populated automatically on "Discover Rooms". The UI renders exactly what the hardware has.

**`server/platform.js`** — after discovering rooms, calls `adapter.getDeviceConfig(devices[0].id)` and saves result to `hotels.device_config`.

**`server/index.js`**:
- Login endpoint: reads and returns `device_config` in user object
- `/api/auth/me`: same
- `/api/guest/room`: includes `device_config` for guest portal
- `PUT /api/hotel/device-names` (owner/admin): updates `lampNames[]` and `dimmerNames[]` in `device_config` without overwriting counts

**`client/src/components/RoomModal.jsx`**:
- Accepts `deviceConfig` prop (guest portal) OR reads from `authStore` (dashboard)
- `lampKeys = Array.from({ length: cfg.lamps }, (_, i) => \`line${i + 1}\`)`
- `dimmerKeys = Array.from({ length: cfg.dimmers }, (_, i) => \`dimmer${i + 1}\`)`
- `lampLabel(i)` uses `cfg.lampNames[i]` with fallback to i18n static labels
- `dimmerLabel(i)` uses `cfg.dimmerNames[i]` with fallback
- AC section conditional on `cfg.ac > 0`; curtains/blinds conditional on `cfg.curtains/blinds > 0`
- Guest view grid: `grid-cols-2` if ≤2 lamps, else `grid-cols-3`

**`client/src/pages/GuestPortal.jsx`**: stores `deviceConfig` from `/api/guest/room` response and passes as prop to `RoomModal`.

**`client/src/pages/DashboardPage.jsx`**: passes `user?.deviceConfig` as prop to `RoomModal`.

---

### 3. TB Hotels — Default device_config Seeding

ThingsBoard hotels that haven't run "Discover Rooms" now get a default `device_config` automatically on first login or `/api/auth/me` call:
```json
{ "lamps": 3, "dimmers": 2, "ac": 1, "curtains": 1, "blinds": 1,
  "lampNames": ["Line 1 (Main)", "Line 2 (Bedside)", "Line 3 (Bath)"],
  "dimmerNames": ["Dimmer 1", "Dimmer 2"] }
```
This ensures the Room Device Names editor in Hotel Info is available immediately without requiring a superadmin sync.

---

### 4. Owner-Customizable Room Device Names

**`client/src/components/HotelInfoPanel.jsx`** — new "Room Device Names" section:
- Editable text input per lamp circuit and per dimmer
- Save calls `PUT /api/hotel/device-names`
- Authstore updated optimistically on save
- Works for both ThingsBoard and Greentech hotels

---

### 5. Greentech Control Reliability Fixes

**`server/adapters/greentech-adapter.js`**:

**Bug 1 — Wrong field name**: Control API required lowercase `id`, not `Id`. Uppercase returned `{"code":500,"msg":null}`.

**Bug 2 — Only 3 lamps mapped**: `_buildTBFormat()` had hardcoded `line1`/`line2`/`line3` cap. Removed — now maps all `d[]` entries dynamically via index.

**Bug 3 — Lamp/dimmer keys not matched in `_translateToGreentechCommands()`**: Changed from exact key checks to regex `/^line\d+$/` and `/^dimmer\d+$/` — supports any count.

**Additional mappings added**:
- `powerStatus` → `pdMode` (card power / power-down mode)
- `airStatus` → `acRunning` (AC unit actively running, separate from setpoint)

---

### 6. Stale Lighting Status Fix (Poll Reliability)

**Root Cause 1**: `_deviceCache` in `GreentechAdapter` cached device group state (lamp `turn`, AC `modern`, etc.) forever. The 10s poller called `getAllDeviceStates()` → returned cached data → compared against same data → detected no changes → nothing broadcast.

**Root Cause 2**: After sending a control command, the stale cache persisted, so the next poll still returned old state.

**Fixes in `server/adapters/greentech-adapter.js`**:

1. `this._deviceCache.clear()` at the top of every poll cycle — forces fresh device state from API each round.

2. Poll interval: `30000` → `10000` ms (10s). 6 rooms × 1 API call each = 6 requests/cycle — manageable.

3. Post-command re-poll: after `_sendControl()` completes, `_schedulePostCommandPoll(hostId, 2000)` fires 2s later:
   - Deletes that room's device cache entry
   - Re-fetches room list and device groups
   - Calls `onUpdate(roomNum, hostId, flat)` → triggers SSE broadcast with confirmed state
   - Updates `_lastPollState` baseline so next regular poll doesn't re-broadcast the same data

4. `subscribe()` stores `onUpdate` and `deviceIdToRoom` as instance properties so `_schedulePostCommandPoll` has access. Cleaned up on `close()`.

**Result**: Lamp/AC state reflects real device state within ≤10s at rest, and within ~2s after a command.

---

### 7. Modern Dashboard Tab Bar

**`client/src/pages/DashboardPage.jsx`** — tab navigation redesigned:

| | Before | After |
|---|---|---|
| Style | Flat `border-b-2` underline | Filled pill (`rounded-xl`) |
| Active state | Brand-colored text + underline | Solid brand-color background + shadow |
| Inactive state | Gray text, no hover feedback | Ghost with `hover:bg-gray-100` highlight |
| Badges | Absolute-positioned blob `-top-0.5 -right-0.5` | Inline pill inside button label |
| Icon weight | Fixed `strokeWidth` | `2.5` on active, `1.8` on inactive |
| Bar behavior | Static, scrolls away | `sticky top-0 z-30` + `backdrop-blur-md bg-white/80` |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Adapter pattern with base class | Core services (`control.service`, `room.service`) are IoT-platform-agnostic; adding a new platform requires only a new adapter file |
| Per-hotel `platform_type` in DB | Single server can mix ThingsBoard and Greentech hotels simultaneously |
| GET-with-body for Greentech | Greentech API requires JSON body on GET endpoints; `axios data:` field sends it correctly |
| Chinese string mapping tables | Greentech returns/accepts Chinese characters for device states; translation tables at adapter top prevent Chinese values ever leaking to iHotel's internal API or UI |
| `device_config` in hotels table | Single JSON blob; updated by "Discover Rooms" (real counts) or owner (custom names); avoids a separate device topology table |
| Post-command 2s re-poll | Greentech has no WebSocket push; the 2s delay gives the RCU time to apply the command before the confirmation read |
| Clear `_deviceCache` per poll | Simpler than TTL-based expiry; guarantees every poll cycle fetches fresh device state; acceptable API load at 10s interval |

---

### Files Changed

| File | Change |
|------|--------|
| `server/adapters/platform-adapter.js` | New — base adapter interface |
| `server/adapters/tb-adapter.js` | New — ThingsBoard REST + WebSocket adapter |
| `server/adapters/greentech-adapter.js` | New — Greentech GRMS adapter with full control, poll, config |
| `server/adapters/index.js` | New — adapter pool (lazy per-hotel instantiation) |
| `server/services/room.service.js` | New — room lifecycle, fetchAndBroadcast, processTelemetry |
| `server/services/control.service.js` | New — sendControl, optimistic SSE, command verify |
| `server/services/sse.service.js` | New — SSE connection management, broadcast helpers |
| `server/services/state.service.js` | New — in-memory state (deviceRoomMap, lastKnownTelemetry, etc.) |
| `server/services/audit.service.js` | New — addLog helper |
| `server/services/scene-engine.js` | New — scene trigger evaluation |
| `server/db.js` | Migrations 033 (platform_type) + 034 (device_config) |
| `server/platform.js` | getDeviceConfig call on discover; Greentech hotel creation support |
| `server/index.js` | device_config in login+me+guest; PUT /api/hotel/device-names; TB seeding on login |
| `client/src/components/RoomModal.jsx` | Dynamic lamps/dimmers/AC/curtains from deviceConfig prop |
| `client/src/components/HotelInfoPanel.jsx` | Room Device Names editor section |
| `client/src/pages/GuestPortal.jsx` | Store + pass deviceConfig to RoomModal |
| `client/src/pages/DashboardPage.jsx` | Pass deviceConfig prop; modern pill tab bar |

---

## Session: 2026-03-29 — Upsell Engine + Channel Manager

### Summary
Two major revenue-focused features delivered on branch `feat-channel-manager` (continued from `feat-upsell-engine`):

**Upsell Engine** — complete in-room extras system: guest-facing catalog in the portal, staff fulfilment queue in PMS, owner catalog management with room-type visibility filters, service statistics dashboard, bilingual Arabic/English support.

**Channel Manager** — OTA sync infrastructure: iCal feed export (RFC 5545), webhook receiver for automated booking ingestion, per-channel config UI in Hotel Info, public server URL setting for generating shareable links.

---

### Upsell Engine

#### 1. Database (`server/db.js`)
- **Migration 025**: `upsell_offers` — catalog table (hotel_id, name, name_ar, category, price, unit, active, sort_order)
- **Migration 026**: `reservation_extras` — guest request log (reservation_id, offer_id, quantity, status, note, staff_note, delivered_at)
- **Migration 027**: `room_types TEXT DEFAULT NULL` column on `upsell_offers` — NULL = all rooms, JSON array = specific types
- **Migration 029**: `thirdparty_channel` on `reservations` + `income_log` (safe ALTER TABLE with `table_info` guard)
- **Migration 030**: `checked_out_at` on `income_log`

#### 2. API (`server/index.js`)
12 new endpoints under `/api/upsell/`:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/upsell/catalog` | owner | Owner's full offer catalog |
| POST | `/api/upsell/catalog` | owner | Create offer with room_types filter |
| PATCH | `/api/upsell/catalog/:id` | owner | Update offer |
| DELETE | `/api/upsell/catalog/:id` | owner | Hard delete |
| GET | `/api/upsell/offers` | guest JWT | Offers filtered by guest's room type |
| GET | `/api/upsell/my-extras` | guest JWT | Guest's extras for active stay |
| POST | `/api/upsell/my-extras` | guest JWT | Request an extra |
| GET | `/api/upsell/pending` | any staff | All pending extras for hotel |
| GET | `/api/upsell/extras/:reservationId` | any staff | Extras for reservation |
| PATCH | `/api/upsell/extras/:id` | any staff | Confirm/deliver/decline + staff note |
| GET | `/api/upsell/stats` | owner | Per-offer request count totals |
| GET | `/api/upsell/stats/:offerId/rooms` | owner | Per-room breakdown for an offer |

Revenue flagged with `nights = 0` in `income_log` to distinguish from room revenue without schema changes.

#### 3. PMSPanel (`client/src/components/PMSPanel.jsx`)
- Amber **⊕ N pending** badge on each reservation card
- **Extras Drawer**: accordion with confirm / deliver / decline actions, staff note field, Quick Add form
- `thirdPartyChannel` field in create/extend forms
- SSE listeners: `upsell_request` + `upsell_update` → auto-refresh pending list

#### 4. Guest Portal — GuestExtrasWidget (`client/src/components/RoomModal.jsx`)
- `GuestExtrasWidget` lifted **outside** `RoomModal` to fix React closure anti-pattern (was causing full remount on every 5s poll)
- Offers grouped by category with emoji+label headers
- Manual ↻ Refresh button (no SSE auto-refresh to prevent flashing)
- Bilingual name/description with AR acronyms per category

#### 5. HotelInfoPanel (`client/src/components/HotelInfoPanel.jsx`)
- **Upsell Offers** card: CRUD with room-type pill checkboxes for visibility filtering
- **📊 Service Statistics** card: per-offer table with request counts, ▼ Details accordion per room

#### 6. UX Fixes
- Language toggle (EN/ع) added inside RoomModal sticky blue header (visible even when modal covers portal header)
- `truncate` → `break-words leading-snug` for offer names and staff notes (was clipping long text)

#### 7. i18n (`client/src/i18n.js`)
37 new `upsell_*` keys + payment picker keys in Arabic and English.

---

### Channel Manager

#### 1. Database (`server/db.js`)
- **Migration 031**: `channel_connections` table — id, hotel_id (FK), name, type, webhook_secret, api_key, ical_token (random UUID), last_sync_at, active, notes
- **Migration 032**: `public_url TEXT DEFAULT NULL` column on `hotel_profiles` — owner sets their VPS domain so iCal/webhook URLs are shareable

#### 2. API (`server/index.js`)
6 new endpoints:

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/channel/ical/:hotelId/:token.ics` | token | RFC 5545 iCal feed — all reservations as BLOCKED events |
| POST | `/api/channel/webhook/:channelId` | HMAC-SHA256 | Receive OTA booking, validate signature, auto-assign room, create reservation |
| GET | `/api/channel/connections` | JWT | List channels for hotel |
| POST | `/api/channel/connections` | owner/admin | Create channel (generates `ical_token` via `crypto.randomUUID()`) |
| PATCH | `/api/channel/connections/:id` | owner/admin | Update name, secret, active, notes |
| DELETE | `/api/channel/connections/:id` | owner/admin | Delete channel |

Webhook receiver reuses availability overlap query from public booking. Auto-assigns lowest floor available room. Sets `payment_method = 'thirdparty'` + `thirdparty_channel = channel.name`. Broadcasts `channel_booking` SSE event.

`PUT /api/hotel/profile` updated to accept and persist `publicUrl`.

#### 3. HotelInfoPanel — Channels Tab (`client/src/components/HotelInfoPanel.jsx`)
- **General settings**: new "Public Server URL" input field (owner enters `https://hotel.example.com` once)
- **Channels section**: per-channel cards with:
  - iCal URL (read-only + 📋 Copy) — uses `publicUrl` from profile, falls back to `window.location.origin`
  - Webhook URL (read-only + 📋 Copy)
  - Webhook secret (masked, reveal toggle)
  - Active toggle, edit/delete buttons
  - Collapsible setup instructions for Booking.com / Airbnb / Expedia
- **Warning banner** when `publicUrl` is not set: guides owner to configure it before sharing URLs

#### 4. Zustand Store (`client/src/store/hotelStore.js`)
- `channels: []` state
- `fetchChannels`, `createChannel`, `updateChannel`, `deleteChannel` actions

#### 5. i18n (`client/src/i18n.js`)
20 new `channel_*` keys in Arabic and English.

#### 6. Bug fix
`auth` → `authenticate` (correct middleware name imported from `./auth`) in all 4 channel CRUD routes — server crashed on start without this fix.

---

### Landing Page Updates (`client/src/pages/LandingPage.jsx`)
- New hero slide: "Sync Your Rooms to Every OTA in Real-Time" (EN + AR, rose/pink/fuchsia accent)
- Features list: replaced 2 generic items with **Channel Manager** and **Upsell Engine** cards (both EN + AR)
- CTA sub-text updated to mention Channel Manager and Upsell Engine

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| iCal pull model | Zero OTA-specific API keys needed; every major OTA supports RFC 5545; no periodic jobs required |
| `ical_token` in URL path | Secures the public iCal endpoint without requiring authentication; each channel has a unique random token |
| HMAC-SHA256 webhook validation | Standard OTA pattern; prevents replay attacks; webhook_secret stored per channel |
| `public_url` on hotel_profiles | iCal/webhook URLs must use the public domain, not `localhost:5173`; owner sets it once in General settings |
| `nights = 0` for extras in income_log | Revenue tracking without schema changes; Finance panel sums naturally; can be filtered by nights field |
| Component lifted outside RoomModal | React sees a new component type on every render when defined inside a function — causes full remount/flash; top-level declaration fixes this |

---

### Files Changed

| File | Change |
|------|--------|
| `server/db.js` | Migrations 025–032: upsell tables, channel_connections, public_url |
| `server/index.js` | 12 upsell endpoints + 6 channel endpoints + auth middleware fix + profile publicUrl |
| `server/platform.js` | Hotel creation seeds default upsell offers |
| `client/src/components/PMSPanel.jsx` | Extras drawer, pending badge, thirdPartyChannel, SSE listeners |
| `client/src/components/RoomModal.jsx` | GuestExtrasWidget lifted out, language toggle, text wrapping fix |
| `client/src/components/HotelInfoPanel.jsx` | Upsell catalog CRUD, service stats, channels section, publicUrl field |
| `client/src/components/FinancePanel.jsx` | `checked_out_at` display, color-coded payment badges, thirdparty_channel label |
| `client/src/pages/DashboardPage.jsx` | PMS tab badge includes upsell pending count |
| `client/src/pages/GuestPortal.jsx` | Language toggle (superseded by RoomModal toggle) |
| `client/src/store/hotelStore.js` | upsellPending state+actions, channels state+actions, SSE listeners |
| `client/src/i18n.js` | 37 upsell_* keys + 20 channel_* keys + payment picker keys (EN + AR) |
| `client/src/pages/LandingPage.jsx` | New Channel Manager hero slide, updated features list, updated CTA |

---

## Session: 2026-03-26 — Landing Page Redesign + Maintenance Ticket Tracking

### Summary
Two major feature branches delivered:

**Part 1 — Landing Page Redesign (`claude/complete-previous-session-fe9mo`)**
Full overhaul of `LandingPage.jsx`: dynamic hero carousel driven by scroll (not time), modern CSS
animations, scroll-reveal for every section, auto-rotating testimonials, and complete Arabic/English
bilingual support. Fixed several text readability issues (too-small font sizes throughout).

**Part 2 — Maintenance Ticket Tracking System (`claude/complete-previous-session-fe9mo`)**
Full end-to-end maintenance ticketing: housekeepers open tickets from their task list, admins track
and resolve them in a new Maintenance dashboard tab with live open-ticket badge.

---

### Part 1 — Landing Page Redesign

#### 1. Animations (`client/src/index.css`)
12 new `@keyframes` blocks: `fadeIn`, `fadeUp`, `slideLeft`, `slideRight`, `scaleIn`,
`gradientShift`, `gradientFlow`, `particleFloat`, `counterFade`, `progressBar`, `floatCard`,
`shimmerText`. Scroll-reveal base classes (`.reveal`, `.reveal-left`, `.reveal-right`,
`.reveal-scale`) toggled to `.visible` via `IntersectionObserver`. Stagger delay utilities
`.d1`–`.d8`. Utility classes: `.gradient-text-flow`, `.hero-bg`, `.impact-bg`, `.float-card`.

#### 2. Hero Section — Scroll-Driven Carousel
- Hero section is now `400vh` tall with `position: sticky` inner content at `100vh`.
- Scroll position is read via `window.scroll` + `getBoundingClientRect()` to derive `slideIdx`
  (0–3) and `slideProgress` (0–100) — no `setInterval`, no auto-advance.
- 4 slides in both EN and AR, each with badge, two headline lines, sub-text, accent gradient, and
  a mockup key (`dashboard` / `guest` / `pms`).
- Dots navigate by calling `window.scrollTo()` to the correct position within the sticky section.
- Progress bar width driven by `slideProgress` state (not CSS animation).

#### 3. Components Added to LandingPage
- `FloatingParticles` — 22 deterministic floating particles (no `Math.random()`, no flicker).
- `AnimatedStat` — number reveal on scroll via `IntersectionObserver` (threshold 0.5).
- `TestimonialsCarousel` — 6-second auto-advance, `key={page}` fade, staggered card `fadeUp`,
  prev/next buttons, dot indicators, animated progress bar.

#### 4. Scroll-Reveal Integration
`useScrollReveal()` hook attaches `IntersectionObserver` (threshold 0.12) to all elements with
`.reveal`, `.reveal-left`, `.reveal-right`, `.reveal-scale` classes. Stagger delays via `.d1`–`.d8`.
Applied to: Features cards (8 items), Impact stats, Showcase mockups, CTA, Footer.

#### 5. Text Readability Fixes
All illegibly small text sizes replaced:
- Pills / badges: `text-[11px]` → `text-sm`
- Showcase labels: `text-[9px]` → `text-xs`
- Stats labels: `text-[10px]` → `text-xs`
- Testimonial sub-text: `text-[10px]` → `text-xs`
- Feature badges: `text-[10px]` → `text-xs`
- Login modal hints: `text-[10px]`/`text-[11px]` → `text-xs`

#### 6. Arabic/English Bilingual
`dir={isRTL ? 'rtl' : 'ltr'}` on root div, Cairo font for Arabic, RTL-aware arrow icons
(`ChevronRight rotate-180`), `goToSlide` scroll offset resets on language change.

---

### Part 2 — Maintenance Ticket Tracking System

#### 1. Database (`server/db.js`)
Migration `024_maintenance_tickets`: new `maintenance_tickets` table.
Schema: `id`, `hotel_id (FK)`, `room_number`, `category` (AC / Plumbing / Electrical / Furniture /
Cleaning / Other), `description`, `priority` (low / medium / high / urgent), `status`
(open / in_progress / resolved), `reported_by`, `assigned_to`, `notes`, `created_at`,
`updated_at`, `resolved_at`.

#### 2. API (`server/index.js`)
Four new endpoints under `/api/maintenance`:

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/maintenance` | all staff | Managers see all tickets; housekeepers see only their own. Optional `?status=` filter. |
| POST | `/api/maintenance` | all staff | Open new ticket. Validates category + priority. SSE broadcast to managers. |
| PATCH | `/api/maintenance/:id` | all staff | Managers: update status/assignment/notes/priority. Housekeepers: edit description only if open. Sets `resolved_at` when status→resolved. SSE broadcast to managers and reporter. |
| DELETE | `/api/maintenance/:id` | owner/admin | Hard-delete (for test data). SSE broadcast. |

#### 3. MaintenancePanel (`client/src/components/MaintenancePanel.jsx`) — NEW
Admin/manager panel:
- Filter tabs: All / Open / In Progress / Resolved with per-status counts.
- Ticket row with category emoji, description, status badge, priority badge, timestamp.
- Side drawer for ticket detail: category, room, priority, reported-by, timestamps.
- Managers: status dropdown, staff assignment dropdown (from `/api/housekeeping/housekeepers`),
  internal notes textarea, "Mark Resolved" shortcut button.
- `onCountChange` callback keeps the DashboardPage tab badge in sync.
- SSE listener via `window.addEventListener('maintenance_update')`.
- Full Arabic + English via inline `STRINGS` object.

#### 4. HousekeepingPanel — "Report Issue" button (`client/src/components/HousekeepingPanel.jsx`)
- `ReportIssueModal` component: category chips, priority selector, room number input, description
  textarea. Room pre-filled from the assignment card. Submits to `POST /api/maintenance`.
- `RoomTaskCard` gains an `onReport` prop → small red "🔧 Report Issue" button below the action button.
- `HousekeeperView` gains `reportRoom` state to open/close the modal.
- **"My Reports" section** at bottom of housekeeper view: list of own submitted tickets with
  status badge and any admin notes/replies. "+" button to file a free-form ticket without a room.

#### 5. DashboardPage (`client/src/pages/DashboardPage.jsx`)
- Imports `Wrench` icon and `MaintenancePanel`.
- New `canSeeMaintenance` flag (all staff including housekeepers).
- `maintOpenCount` state loaded from `GET /api/maintenance?status=open` on mount.
- New **Maintenance** tab between Housekeeping and Logs, shows live red badge with open-ticket count.

#### 6. i18n (`client/src/i18n.js`)
Added `tab_maintenance` (AR: الصيانة / EN: Maintenance) and 28 `maint_*` keys covering all
maintenance modal/panel/list strings in both Arabic and English.

---

### Commits

| Hash | Message |
|------|---------|
| `23c0dff`–`e10686b` | Landing page redesign (11 incremental commits) |
| `653b99e` | feat: add maintenance ticket tracking system |

---

### Files Changed

| File | Change |
|------|--------|
| `client/src/index.css` | 12 keyframe blocks, scroll-reveal utilities, gradient/particle classes |
| `client/src/pages/LandingPage.jsx` | Full redesign: scroll-driven hero, animated stats, testimonials carousel, scroll-reveal |
| `server/db.js` | Migration `024`: `maintenance_tickets` table |
| `server/index.js` | 4 new maintenance API endpoints |
| `client/src/components/MaintenancePanel.jsx` | New: admin maintenance ticket panel |
| `client/src/components/HousekeepingPanel.jsx` | Report Issue modal + My Reports section for housekeepers |
| `client/src/pages/DashboardPage.jsx` | Maintenance tab with live open-ticket badge |
| `client/src/i18n.js` | `tab_maintenance` + 28 `maint_*` keys in AR + EN |

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Scroll-driven hero (400vh sticky) | Gives users full control over pace; works without JS timers that break on tab focus loss |
| Deterministic particles | Using modulo arithmetic instead of `Math.random()` prevents particle positions shifting on every re-render |
| Tickets scoped per hotel via JWT `hotelId` | Same multi-tenant isolation pattern as all other tables — no cross-hotel data exposure |
| Housekeepers see only own tickets | Protects staff privacy; managers get full cross-housekeeper visibility for tracking |
| `onCountChange` callback for badge | Avoids lifting state up through multiple levels; MaintenancePanel owns the data and reports the count |
| SSE broadcast on ticket mutation | Real-time update to admin dashboards without polling |

---



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
