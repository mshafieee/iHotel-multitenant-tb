# Hilton Grand Hotel — IoT Room Management System v2.0

A full-stack hotel room management platform that bridges physical IoT room gateways (ESP32 via ThingsBoard) with a real-time web dashboard for hotel staff and an in-room control portal for guests.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
  - [Staff Dashboard](#staff-dashboard)
  - [Guest Portal](#guest-portal)
  - [Room Status Flow](#room-status-flow)
  - [Power Down Mode](#power-down-mode)
  - [Real-time Events](#real-time-events)
  - [Audit Logging](#audit-logging)
  - [Gateway Simulator](#gateway-simulator)
- [User Roles](#user-roles)
- [Prerequisites](#prerequisites)
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

This system manages up to **300 hotel rooms** across 15 floors. Each room has an ESP32 gateway connected to ThingsBoard over MQTT. The gateway reports sensor data (temperature, humidity, CO₂, door contacts, PIR motion) and accepts relay commands (lights, AC, curtains, door lock).

The platform provides:
- A **staff dashboard** with live room overview, heatmap, KPIs, PMS, and audit logs
- A **guest portal** accessible via room-specific QR code for in-room appliance control
- A **Python gateway simulator** for testing all 300 rooms without physical hardware

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Physical Layer                           │
│  ESP32 Room Gateways (300 rooms) ──MQTT──▶ ThingsBoard     │
│  Sensors: Temp · Humidity · CO₂ · Door · PIR · Battery     │
│  Relays:  Lights · AC · Curtains · Door Lock               │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (polling + telemetry write)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Express Server  :3000                      │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ JWT Auth │  │ SQLite   │  │ SSE Push │  │Background │  │
│  │ bcrypt   │  │ Users    │  │ Real-time│  │ Telemetry │  │
│  │ Roles    │  │ PMS      │  │ Alerts   │  │ Poller    │  │
│  │          │  │ Audit Log│  │ Logs     │  │ (15s)     │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + SSE
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌─────────────────┐               ┌─────────────────┐
│  Staff Dashboard│               │  Guest Portal   │
│  React + Zustand│               │  React + Zustand│
│  :5173 (dev)    │               │  QR code login  │
│  :3000 (prod)   │               │  Room controls  │
└─────────────────┘               └─────────────────┘
```

### Data Flow

1. **ESP32 gateway** sends sensor telemetry to ThingsBoard via MQTT every ~30 seconds
2. **Express server** background poller fetches all device telemetry from ThingsBoard every 15 seconds
3. **Change detection** compares new telemetry against previous values and emits SSE events for every state change
4. **Staff dashboard** receives live updates via SSE (`snapshot`, `telemetry`, `log`, `alert` events)
5. **Control commands** from the dashboard write to ThingsBoard telemetry + shared attributes → gateway applies relay changes

---

## Features

### Staff Dashboard

#### KPI Row
- Occupancy rate (rooms occupied / total)
- Revenue estimate (rack rate × occupied rooms, owner only)
- Alert count (active SOS + offline devices)
- Average temperature across all rooms
- MUR service count (housekeeping requests)
- DND service count
- Room status distribution donut chart

#### Room Heatmap
- Color-coded grid showing all 300 rooms at a glance
- Each cell shows room number and status color
- Click any room to open the Room Control Modal
- Live updates via SSE

#### Room Table
- Sortable list of all rooms with floor, type, status, temperature, door state, active lines, and service flags
- **Filter by**: All / Vacant / Occupied / MUR / Maintenance / DND / SOS / Power Down
- **Filter by floor**: 1–15
- **Checkout button**: appears for occupied rooms with an active reservation (all staff roles)
- **Status dropdown**: quick status change without opening the full modal
- Shows PD (Power Down) flag badge in red when active

#### Room Control Modal
Accessible by clicking any room. Contents depend on role:

| Section | Owner / Admin | Front Desk | Guest |
|---------|:---:|:---:|:---:|
| Power Down toggle | ✓ | ✓ | — |
| Checkout button | ✓ | ✓ | — |
| Sensors (Temp/Humid/CO₂) | ✓ | ✓ | ✓ |
| PIR motion status | ✓ | ✓ | — |
| Door contact + unlock | ✓ | ✓ | ✓ |
| Lights & Dimmers | ✓ | — | ✓ |
| AC (mode, temp, fan) | ✓ | — | ✓ |
| Curtains & Blinds | ✓ | — | ✓ |
| Services (DND/MUR/SOS) | ✓ | view | ✓ |
| Electricity/Water meters | ✓ | ✓ | — |
| Device info (FW/GW version) | ✓ | — | — |
| Set room status | ✓ | ✓ | — |

#### PMS (Property Management System)
- Create reservations: room number, guest name, check-in/out dates
- Auto-generates a 6-digit guest password
- Stable room-based QR code (same URL per room, credentials change per reservation)
- Guest name matching: accepts full name, first name, or last name
- Active / Expired reservation list
- **Export all reservations to CSV** (⬇ Export CSV button)
- **Delete expired history** (🗑 Delete History — active reservations are never deleted)
- Cancelling a reservation instantly locks the guest out via SSE push

#### Logs Panel
- Live audit log stream via SSE — no page refresh needed
- Filter by category: System / Control / PMS / Telemetry / Sensor / Service
- **Export log to CSV** (⬇ Export CSV button)
- **Clear all logs** from the database (🗑 Clear button)
- Logged events include: logins, control commands, room status changes, door events, motion detection, service requests, PMS operations

---

### Guest Portal

Guests access the portal by scanning a room QR code or visiting `/guest?room=XXXX`.

**Login flow:**
1. Guest enters their name (full, first, or last) and the 6-digit password from their room card
2. Server validates against the active reservation for that room and today's date
3. JWT token issued with `role: guest` and `room` claim embedded
4. Guest is redirected to `/guest-portal` — their personal room control page

**Guest capabilities:**
- View sensors: temperature, humidity, CO₂
- Control lights (Line 1/2/3, dimmers)
- Control AC (mode, setpoint, fan speed)
- Control curtains and blinds
- Unlock door (5-second countdown, auto-relocks if door contact stays closed)
- Toggle DND / request MUR / trigger SOS

**Automatic updates:**
- Real-time telemetry via SSE (same SSE endpoint as staff)
- 30-second polling fallback if SSE drops

**Lockout screen:**
- Shown instantly when hotel management cancels the reservation or triggers checkout
- Polite message asking guest to visit reception
- Triggered by SSE `lockout` event — no page reload needed

---

### Room Status Flow

```
  VACANT (0)
     │
     │  Door opens (auto)
     ▼
  OCCUPIED (1)
     │
     │  Frontdesk / Admin clicks "Checkout"
     ▼
  MUR (2) — Make Up Room (housekeeping needed)
     │
     │  Housekeeping done → staff sets to VACANT
     ▼
  VACANT (0)

  Any state ─── Admin sets "Maintenance" ──▶ MAINTENANCE (3)
  MAINTENANCE ── After fix → staff sets to MUR or VACANT
```

**Auto-occupancy:** When the door contact opens and the room is currently VACANT, the server automatically sets the room to OCCUPIED. This is logged as `source: auto` in the audit trail.

**DND / MUR / SOS** are independent service flags, not room statuses. Any number of them can be active simultaneously alongside any room status.

---

### Power Down Mode

Power Down (PD) is a separate management control — it does not change the room status.

| | Normal Mode | PD Mode |
|--|--|--|
| Room status | As set by staff | Unchanged |
| Lights / AC / Curtains | Controlled by relay | All cut to OFF immediately |
| Guest controls | Enabled | **Blocked server-side** |
| Guest portal | Full access | Red banner: "Power restricted" |
| Re-enable | — | Staff toggles off PD |

**How it works:**
1. Admin/Owner/Front Desk clicks **⚡ Power Down Room** in the Room Modal
2. Server writes `pdMode=true` + cuts all relays to OFF in ThingsBoard
3. `roomPDState[room]` is updated in-memory immediately — guest RPC calls are blocked within milliseconds
4. Guest portal receives SSE `telemetry` event with `pdMode: true` → PD banner shown, controls hidden
5. To restore: staff clicks **⚡ Power Down ACTIVE — Tap to Restore**
6. Server writes `pdMode=false`, guest portal receives SSE update, controls reappear

> PD mode is distinct from checkout/lockout. Lockout cancels the reservation (permanent until re-check-in). PD mode only cuts power and can be toggled freely.

---

### Real-time Events

The server pushes events to all connected browsers via Server-Sent Events (SSE):

| Event | Payload | Recipients |
|-------|---------|-----------|
| `snapshot` | Full room overview (all 300 rooms) | Staff only |
| `telemetry` | `{ room, data: { key: value, ... } }` | Staff + Guest (own room) |
| `log` | `{ ts, cat, msg, room, source }` | Staff only |
| `alert` | `{ type: 'SOS'\|'MUR', room, message, ts }` | Staff only |
| `lockout` | `{ room }` | Guest (own room) — triggers lockout screen |

**Audio alerts:** The staff dashboard plays audio tones via the Web Audio API:
- **SOS**: 3 urgent high-pitched pulses at 1100 Hz
- **MUR**: 2 medium chimes at 750 Hz

---

### Audit Logging

Every significant action is written to SQLite and broadcast via SSE:

| Category | Examples |
|----------|---------|
| `auth` | Login success/failure, logout, guest login |
| `control` | setLines, setAC, setDoorUnlock, setPDMode, setRoomStatus |
| `pms` | Reservation created/cancelled, checkout, history cleared |
| `system` | Server start, room status change, auto-occupancy, PD mode, lockdown |
| `sensor` | Door opened/closed, motion detected/cleared |
| `service` | DND/MUR/SOS activated/cleared |
| `telemetry` | AC mode, fan speed, dimmer changes |

---

### Gateway Simulator

`gateway_simulator.py` simulates all 300 room gateways sending realistic telemetry to ThingsBoard. Use it for demos and testing without physical hardware.

```bash
# Basic usage (reads gateway_tokens.csv automatically)
python3 gateway_simulator.py

# Options
python3 gateway_simulator.py \
  --tb-host http://localhost:8080 \
  --rooms 50          # simulate only 50 rooms
  --interval 30       # send every 30 seconds (default)
  --workers 20        # parallel HTTP threads
  --fast              # rapid mode (5s interval)
  --verbose           # show per-room details
  --no-attributes     # skip relay attribute writes
```

**Simulated behaviors:**
- Temperature drift, humidity changes, CO₂ fluctuation
- Door open/close events based on occupancy
- PIR motion detection during occupied hours
- Random MUR requests (0.4% chance per tick)
- Random SOS alerts (0.15% chance per tick)
- Device fault simulation (0.1% chance)
- DND and service flags with auto-clear after random ticks
- Realistic occupancy patterns by room type (Standard/Deluxe/Suite/VIP)

All simulator events appear in the dashboard **Logs panel** within 15 seconds (via the background telemetry poller), including SOS/MUR alerts with audio notification.

---

## User Roles

| Role | Username | Description |
|------|----------|-------------|
| **Owner** | `owner` | Full access — all controls, revenue KPI, user management |
| **Admin** | `admin` | Operations — room controls, PMS, audit logs |
| **Front Desk** | `frontdesk` | Room status changes, checkout, PMS, view sensors |
| **Guest** | *(dynamic)* | Own room only — lights, AC, curtains, door, DND/MUR/SOS |

Default password for all staff accounts: **`hilton2026`**

> Change passwords immediately in production. Use `POST /api/users` with an owner token.

---

## Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| **Node.js** | 18 LTS or newer | [nodejs.org](https://nodejs.org) |
| **ThingsBoard Community Edition** | 3.x | Running at `localhost:8080` |
| **Python** | 3.8+ | Required only for the gateway simulator |
| **Git** | Any | For cloning the repository |

ThingsBoard must have devices named `gateway-room-XXXX` (where XXXX is the room number). Run the v1 `setup.py` to create all 300 devices if starting fresh.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/mshafieee/hilton-hotel-grms.git
cd hilton-hotel-grms
```

### 2. Install dependencies

```bash
# Server dependencies
cd server && npm install && cd ..

# Client dependencies
cd client && npm install && cd ..
```

### 3. Configure environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
PORT=3000
NODE_ENV=development

# ThingsBoard — must match your TB instance
TB_HOST=http://localhost:8080
TB_USER=admin@hiltongrand.com
TB_PASS=hilton

# Generate a strong secret:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your_random_64_char_string_here
JWT_EXPIRY=8h
JWT_REFRESH_EXPIRY=7d

# Frontend URL (change in production)
CORS_ORIGIN=http://localhost:5173

# Background telemetry poll interval (milliseconds)
POLL_INTERVAL_MS=15000

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

Expected output:
```
═══════════════════════════════════════════════════════
  HILTON GRAND HOTEL IoT Platform v2.0
  JWT Auth · SQLite · Helmet · Rate Limit
═══════════════════════════════════════════════════════
  Server:    http://localhost:3000
  Frontend:  http://localhost:5173
  Telemetry poll: every 15s
═══════════════════════════════════════════════════════
✓ Seeded 3 default users (password: hilton2026)
✓ ThingsBoard authenticated
✓ 300 ThingsBoard devices
```

**Terminal 2 — Frontend:**
```bash
cd client
npx vite --host
```

Open **http://localhost:5173** in your browser.

### Running the Gateway Simulator (optional)

```bash
# Install requests library (recommended for better performance)
pip3 install requests

# Start simulating all 300 rooms
python3 gateway_simulator.py
```

Press `Ctrl+C` to stop.

---

## Production Deployment

### 1. Build the frontend

```bash
cd client
npx vite build
```

The built files go into `client/dist/`.

### 2. Run in production mode

```bash
cd server
NODE_ENV=production node index.js
```

The server serves both the API and the static frontend from port 3000. Open **http://your-server:3000**.

### 3. HTTPS with nginx (recommended)

```nginx
server {
    listen 443 ssl http2;
    server_name hotel.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/hotel.crt;
    ssl_certificate_key /etc/ssl/private/hotel.key;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;

        # Required for SSE (Server-Sent Events)
        proxy_buffering    off;
        proxy_read_timeout 24h;
    }
}

server {
    listen 80;
    server_name hotel.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

### 4. Process manager

```bash
# Install PM2
npm install -g pm2

# Start the server
pm2 start server/index.js --name hilton-grms

# Auto-restart on reboot
pm2 startup
pm2 save
```

---

## Project Structure

```
hilton-hotel-grms/
├── README.md
├── SETUP_GUIDE.md              ← Simplified setup guide for non-technical users
├── package.json                ← Root package (npm run dev shortcut)
├── setup.py                    ← ThingsBoard device provisioning script
├── gateway_simulator.py        ← Python simulator for all 300 rooms
├── gateway_tokens.csv          ← Room tokens for ThingsBoard (300 rooms)
│
├── server/
│   ├── index.js                ← Express server — all routes, SSE, control logic
│   ├── auth.js                 ← JWT middleware, token generation, role guards
│   ├── db.js                   ← SQLite schema, table creation, user seeding
│   ├── thingsboard.js          ← ThingsBoard REST API client
│   ├── .env.example            ← Configuration template
│   └── package.json
│
└── client/
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx             ← Routing (login / dashboard / guest-portal)
        ├── index.css           ← Global styles + Tailwind
        ├── utils/
        │   └── api.js          ← Fetch wrapper — auto JWT, auto-refresh on 401
        ├── store/
        │   ├── authStore.js    ← Auth state — login, logout, token persistence
        │   └── hotelStore.js   ← Room state, SSE, polling, RPC, checkout
        ├── pages/
        │   ├── LoginPage.jsx   ← Staff + guest login
        │   ├── DashboardPage.jsx ← Main staff layout with tabs + audio alerts
        │   └── GuestPortal.jsx ← Guest room control page with SSE + lockout
        └── components/
            ├── KPIRow.jsx      ← KPI cards + room status distribution chart
            ├── Heatmap.jsx     ← 15×20 color-coded room grid
            ├── RoomTable.jsx   ← Room list with filters + checkout + status change
            ├── RoomModal.jsx   ← Full room control modal (staff + guest)
            ├── PMSPanel.jsx    ← Reservation management + QR codes
            ├── LogsPanel.jsx   ← Live audit log viewer
            └── AlertToast.jsx  ← SOS/MUR toast notifications
```

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/login` | — | Staff login → `{ accessToken, refreshToken, user }` |
| `POST` | `/api/auth/refresh` | — | Refresh access token |
| `POST` | `/api/auth/logout` | JWT | Invalidate refresh token |
| `GET`  | `/api/auth/me` | JWT | Current user info |
| `POST` | `/api/guest/login` | — | Guest login → `{ accessToken, room }` |

### Hotel

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET`  | `/api/hotel/overview` | staff | All rooms + telemetry + reservations |
| `GET`  | `/api/events` | any | SSE stream (`?token=JWT`) |
| `POST` | `/api/devices/:id/rpc` | owner, admin | Send control command to device |

### PMS

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET`  | `/api/pms/reservations` | staff | List all reservations |
| `POST` | `/api/pms/reservations` | owner, admin, user | Create reservation |
| `DELETE` | `/api/pms/reservations/:id` | staff | Cancel reservation |
| `GET`  | `/api/pms/reservations/:id/link` | staff | Get guest URL + password |
| `GET`  | `/api/pms/export` | staff | Download all reservations as CSV |
| `DELETE` | `/api/pms/history` | owner, admin | Delete cancelled/expired records |

### Room Operations

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `POST` | `/api/rooms/:room/checkout` | staff | Cancel reservation, set MUR, notify guest |
| `POST` | `/api/rooms/:room/lockdown` | owner, admin | Cancel all reservations + SSE lockout |

### Logs

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET`  | `/api/logs` | owner, admin | Recent audit log entries |
| `GET`  | `/api/logs/export` | owner, admin | Download full log as CSV |
| `DELETE` | `/api/logs` | owner, admin | Clear all audit log records |

### Guest

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET`  | `/api/guest/room` | guest JWT | Active reservation + cached room data |
| `GET`  | `/api/guest/room/data` | guest JWT | Live room telemetry (with TB fallback) |
| `POST` | `/api/guest/rpc` | guest JWT | Send control command (limited methods) |

**Allowed guest RPC methods:** `setLines`, `setAC`, `setCurtainsBlinds`, `setService`, `resetServices`, `setDoorUnlock`, `setDoorLock`

### User Management

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET`  | `/api/users` | owner | List all staff users |
| `POST` | `/api/users` | owner | Create staff user |

---

## Security

| Mechanism | Implementation |
|-----------|---------------|
| **Password hashing** | bcrypt (10 rounds) |
| **Authentication** | JWT — 8h access token + 7d refresh token |
| **Role enforcement** | Server-side middleware on every protected route |
| **Rate limiting** | 10 login attempts per 15 minutes (configurable) |
| **Security headers** | Helmet.js — XSS protection, MIME sniffing prevention, frameguard |
| **CORS** | Locked to `CORS_ORIGIN` env variable |
| **Guest isolation** | JWT `room` claim — guests can only control their assigned room |
| **PD enforcement** | Server-side `roomPDState` cache — guest RPC blocked immediately on PD activation |
| **Secrets** | `server/.env` excluded from git via `.gitignore` |

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| Server says `TB auth failed` | Check ThingsBoard is running at the URL in `.env` |
| `Cannot find module 'better-sqlite3'` | Run `cd server && npm install` |
| Dashboard shows 0 rooms | ThingsBoard needs devices named `gateway-room-XXXX` — run `setup.py` |
| Guest login fails | Reservation must be active today; name must match (full, first, or last) |
| Guest portal blank screen | Server cache cold — wait for first `/api/hotel/overview` poll or reload |
| No audio alerts | Browser requires a user gesture before Web Audio API is allowed — click anything first |
| `CORS error` in browser | Make sure `CORS_ORIGIN` in `.env` exactly matches your frontend URL including port |
| SSE disconnects frequently | Add `proxy_buffering off; proxy_read_timeout 24h;` to your nginx config |
| PD not blocking guest immediately | PD state syncs in-memory on `sendControl` — should be instant; check server logs |

---

## License

Private — Hilton Grand Hotel IoT Platform v2.0. All rights reserved.
