# iHotel — Smart Hotel IoT Platform

A multi-tenant SaaS hotel management platform. Each hotel (tenant) gets its own staff dashboard, guest portal, PMS, and real-time room control over physical IoT gateways via a pluggable IoT adapter layer supporting multiple backend platforms.

---

## Table of Contents

- [Overview](#overview)
- [Multi-IoT Platform Integration](#multi-iot-platform-integration)
- [Architecture](#architecture)
- [Multi-Tenant Model](#multi-tenant-model)
- [User Roles](#user-roles)
- [Features](#features)
- [Room Status Flow](#room-status-flow)
- [Room Automation](#room-automation)
- [Scenes Engine](#scenes-engine)
- [Maintenance Tracking](#maintenance-tracking)
- [Guest Portal](#guest-portal)
- [Upsell Engine](#upsell-engine)
- [Channel Manager](#channel-manager)
- [Platform Admin Portal](#platform-admin-portal)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [Production Deployment](#production-deployment)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Overview

iHotel manages multiple hotels from a single cloud server. Each hotel has:
- A **staff dashboard** (owner / admin / frontdesk roles) with live room overview, heatmap, KPIs, PMS, logs, finance, and shifts
- A **guest portal** accessible via room-specific QR code or link for in-room appliance control
- A **platform super-admin portal** to provision and manage all hotel tenants

Real-time updates are delivered via Server-Sent Events (SSE). Control commands are applied **optimistically** — the dashboard reflects changes instantly while the IoT platform write happens in the background.

---

## Multi-IoT Platform Integration

iHotel is not tied to any single IoT backend. Each hotel is created with a chosen **platform type**, and all room control, device discovery, and telemetry flows through a unified adapter interface. No core logic changes are needed to add a new platform.

### Supported Platforms

| Platform | Connection | Notes |
|----------|------------|-------|
| **ThingsBoard CE / Cloud** | REST + WebSocket real-time | ESP32 room gateways via MQTT; WebSocket subscription delivers sub-second telemetry |
| **Greentech GRMS** | REST polling (10s interval) | RCU hardware; no WebSocket — adapter polls all rooms every 10s and re-polls 2s after any command |

### Adapter Pattern

The adapter interface is defined in `server/adapters/platform-adapter.js` as a `PlatformAdapter` base class. Every platform adapter extends this base class and implements the same set of methods:

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

The adapter pool in `server/adapters/index.js` lazily instantiates one adapter per hotel based on the hotel's `platform_type` column and exposes `getAdapter(hotelId)` to all services.

### Per-Hotel Platform Type

Each row in the `hotels` table has a `platform_type TEXT DEFAULT 'thingsboard'` column (added in DB migration 033). A single iHotel server can simultaneously host ThingsBoard hotels and Greentech hotels.

### Device Config (`device_config`)

Each hotel has a `device_config TEXT DEFAULT NULL` column on the `hotels` table (migration 034) storing a JSON object:

```json
{
  "lamps": 3,
  "dimmers": 2,
  "ac": 1,
  "curtains": 1,
  "blinds": 1,
  "lampNames": ["Line 1 (Main)", "Line 2 (Bedside)", "Line 3 (Bath)"],
  "dimmerNames": ["Dimmer 1", "Dimmer 2"]
}
```

This is populated automatically when the platform super-admin clicks **"Discover Rooms"** — the server calls `adapter.getDeviceConfig(firstRoomId)` and saves the result. For Greentech hotels, `getDeviceConfig` fetches the actual device groups from the GRMS API to return real lamp/dimmer counts and names. For ThingsBoard hotels, it returns standard 3-lamp/2-dimmer defaults.

ThingsBoard hotels that have not yet run "Discover Rooms" receive a default `device_config` automatically on the first login or `/api/auth/me` call, ensuring the Room Device Names editor is available immediately.

### Dynamic Room UI

`RoomModal` reads `device_config` (from `authStore` on the dashboard, or from the `/api/guest/room` response on the guest portal) and renders exactly what the hardware has — no hardcoded 3/2 defaults:

- `lampKeys = Array.from({ length: cfg.lamps }, (_, i) => \`line${i + 1}\`)`
- `dimmerKeys = Array.from({ length: cfg.dimmers }, (_, i) => \`dimmer${i + 1}\`)`
- AC section shown only if `cfg.ac > 0`; curtains/blinds shown only if `cfg.curtains/blinds > 0`

### Owner-Customizable Device Names

The **Hotel Info** tab includes a **Room Device Names** section where the owner can rename each light circuit and dimmer. Changes are saved via `PUT /api/hotel/device-names`, which updates only the `lampNames[]` and `dimmerNames[]` fields in `device_config` without overwriting the hardware counts.

### Post-Command Re-Poll

After every control command, the adapter schedules a re-fetch of device state 2 seconds later. The confirmed state is pushed to all connected clients via SSE. For Greentech, this clears the room's device cache entry and re-fetches from the GRMS API. For ThingsBoard, it reads back shared attributes to verify the command.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Physical Layer                           │
│  ThingsBoard: ESP32 ──MQTT──▶ ThingsBoard CE/Cloud         │
│  Greentech:   RCU hardware ──▶ Greentech GRMS API          │
│  Sensors: Temp · Humidity · CO₂ · Door · PIR · Battery     │
│  Relays:  Lights · AC · Curtains · Door Lock               │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               IoT Adapter Layer                             │
│  PlatformAdapter (base) → TBAdapter / GreentechAdapter      │
│  Per-hotel platform_type + device_config in SQLite          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Express Server  :3000                          │
│  JWT Auth · SQLite · SSE Push · Rate Limiting · Helmet      │
│  Multi-tenant hotel scoping via hotelId on all routes       │
│  Optimistic SSE broadcast (instant UI, async IoT writes)    │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST + SSE
          ┌───────────┼───────────┐
          ▼           ▼           ▼
   Staff Dashboard  Guest Portal  Platform Admin
   /               /guest        /platform
```

---

## Multi-Tenant Model

- One server, one database, one codebase serves **all hotels**
- Every hotel has its own: rooms, users, reservations, logs, income, shifts
- Hotel staff see only their own hotel's data — enforced server-side via `hotelId` in JWT
- Platform super-admin can manage all tenants from `/platform`

### Login Flows

| Portal | URL | Credentials |
|--------|-----|-------------|
| Hotel Staff | `/` | Hotel Code + Username + Password |
| Guest | `/guest?room=101&hotel=hayat` | Last name + 6-digit room code |
| Platform Admin | `/platform/login` | Username + Password (superadmin only) |

**Login page always opens in Arabic** regardless of any previously stored language preference.

---

## User Roles

### Hotel Staff

| Role | Finance | Logs | Users | Rooms | PMS | Shifts | Heatmap | Maintenance |
|------|---------|------|-------|-------|-----|--------|---------|-------------|
| **Owner** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | View + Resolve |
| **Admin** | — | ✓ | — | ✓ | ✓ | ✓ | ✓ | View + Resolve |
| **Front Desk** | — | — | — | View | ✓ | ✓ | ✓ | View + Resolve |
| **Housekeeper** | — | — | — | — | — | — | — | Report + View own |

### Platform Super-Admin

Full access to all hotels: create, suspend, configure, manage users and rooms.

---

## Features

### Staff Dashboard

- **KPI Row** — live occupancy count, active reservations, SOS/MUR alerts, check-in/out today
- **Room Heatmap** — dual-mode view:
  - **Floors mode** (default): compact floor-summary boxes showing SVG arc chart of vacancy %, vacant room counts by type (Std/Dlx/Ste/VIP), and alert badges (🚨SOS, 🧹MUR, ⚡PD). Click a floor box to expand and inspect rooms in that floor.
  - **Rooms mode**: original color-coded grid of all rooms by floor with configurable columns per row (Auto / 5 / 8 / 10 / 12 / 15 / 20). Keyboard shortcut: type any room number to instantly jump to it.
  - Toggle between modes with the **⊞ Floors / ⊟ Rooms** button
- **Room Table** — sortable list with floor/status/temperature/door/flag filters; inline status dropdown, checkout button, and guest name column
- **Room Modal** — full room control: dynamic light circuits and dimmers (from device_config), AC (mode/temperature/fan), curtains, blinds, door unlock, DND/MUR/SOS/PD services. Smart bulb SVG indicators show live light state. "Reserve Room" button for vacant rooms links directly to PMS. Door unlock shows "Sent!" confirmation with auto-lock countdown.
  - **Dynamic device UI** — lamp circuits, dimmers, AC, and curtains are rendered from `device_config`, not hardcoded counts
- **PMS** — create reservations (room displays as Reserved; transitions to Occupied automatically when guest opens door or turns on lights), checkout, extend stay, export CSV, QR code generation
- **Logs** — searchable audit trail: room, category, user, timestamp
- **Finance** — income log, night rates management, revenue summary (owner only), utility cost configuration (cost per kWh / m³), hotel-wide consumption dashboard with total electricity and water costs
- **Users** — create/deactivate hotel users; owner can reset any user's password
- **Shifts** — shift handover accounting with force-close modal (collects actual Cash and Visa amounts, compares to expected, flags discrepancies)
- **Scenes** — create automation scenes triggered by time, status change, or sensor thresholds; apply a single scene to all rooms at once via "Apply to all rooms" checkbox
- **Hotel Info** — owner-only tab to configure the hotel's public booking profile: description, location, phone, amenities, hero image, room type descriptions and photo galleries, check-in/out times, online booking toggle, and public server URL for Channel Manager. Also includes **Room Device Names** editor — owner can rename individual lamp circuits and dimmers displayed in the room modal and guest portal.
- **Maintenance Tracking** — housekeepers report issues (AC, Plumbing, Electrical, Furniture, Cleaning) directly from their task card; managers track and resolve via a dedicated tab with status workflow (open → in progress → resolved), staff assignment, and internal notes
- **Upsell Engine** — configurable in-room extras catalog (breakfast, airport transfer, minibar, spa, etc.) with guest-facing request flow in the portal and staff fulfilment queue in PMS; revenue tracked in Finance panel with `thirdparty` payment support
- **Channel Manager** — iCal feed export (RFC 5545) per hotel for availability sync to any OTA; webhook receiver auto-creates reservations from Booking.com/Expedia/Airbnb; per-channel config (name, secret, active toggle) managed from Hotel Info
- **Simulator** — inject mock telemetry from the browser for testing; works with any room number even without physical IoT hardware (virtual mode with SSE broadcast)
- **Modern pill-style tab bar** — sticky, frosted-glass (`backdrop-blur-md bg-white/80`), active tab filled with brand color and shadow, inactive tabs with hover highlight, inline count badges

### Hotel Name Branding

- Hotel name displayed prominently in the staff header, guest portal header, and guest login page
- iHotel shown as the sub-label in small text
- Guest login page shows hotel name fetched from URL slug; shows a polite "Link Not Recognised" screen for invalid or missing hotel parameters

### Real-Time Updates

- SSE (Server-Sent Events) connection per client, scoped to hotel
- **Optimistic broadcast**: dashboard updates instantly on control commands — IoT platform writes happen in the background without blocking the UI
- **Command debounce**: continuous controls (sliders, temperature, AC mode) are debounced by 500ms — UI updates in real-time but only one server call is sent after the user stops adjusting, preventing command failures from rapid interactions
- **Command verification**: after each control command, the server verifies device state after 2 seconds and broadcasts a `command-ack` SSE event (confirmed/mismatch)
- **Post-command re-poll**: for polling-based platforms (Greentech), confirmed device state is fetched 2s after each command and pushed via SSE
- **DND/MUR mutual exclusivity**: activating Do Not Disturb automatically cancels Make Up Room and vice versa, enforced on both client and server
- Audio alerts for SOS (urgent beep pattern) and MUR (housekeeping chime) events
- Today's checkouts banner shown to admin and frontdesk on login

---

## Room Status Flow

```
VACANT (0) ──── PMS Reservation ────▶ RESERVED (display only, device stays VACANT)
                                           │
                              Guest arrives — door opens
                              OR lights/AC turned on
                                           │
                                           ▼
                                      OCCUPIED (1)
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                      Guest leaves              5-min no motion
                      (checkout)                (timer fires)
                              │                         │
                              ▼                         ▼
                         SERVICE (2)           NOT_OCCUPIED (4)
                              │                         │
                      Housekeeping done        Guest returns → OCCUPIED
                              │
                              ▼
                          VACANT (0)
```

| Status | Color | Meaning |
|--------|-------|---------|
| VACANT | Green | Room empty, no reservation |
| RESERVED | Cyan | Active reservation exists, guest not yet arrived (UI display only — device stays VACANT) |
| OCCUPIED | Blue | Guest present |
| SERVICE | Amber | Post-checkout, housekeeping in progress |
| MAINTENANCE | Red | Room taken out of service |
| NOT_OCCUPIED | Purple | Guest inactive for 5 min — automation cuts power |

---

## Room Automation

### On VACANT or NOT_OCCUPIED

Whenever a room transitions to status 0 (VACANT) or 4 (NOT_OCCUPIED) — whether by:
- The 5-minute no-motion timer firing automatically
- Staff manually setting the status dropdown

The server automatically sends these commands to the hardware:

| Setting | Value |
|---------|-------|
| Lights (Line 1/2/3) | OFF |
| Dimmers (1/2) | 0% |
| AC Mode | COOL |
| AC Temperature | 26 °C |
| Fan Speed | LOW |
| Curtains | Closed (0%) |
| Blinds | Closed (0%) |

This ensures rooms are always left in an energy-efficient state between guests.

### On Activity While NOT_OCCUPIED

If any physical activity is detected (PIR motion, door open, lights turned on, AC set above OFF) while the room is NOT_OCCUPIED, it is automatically restored to OCCUPIED.

### On Activity in a Reserved Room

When a room has an active reservation and the guest arrives, the system automatically sets the room to OCCUPIED when:
- The door is opened
- Any light circuit is turned on
- AC mode is set above OFF
- Curtains or blinds are moved

No manual status change is needed at check-in.

### PMS Reservation

Creating a reservation keeps the room in VACANT state on the device. The room is displayed as **Reserved** (cyan) in the UI until the guest physically arrives.

---

## Scenes Engine

Scenes allow hotel staff to define automation rules that fire automatically based on configurable triggers.

### Trigger Types

| Trigger | Description |
|---------|-------------|
| **Time** | Fires at a specific time of day (HH:MM) |
| **Status Change** | Fires when a room transitions to a given status (e.g. VACANT, OCCUPIED) |
| **Sensor Threshold** | Fires when a sensor value (temperature, humidity, CO₂) crosses a threshold |

### Actions

Each scene can contain one or more control actions applied to the target room:
- Set lights (on/off, dimmer level)
- Set AC (mode, temperature, fan speed)
- Set curtains / blinds position
- Set room status
- Set service flags (DND, MUR, SOS)

### Apply to All Rooms

When creating a new scene, enable **"Apply to all rooms"** to instantly create the same scene for every room in the hotel — useful for hotel-wide schedules (e.g. "every night at 23:00 dim all lights").

### Scene Management

- Enable / disable individual scenes without deleting them
- Scenes are scoped per hotel (multi-tenant safe)
- Scene execution is logged in the audit trail

---

## Maintenance Tracking

Housekeepers can report maintenance issues directly from their cleaning task list without leaving the app.

### Reporting (Housekeeper)

1. While viewing an assigned room card, tap **🔧 Report Issue**
2. Select a **category**: AC · Plumbing · Electrical · Furniture · Cleaning · Other
3. Set **priority**: Low · Medium · High · Urgent
4. Enter a **description** of the issue
5. Room number is pre-filled from the task card; can be overridden
6. Submitted tickets appear in the **My Reports** section at the bottom of the housekeeper view, showing live status and any admin notes

### Tracking (Admin / Manager)

The **Maintenance** tab in the staff dashboard shows all open tickets with:
- Filter tabs: All / Open / In Progress / Resolved (with counts per status)
- A live **red badge** on the tab showing the number of open tickets
- Ticket detail drawer: category, room, priority, reporter, timestamps
- **Status workflow**: open → in progress → resolved (with "Mark Resolved" shortcut)
- **Staff assignment**: assign the ticket to a specific housekeeper or engineer
- **Internal notes**: admin-only notes visible to the reporter as feedback

### Ticket Lifecycle

```
Housekeeper reports → OPEN
Admin acknowledges  → IN PROGRESS
Issue fixed         → RESOLVED  (resolved_at timestamp recorded)
```

---

## Guest Portal

Guests access their room controls via a unique link or QR code generated at check-in:

```
https://hotel.example.com/guest?room=101&hotel=hayat
```

**Authentication**: guest enters their last name + 6-digit code provided by reception.

**Controls available to guests**:
- Lights (on/off + dimmer) with smart bulb SVG indicators — number of circuits rendered from device_config
- Air conditioning (mode / temperature / fan speed)
- Curtains and blinds (shown only if present in device_config)
- DND (Do Not Disturb) and MUR (Make Up Room) service flags
- Door unlock

The guest portal shows the hotel name and room number in the header.

---

## Self-Booking (Online Reservations)

Guests can book rooms directly without staff involvement via a public booking page:

```
https://hotel.example.com/book/hayat
```

### Setup (Owner)

1. Go to **Hotel Info** tab in the staff dashboard
2. Fill in hotel description, location, amenities, and upload a hero image
3. For each room type, add description, photos, bed type, max guests
4. Toggle **Online Booking** to ON
5. Share the booking link `/book/{hotel-slug}` on your website or social media

### Booking Flow (Guest)

1. **Select dates** — check-in and check-out
2. **Pick room type** — browse cards with photos, pricing, availability, and amenities
3. **Enter details** — name (required), email, phone
4. **Confirmation** — system auto-assigns an available room and displays:
   - Room number and type
   - 6-digit room code for the guest portal
   - Direct link to guest portal for in-room controls
   - Total cost breakdown

### Key Features

- Bilingual (English / Arabic) with toggle
- Live room availability per type for the selected dates
- Image carousel per room type
- Rate-limited: 10 bookings per 15 minutes per IP
- Payment status defaults to "pending" — compatible with future payment gateway integration
- Same reservation pipeline as staff PMS (income log, room automation, scenes all fire normally)

---

## Upsell Engine

Increase ancillary revenue by letting guests request paid extras directly from their room portal.

### Setup (Owner — Hotel Info → Upsell Offers)

1. Add offers with name (EN + AR), category, price, unit (one-time / per night), and optional room-type restriction
2. Categories: `SERVICE`, `FOOD`, `TRANSPORT`, `SPA`, `OTHER` — each gets an emoji label in the portal
3. Offers with a room-type restriction are only visible to guests in matching room types

### Guest Flow

1. Guest opens portal → taps **Services & Extras**
2. Browses catalog grouped by category, taps **Request** (free) or **Add** (paid)
3. Staff see a **⊕ N pending** amber badge on the reservation card in PMS
4. Staff open the extras drawer: confirm, deliver, or decline each item; add a staff note

### Finance Tracking

Extras revenue is logged to `income_log` with `nights = 0` (flags it as ancillary). Finance panel sums it naturally alongside room revenue with a separate badge per payment method.

---

## Channel Manager

Connect your hotel's live availability to Booking.com, Expedia, Airbnb, and any other OTA without manual updates.

### How It Works

| Component | Description |
|-----------|-------------|
| **iCal Feed** | `GET /api/channel/ical/:hotelId/:token.ics` — RFC 5545 calendar with all active reservations as `BLOCKED` events. OTAs pull this URL to mark dates unavailable. |
| **Webhook Receiver** | `POST /api/channel/webhook/:channelId` — OTA sends a booking payload; iHotel validates the HMAC signature, checks availability, auto-assigns a room, and creates a reservation with `payment_method = 'thirdparty'`. |
| **Channel Config** | Owner creates channels (name, webhook secret) in Hotel Info. Each channel gets a unique iCal token and webhook ID. |

### Setup (Owner — Hotel Info → Channels)

1. Set **Public Server URL** in General settings (e.g. `https://hotel.example.com`) — required for shareable URLs
2. Go to **Channels** tab → click **Add Channel** → name it (e.g. "Booking.com")
3. Copy the **iCal URL** and paste into the OTA's calendar import / sync field
4. Copy the **Webhook URL** and paste into the OTA's webhook delivery settings; add a shared secret for HMAC verification
5. OTA bookings arrive as reservations in PMS with an orange "Booking.com" badge in Finance

### Supported OTAs (iCal import)

| OTA | Where to paste |
|-----|---------------|
| Booking.com | Extranet → Rates & Availability → Calendar sync |
| Airbnb | Calendar → Availability → Import calendar |
| Expedia | Partner Central → Calendar → Import |
| Any other | Any platform that supports iCal / `.ics` URL import |

---

## Platform Admin Portal

Access at `/platform/login`. Provides:

- **Hotel Management** — create hotels with platform type selector (ThingsBoard or Greentech GRMS); view, suspend hotels; set name, slug, contact email, plan. For Greentech hotels, the creation form includes host URL, username, and password fields — these credentials are stored per-hotel in the database.
- **Room Import** — bulk import rooms (CSV or JSON) per hotel
- **Room Discovery** — "Discover Rooms" auto-detects device topology from the IoT platform and populates `device_config` with real lamp/dimmer counts and names
- **User Management** — create and manage hotel staff accounts per tenant; reset any user's password
- **Password Management** — superadmin can change their own password via the key icon in the header
- **Metrics** — platform-wide: active hotels, total rooms, active reservations

### Default Staff Passwords

When a hotel is created, three default users are seeded:

```
owner / iHotel-{slug}-2026
admin / iHotel-{slug}-2026
frontdesk / iHotel-{slug}-2026
```

For example, for hotel slug `hayat`: password is `iHotel-hayat-2026`.

---

## Installation

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | v18 or later |
| IoT Platform | ThingsBoard CE (for TB hotels) or Greentech GRMS access (for Greentech hotels) |

### Steps

```bash
# 1. Install root dependencies
npm install

# 2. Install server dependencies
cd server && npm install && cd ..

# 3. Install client dependencies
cd client && npm install && cd ..

# 4. Copy environment template
cp server/.env.example server/.env
# Edit server/.env with your settings
```

---

## Configuration

Edit `server/.env`:

```env
PORT=3000
NODE_ENV=development

# ThingsBoard connection — only required for hotels using the ThingsBoard platform
# Greentech credentials are stored per-hotel in the database (set during hotel creation)
TB_HOST=http://localhost:8080
TB_USER=admin@yourdomain.com
TB_PASS=your_tb_password

# JWT — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=CHANGE_ME_strong_random_32_char_secret
JWT_EXPIRY=8h
JWT_REFRESH_EXPIRY=7d

# Platform super-admin (seeded on first run)
PLATFORM_ADMIN_USER=superadmin
PLATFORM_ADMIN_PASS=CHANGE_ME_strong_password

# CORS — comma-separated list for multi-origin (LAN + localhost)
CORS_ORIGIN=http://localhost:5173,http://192.168.1.100:5173

# Guest QR code base URL (must be reachable from guests' phones)
GUEST_URL_BASE=http://192.168.1.100:5173

# Rate limiting
LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_MIN=15
```

**Note:** `TB_HOST`, `TB_USER`, and `TB_PASS` are only required if you have hotels using the ThingsBoard platform. Greentech GRMS credentials (host, username, password) are entered per-hotel in the Platform Admin portal and stored in the database — they do not go in `.env`.

---

## Running the System

### Development (two terminals)

**Terminal 1 — Backend:**
```bash
cd server
node index.js
```

**Terminal 2 — Frontend:**
```bash
cd client
npx vite
```

Open `http://localhost:5173` for staff dashboard, `http://localhost:5173/platform/login` for admin portal.

### LAN Access (mobile devices on same network)

The Vite dev server binds to all interfaces (`0.0.0.0`) by default. Use your machine's LAN IP, e.g. `http://192.168.1.100:5173`. Set `GUEST_URL_BASE` and `CORS_ORIGIN` accordingly in `.env`.

---

## Production Deployment

### 1. Build the frontend

```bash
cd client
npx vite build
```

### 2. Run in production mode

```bash
cd server
NODE_ENV=production node index.js
```

The server serves the built frontend from `client/dist` on port 3000.

### 3. Nginx reverse proxy with HTTPS

```nginx
server {
    listen 443 ssl;
    server_name hotel.yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Required for SSE (Server-Sent Events)
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_read_timeout 3600s;
    }
}
```

---

## Project Structure

```
iHotel/
├── server/
│   ├── index.js          Main Express server — all API routes, SSE, device_config seeding, device-names endpoint
│   ├── db.js             SQLite schema, migrations 010–034, tenant seeding
│   ├── auth.js           JWT middleware — token generation, verification, roles
│   ├── platform.js       Platform super-admin router (hotel CRUD, metrics, Discover Rooms + getDeviceConfig)
│   ├── adapters/
│   │   ├── platform-adapter.js   Base adapter interface (PlatformAdapter class)
│   │   ├── tb-adapter.js         ThingsBoard CE/Cloud REST + WebSocket adapter
│   │   ├── greentech-adapter.js  Greentech GRMS REST adapter (polling, Chinese field mapping)
│   │   └── index.js              Adapter pool — lazy per-hotel instantiation, getAdapter(hotelId)
│   ├── services/
│   │   ├── room.service.js       Room lifecycle, fetchAndBroadcast, processTelemetry
│   │   ├── control.service.js    sendControl, optimistic SSE, command verify
│   │   ├── sse.service.js        SSE connection management, broadcast helpers
│   │   ├── state.service.js      In-memory state (deviceRoomMap, lastKnownTelemetry, etc.)
│   │   ├── audit.service.js      addLog helper
│   │   └── scene-engine.js       Scene trigger evaluation
│   ├── .env              Environment config (not committed)
│   ├── .env.example      Config template
│   └── ihotel.db         SQLite database (auto-created)
│
├── client/src/
│   ├── App.jsx           Root router — staff, guest, platform routes
│   ├── i18n.js           Arabic/English translation strings
│   ├── pages/
│   │   ├── LoginPage.jsx          Staff login — always opens in Arabic
│   │   ├── DashboardPage.jsx      Main staff dashboard — pill tab bar, deviceConfig prop to RoomModal
│   │   ├── GuestPortal.jsx        In-room guest control page — stores + passes deviceConfig
│   │   ├── PlatformLogin.jsx      Super-admin login
│   │   └── PlatformDashboard.jsx  Super-admin management portal
│   ├── components/
│   │   ├── KPIRow.jsx        Occupancy / revenue / alert cards
│   │   ├── Heatmap.jsx       Dual-mode: floor boxes (SVG arc charts) or full room grid
│   │   ├── RoomTable.jsx     Room list with filters, guest name column, and inline controls
│   │   ├── RoomModal.jsx     Dynamic room control — lamps/dimmers/AC/curtains from deviceConfig
│   │   ├── PMSPanel.jsx      Reservation management
│   │   ├── LogsPanel.jsx     Audit log viewer
│   │   ├── FinancePanel.jsx  Revenue and night rates
│   │   ├── UsersPanel.jsx    Hotel user management
│   │   ├── ShiftsPanel.jsx   Shift accounting with force-close modal
│   │   ├── ScenesPanel.jsx       Scene builder and management with "apply to all rooms"
│   │   ├── HousekeepingPanel.jsx Manager assignment view + housekeeper task list + report issue
│   │   ├── MaintenancePanel.jsx  Admin maintenance ticket tracker with filter tabs + detail drawer
│   │   ├── ReviewsPanel.jsx      Guest review management
│   │   ├── HotelInfoPanel.jsx    Owner hotel profile, upsell catalog, service stats, channel manager, Room Device Names editor
│   │   ├── SimulatorPanel.jsx    Browser-based telemetry injector (virtual + hardware modes)
│   │   └── AlertToast.jsx        SOS / MUR notification banners
│   └── store/
│       ├── authStore.js      Login state, JWT, hotel info, deviceConfig
│       ├── hotelStore.js     Rooms, SSE, polling, alerts, upsell pending, channel connections
│       └── platformStore.js  Super-admin state (hotels, metrics)
│
├── Firmware/
│   └── hilton_hardware.ino  ESP32 gateway firmware
│
├── SETUP_GUIDE.md    Step-by-step first-run guide
└── README.md         This file
```

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | — | Hotel staff login (hotelSlug + username + password) — returns user object including `device_config` |
| POST | `/api/auth/refresh` | refresh token | Refresh access token |
| GET | `/api/auth/me` | JWT | Current user info (includes `device_config`; seeds TB default if missing) |
| GET | `/api/public/hotel?slug=xxx` | — | Get hotel name by slug (for guest login page) |

### Rooms

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/overview` | any | All room states snapshot |
| GET | `/api/rooms/:room` | any | Single room detail |
| POST | `/api/devices/:id/rpc` | owner/admin | Send control command |
| POST | `/api/rooms/:room/reset` | owner/admin | Full room reset to defaults |
| POST | `/api/rooms/reset-all` | owner/admin | Reset all rooms (async) |
| POST | `/api/rooms/:room/checkout` | any | Checkout + set SERVICE |

### Hotel Device Names

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| PUT | `/api/hotel/device-names` | owner/admin | Update lampNames[] and dimmerNames[] in device_config |

### PMS

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/pms/reservations` | any | List reservations |
| POST | `/api/pms/reservations` | any | Create reservation (room shows as Reserved in UI) |
| PUT | `/api/pms/reservations/:id` | any | Update reservation |
| GET | `/api/pms/export` | any | Export CSV |
| GET | `/api/pms/night-rates` | any | Get night rates |
| PUT | `/api/pms/night-rates` | owner | Update night rates |

### Scenes

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/scenes` | any | List all scenes for hotel |
| POST | `/api/scenes` | owner/admin | Create scene |
| PUT | `/api/scenes/:id` | owner/admin | Update scene |
| DELETE | `/api/scenes/:id` | owner/admin | Delete scene |
| POST | `/api/scenes/:id/trigger` | owner/admin | Manually trigger a scene |

### Finance

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/finance/summary` | owner/admin | Revenue summary by type and payment method |
| GET | `/api/finance/utility-costs` | owner | Get utility cost rates (cost/kWh, cost/m³) |
| PUT | `/api/finance/utility-costs` | owner | Update utility cost rates |
| GET | `/api/hotel/consumption` | owner/admin | Total hotel electricity and water consumption with costs |

### Shifts

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/shifts` | any | List shifts |
| POST | `/api/shifts` | any | Open a new shift |
| POST | `/api/shifts/:id/close` | any | Close shift (submit actual Cash + Visa amounts) |
| POST | `/api/shifts/:id/force-close` | owner/admin | Force-close shift with actual amount reconciliation |

### Simulator

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/simulator/inject` | owner/admin | Inject telemetry (virtual or hardware room) |

### Self-Booking (Public)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/public/book/:slug` | — | Hotel profile, room types, rates, images for booking page |
| GET | `/api/public/book/:slug/availability` | — | Room availability by type for date range |
| POST | `/api/public/book/:slug` | — | Create self-booking reservation (rate-limited) |

### Upsell Engine

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/upsell/catalog` | owner | List all offers in the hotel's catalog |
| POST | `/api/upsell/catalog` | owner | Create offer (name, category, price, unit, room_types filter) |
| PATCH | `/api/upsell/catalog/:id` | owner | Update offer |
| DELETE | `/api/upsell/catalog/:id` | owner | Delete offer |
| GET | `/api/upsell/offers` | guest JWT | Offers visible to the guest's room type |
| GET | `/api/upsell/my-extras` | guest JWT | Guest's own requested extras for the active stay |
| POST | `/api/upsell/my-extras` | guest JWT | Guest requests an extra |
| GET | `/api/upsell/pending` | any staff | All pending (requested) extras for the hotel |
| GET | `/api/upsell/extras/:reservationId` | any staff | Extras for a specific reservation |
| PATCH | `/api/upsell/extras/:id` | any staff | Update extra status (confirmed/delivered/declined) + staff note |
| GET | `/api/upsell/stats` | owner | Per-offer request count totals |
| GET | `/api/upsell/stats/:offerId/rooms` | owner | Per-room breakdown for a specific offer |

### Channel Manager

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/channel/ical/:hotelId/:token.ics` | — (token auth) | Live iCal feed (RFC 5545) of all blocked dates for the hotel |
| POST | `/api/channel/webhook/:channelId` | — (HMAC-SHA256) | Receive OTA booking; validates signature, auto-assigns room, creates reservation |
| GET | `/api/channel/connections` | JWT | List channel connections for the hotel |
| POST | `/api/channel/connections` | owner/admin | Create a channel connection (auto-generates `ical_token`) |
| PATCH | `/api/channel/connections/:id` | owner/admin | Update channel name, secret, notes, active toggle |
| DELETE | `/api/channel/connections/:id` | owner/admin | Delete channel connection |

### Hotel Profile (Owner)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/hotel/profile` | owner | Get hotel profile, room type info, and images |
| PUT | `/api/hotel/profile` | owner | Update hotel public profile (incl. `publicUrl` for Channel Manager) |
| PUT | `/api/hotel/room-type-info/:type` | owner | Update room type descriptions and details |
| POST | `/api/hotel/room-type-images/:type` | owner | Upload room type image |
| DELETE | `/api/hotel/room-type-images/:id` | owner | Delete room type image |
| POST | `/api/hotel/hero-image` | owner | Upload hotel hero/cover image |

### Guest

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/guest/login` | — | Guest login (room + lastName + password) |
| GET | `/api/guest/room` | guest JWT | Room state for guest (includes `device_config`) |
| POST | `/api/guest/rpc` | guest JWT | Guest room control |

### Platform Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/platform/auth/login` | Super-admin login |
| GET | `/api/platform/auth/me` | Current super-admin info |
| PUT | `/api/platform/auth/password` | Change own password |
| GET/POST | `/api/platform/hotels` | List / create hotels (POST accepts `platform_type` + Greentech credentials) |
| GET/PUT/DELETE | `/api/platform/hotels/:id` | Hotel detail / update / suspend |
| GET/POST | `/api/platform/hotels/:id/rooms` | List / import rooms |
| POST | `/api/platform/hotels/:id/discover` | Auto-discover rooms from IoT platform; saves device_config |
| GET/POST | `/api/platform/hotels/:id/users` | List / create hotel users |
| PUT | `/api/platform/hotels/:id/users/:uid` | Update hotel user (incl. password reset) |
| GET | `/api/platform/metrics` | Platform-wide stats |

### Housekeeping

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/housekeeping/queue` | manager + housekeeper | Unassigned dirty rooms (managers) or own pending tasks (housekeepers) |
| GET | `/api/housekeeping/assignments` | manager + housekeeper | Active assignments |
| GET | `/api/housekeeping/housekeepers` | manager | List housekeeper accounts for assignment dropdown |
| POST | `/api/housekeeping/assign` | manager | Bulk-assign rooms to a housekeeper |
| POST | `/api/housekeeping/assignments/:id/start` | all | Mark assignment in_progress |
| POST | `/api/housekeeping/assignments/:id/complete` | all | Mark done, reset appliances, set VACANT |
| DELETE | `/api/housekeeping/assignments/:id` | manager | Cancel assignment |

### Maintenance

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/maintenance` | all staff | List tickets; managers see all, housekeepers see own. `?status=` filter supported |
| POST | `/api/maintenance` | all staff | Open new ticket (category, description, priority, room_number) |
| PATCH | `/api/maintenance/:id` | all staff | Update status / assignment / notes (managers); edit description (housekeepers, open only) |
| DELETE | `/api/maintenance/:id` | owner/admin | Hard-delete ticket |

### Users

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/users` | any | List hotel users |
| POST | `/api/users` | owner | Create hotel user |
| PUT | `/api/users/:id` | owner | Update / deactivate user |
| PUT | `/api/users/:id/password` | owner / self | Change password |

---

## Security

| Feature | Detail |
|---------|--------|
| Passwords | bcrypt hashed (cost 10) — staff and guest passwords |
| Sessions | 8-hour access token + 7-day refresh token (JWT) |
| Tenant isolation | All routes validate `hotelId` from JWT — no cross-tenant data access |
| Rate limiting | 10 login attempts per 15 min (staff); 5 per 15 min (guest) |
| Security headers | Helmet.js (XSS, MIME sniffing, frameguard, etc.) |
| CORS | Allowlist-only, configurable per deployment |
| Audit log | Every control command, login, and PMS event is logged with user + timestamp |
| Reserved room guard | Door open or physical activity in a reserved room automatically transitions to OCCUPIED |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails | Ensure Node.js v18+: `node --version` |
| "TB auth failed" | Check ThingsBoard URL and credentials in `.env` (only needed for ThingsBoard hotels) |
| Login fails with correct credentials | Server terminal may show "Hotel not found" — check hotel slug |
| QR code link doesn't open on mobile | Set `GUEST_URL_BASE` in `.env` to your server's LAN IP |
| Can't connect from phone on same WiFi | Set `CORS_ORIGIN` to include your LAN IP, restart server |
| Dashboard shows no rooms | IoT platform devices must exist and be linked to a hotel in Platform Admin |
| UI updates slowly after control commands | Update to latest — optimistic SSE broadcast should make changes instant |
| "Link Not Recognised" on guest page | The `hotel=` param in the URL doesn't match any active hotel slug |
| Superadmin portal returns 401 | Platform token expired — log out and log back in at `/platform/login` |
| Simulator "Room not found" error | Update to latest — simulator now works in virtual mode without physical devices |
| Scene doesn't fire | Check that the scene is enabled and the trigger condition matches; verify in the audit log |
| Commands fail when adjusting controls quickly | Update to latest — the command debounce system batches rapid changes into a single server call after 500ms of inactivity |
| DND and MUR both active | Update to latest — DND/MUR are now mutually exclusive; activating one auto-cancels the other |
| `/book/slug` shows "Booking Not Available" | Owner must enable online booking in the Hotel Info tab and save the profile |
| Self-booking shows no room types | Rooms must be imported/discovered first in Platform Admin; room types come from `hotel_rooms` table |
| iCal URL shows `localhost` | Set **Public Server URL** in Hotel Info → General settings → save; channel URLs will update |
| OTA can't pull iCal feed | Ensure the server is publicly reachable (deployed to VPS, not localhost); check firewall port 3000/443 |
| Webhook booking returns 409 | No room of the requested type is available for those dates; OTA will not confirm the booking |
| Webhook returns 401 | `X-Webhook-Signature` header doesn't match the configured HMAC secret — verify the shared secret in both iHotel and the OTA |
| Upsell extras don't appear for guest | Check that the offer's room_types filter includes the guest's room type, or set it to NULL (all rooms) |
| PMS shows no pending badge | Ensure `fetchUpsellPending` is called on mount; check browser console for API errors |
| Room modal shows wrong number of lights/dimmers | Run "Discover Rooms" from Platform Admin to populate device_config for this hotel |
| Greentech device state doesn't update | Greentech uses 10s polling — state updates within 10s at rest, ~2s after a command |
| Greentech control returns code 500 | Verify the hotel's GRMS host URL, username, and password in Platform Admin hotel settings |
