# iHotel — Smart Hotel IoT Platform

A multi-tenant SaaS hotel management platform. Each hotel (tenant) gets its own staff dashboard, guest portal, PMS, and real-time room control over physical IoT gateways (ESP32 via ThingsBoard MQTT).

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Multi-Tenant Model](#multi-tenant-model)
- [User Roles](#user-roles)
- [Features](#features)
- [Room Status Flow](#room-status-flow)
- [Room Automation](#room-automation)
- [Scenes Engine](#scenes-engine)
- [Guest Portal](#guest-portal)
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

Real-time updates are delivered via Server-Sent Events (SSE). Control commands are applied **optimistically** — the dashboard reflects changes instantly while the ThingsBoard write happens in the background.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Physical Layer                           │
│  ESP32 Room Gateways ──MQTT──▶ ThingsBoard                 │
│  Sensors: Temp · Humidity · CO₂ · Door · PIR · Battery     │
│  Relays:  Lights · AC · Curtains · Door Lock               │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (telemetry read/write)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Express Server  :3000                          │
│                                                             │
│  JWT Auth · SQLite · SSE Push · Rate Limiting · Helmet      │
│  Multi-tenant hotel scoping via hotelId on all routes       │
│  Optimistic SSE broadcast (instant UI, async TB writes)     │
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

| Role | Finance | Logs | Users | Rooms | PMS | Shifts | Heatmap |
|------|---------|------|-------|-------|-----|--------|---------|
| **Owner** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Admin** | — | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| **Front Desk** | — | — | — | View | ✓ | ✓ | ✓ |

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
- **Room Modal** — full room control: lights (3 circuits + dimmers), AC (mode/temperature/fan), curtains, blinds, door unlock, DND/MUR/SOS/PD services. Smart bulb SVG indicators show live light state. "Reserve Room" button for vacant rooms links directly to PMS. Door unlock shows "Sent!" confirmation with auto-lock countdown.
- **PMS** — create reservations (auto-marks room NOT_OCCUPIED on creation), checkout, extend stay, export CSV, QR code generation
- **Logs** — searchable audit trail: room, category, user, timestamp
- **Finance** — income log, night rates management, revenue summary (owner only), utility cost configuration (cost per kWh / m³), hotel-wide consumption dashboard with total electricity and water costs
- **Users** — create/deactivate hotel users; owner can reset any user's password
- **Shifts** — shift handover accounting with force-close modal (collects actual Cash and Visa amounts, compares to expected, flags discrepancies)
- **Scenes** — create automation scenes triggered by time, status change, or sensor thresholds; apply a single scene to all rooms at once via "Apply to all rooms" checkbox
- **Hotel Info** — owner-only tab to configure the hotel's public booking profile: description, location, phone, amenities, hero image, room type descriptions and photo galleries, check-in/out times, and online booking toggle
- **Simulator** — inject mock telemetry from the browser for testing; works with any room number even without physical IoT hardware (virtual mode with SSE broadcast)
- **Mobile-friendly tab bar** — scrollable tab navigation optimised for small screens

### Hotel Name Branding

- Hotel name displayed prominently in the staff header, guest portal header, and guest login page
- iHotel shown as the sub-label in small text
- Guest login page shows hotel name fetched from URL slug; shows a polite "Link Not Recognised" screen for invalid or missing hotel parameters

### Real-Time Updates

- SSE (Server-Sent Events) connection per client, scoped to hotel
- **Optimistic broadcast**: dashboard updates instantly on control commands — ThingsBoard writes happen in the background without blocking the UI
- **Command debounce**: continuous controls (sliders, temperature, AC mode) are debounced by 500ms — UI updates in real-time but only one server call is sent after the user stops adjusting, preventing command failures from rapid interactions
- **Command verification**: after each control command, the server verifies device state after 2 seconds and broadcasts a `command-ack` SSE event (confirmed/mismatch)
- **DND/MUR mutual exclusivity**: activating Do Not Disturb automatically cancels Make Up Room and vice versa, enforced on both client and server
- Audio alerts for SOS (urgent beep pattern) and MUR (housekeeping chime) events
- Today's checkouts banner shown to admin and frontdesk on login

---

## Room Status Flow

```
VACANT (0) ──── PMS Reservation ────▶ NOT_OCCUPIED (4)
                                           │
                              Guest arrives, door opens
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
| OCCUPIED | Blue | Guest present |
| SERVICE | Amber | Post-checkout, housekeeping in progress |
| MAINTENANCE | Red | Room taken out of service |
| NOT_OCCUPIED | Purple | Reserved (guest not yet arrived) or guest inactive 5 min |

---

## Room Automation

### On VACANT or NOT_OCCUPIED

Whenever a room transitions to status 0 (VACANT) or 4 (NOT_OCCUPIED) — whether by:
- The 5-minute no-motion timer firing automatically
- Staff manually setting the status dropdown
- PMS reservation creation

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

### PMS Reservation

Creating a reservation in the PMS immediately sets the room to NOT_OCCUPIED. The full cleanup automation runs at this point.

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

## Guest Portal

Guests access their room controls via a unique link or QR code generated at check-in:

```
https://hotel.example.com/guest?room=101&hotel=hayat
```

**Authentication**: guest enters their last name + 6-digit code provided by reception.

**Controls available to guests**:
- Lights (on/off + dimmer) with smart bulb SVG indicators
- Air conditioning (mode / temperature / fan speed)
- Curtains and blinds
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

## Platform Admin Portal

Access at `/platform/login`. Provides:

- **Hotel Management** — create, view, suspend hotels; set name, slug, contact email, plan
- **Room Import** — bulk import rooms (CSV or JSON) per hotel
- **Room Discovery** — auto-discover rooms from ThingsBoard devices
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
| ThingsBoard | CE running (local or cloud) |

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

# ThingsBoard connection
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
│   ├── index.js          Main Express server — all API routes, SSE, scenes engine, control logic
│   ├── db.js             SQLite schema, migrations, tenant seeding
│   ├── auth.js           JWT middleware — token generation, verification, roles
│   ├── thingsboard.js    ThingsBoard REST API client (per-hotel instances)
│   ├── platform.js       Platform super-admin router (hotel CRUD, metrics)
│   ├── .env              Environment config (not committed)
│   ├── .env.example      Config template
│   └── ihotel.db         SQLite database (auto-created)
│
├── client/src/
│   ├── App.jsx           Root router — staff, guest, platform routes
│   ├── i18n.js           Arabic/English translation strings
│   ├── pages/
│   │   ├── LoginPage.jsx          Staff login — always opens in Arabic
│   │   ├── DashboardPage.jsx      Main staff dashboard with scrollable tab navigation
│   │   ├── GuestPortal.jsx        In-room guest control page
│   │   ├── PlatformLogin.jsx      Super-admin login
│   │   └── PlatformDashboard.jsx  Super-admin management portal
│   ├── components/
│   │   ├── KPIRow.jsx        Occupancy / revenue / alert cards
│   │   ├── Heatmap.jsx       Dual-mode: floor boxes (SVG arc charts) or full room grid
│   │   ├── RoomTable.jsx     Room list with filters, guest name column, and inline controls
│   │   ├── RoomModal.jsx     Full room control popup with smart bulb SVG indicators
│   │   ├── PMSPanel.jsx      Reservation management
│   │   ├── LogsPanel.jsx     Audit log viewer
│   │   ├── FinancePanel.jsx  Revenue and night rates
│   │   ├── UsersPanel.jsx    Hotel user management
│   │   ├── ShiftsPanel.jsx   Shift accounting with force-close modal
│   │   ├── ScenesPanel.jsx   Scene builder and management with "apply to all rooms"
│   │   ├── SimulatorPanel.jsx Browser-based telemetry injector (virtual + hardware modes)
│   │   └── AlertToast.jsx    SOS / MUR notification banners
│   └── store/
│       ├── authStore.js      Login state, JWT, hotel info
│       ├── hotelStore.js     Rooms, SSE, polling, alerts
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
| POST | `/api/auth/login` | — | Hotel staff login (hotelSlug + username + password) |
| POST | `/api/auth/refresh` | refresh token | Refresh access token |
| GET | `/api/auth/me` | JWT | Current user info |
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

### PMS

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/pms/reservations` | any | List reservations |
| POST | `/api/pms/reservations` | any | Create reservation (auto NOT_OCCUPIED) |
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

### Hotel Profile (Owner)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/hotel/profile` | owner | Get hotel profile, room type info, and images |
| PUT | `/api/hotel/profile` | owner | Update hotel public profile |
| PUT | `/api/hotel/room-type-info/:type` | owner | Update room type descriptions and details |
| POST | `/api/hotel/room-type-images/:type` | owner | Upload room type image |
| DELETE | `/api/hotel/room-type-images/:id` | owner | Delete room type image |
| POST | `/api/hotel/hero-image` | owner | Upload hotel hero/cover image |

### Guest

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/guest/login` | — | Guest login (room + lastName + password) |
| GET | `/api/guest/room` | guest JWT | Room state for guest |
| POST | `/api/guest/rpc` | guest JWT | Guest room control |

### Platform Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/platform/auth/login` | Super-admin login |
| GET | `/api/platform/auth/me` | Current super-admin info |
| PUT | `/api/platform/auth/password` | Change own password |
| GET/POST | `/api/platform/hotels` | List / create hotels |
| GET/PUT/DELETE | `/api/platform/hotels/:id` | Hotel detail / update / suspend |
| GET/POST | `/api/platform/hotels/:id/rooms` | List / import rooms |
| POST | `/api/platform/hotels/:id/discover` | Auto-discover rooms from ThingsBoard |
| GET/POST | `/api/platform/hotels/:id/users` | List / create hotel users |
| PUT | `/api/platform/hotels/:id/users/:uid` | Update hotel user (incl. password reset) |
| GET | `/api/platform/metrics` | Platform-wide stats |

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
| NOT_OCCUPIED guard | Activity detected in a reserved-but-empty room automatically restores OCCUPIED status |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails | Ensure Node.js v18+: `node --version` |
| "TB auth failed" | Check ThingsBoard URL and credentials in `.env` |
| Login fails with correct credentials | Server terminal may show "Hotel not found" — check hotel slug |
| QR code link doesn't open on mobile | Set `GUEST_URL_BASE` in `.env` to your server's LAN IP |
| Can't connect from phone on same WiFi | Set `CORS_ORIGIN` to include your LAN IP, restart server |
| Dashboard shows no rooms | ThingsBoard devices must exist and be linked to a hotel in Platform Admin |
| UI updates slowly after control commands | Update to latest — optimistic SSE broadcast should make changes instant |
| "Link Not Recognised" on guest page | The `hotel=` param in the URL doesn't match any active hotel slug |
| Superadmin portal returns 401 | Platform token expired — log out and log back in at `/platform/login` |
| Simulator "Room not found" error | Update to latest — simulator now works in virtual mode without physical devices |
| Scene doesn't fire | Check that the scene is enabled and the trigger condition matches; verify in the audit log |
| Commands fail when adjusting controls quickly | Update to latest — the command debounce system batches rapid changes into a single server call after 500ms of inactivity |
| DND and MUR both active | Update to latest — DND/MUR are now mutually exclusive; activating one auto-cancels the other |
| `/book/slug` shows "Booking Not Available" | Owner must enable online booking in the Hotel Info tab and save the profile |
| Self-booking shows no room types | Rooms must be imported/discovered first in Platform Admin; room types come from `hotel_rooms` table |
