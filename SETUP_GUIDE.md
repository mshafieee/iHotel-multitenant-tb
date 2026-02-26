# Hilton Grand Hotel IoT Platform v2.0 — Setup Guide

## What You Need Before Starting

You need these programs installed on your computer. If you don't have them, follow the links to download.

| Program | What It Does | Download |
|---------|-------------|----------|
| **Node.js** (v18 or newer) | Runs the server and frontend | https://nodejs.org (click "LTS" button) |
| **ThingsBoard** | IoT platform for device data | Already running at localhost:8080 |
| **Git** (optional) | Version control | https://git-scm.com |

To check if Node.js is installed, open a terminal (Command Prompt on Windows) and type:

```
node --version
```

If you see `v18.x.x` or higher, you're good.

---

## Step 1: Create the Project Folder

Open a terminal and run:

```bash
# Windows
mkdir C:\HiltonProject-v2
cd C:\HiltonProject-v2

# Mac/Linux
mkdir ~/HiltonProject-v2
cd ~/HiltonProject-v2
```

## Step 2: Copy the Downloaded Files

After downloading from Claude, your folder should look like this:

```
HiltonProject-v2/
├── package.json                 ← Root config
├── server/
│   ├── package.json
│   ├── index.js                 ← Main server (all API routes)
│   ├── db.js                    ← Database setup
│   ├── auth.js                  ← Authentication logic
│   ├── thingsboard.js           ← ThingsBoard connection
│   ├── .env                     ← Your configuration (EDIT THIS)
│   └── .env.example             ← Template
└── client/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── utils/
        │   └── api.js
        ├── store/
        │   ├── authStore.js
        │   └── hotelStore.js
        ├── pages/
        │   ├── LoginPage.jsx
        │   └── DashboardPage.jsx
        └── components/
            ├── KPIRow.jsx
            ├── Heatmap.jsx
            ├── RoomTable.jsx
            ├── RoomModal.jsx
            ├── PMSPanel.jsx
            ├── LogsPanel.jsx
            └── AlertToast.jsx
```

## Step 3: Configure Your Settings

Open `server/.env` in any text editor (Notepad, VS Code, etc.) and update these values:

```env
# Server port
PORT=3000

# Your ThingsBoard address
TB_HOST=http://localhost:8080
TB_USER=admin@hiltongrand.com
TB_PASS=hilton

# IMPORTANT: Change this to a random string for security
# You can generate one by running: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=paste_your_random_string_here

# Frontend URL (don't change for local development)
CORS_ORIGIN=http://localhost:5173
```

## Step 4: Install Dependencies

This downloads all the libraries the project needs. Run these commands one at a time:

```bash
# From the project root folder (HiltonProject-v2)

# Install root dependencies
npm install

# Install server dependencies
cd server
npm install
cd ..

# Install frontend dependencies
cd client
npm install
cd ..
```

This may take 2-5 minutes. You'll see some warnings — that's normal.

## Step 5: Start the System

You need **2 terminal windows** open side by side:

### Terminal 1 — Backend Server

```bash
cd server
node index.js
```

You should see:

```
═══════════════════════════════════════════════════════
  HILTON GRAND HOTEL IoT Platform v2.0
  JWT Auth · SQLite · Helmet · Rate Limit
═══════════════════════════════════════════════════════
  Server:    http://localhost:3000
  Frontend:  http://localhost:5173
═══════════════════════════════════════════════════════
✓ Seeded 3 default users (password: hilton2026)
✓ ThingsBoard authenticated
✓ 300 ThingsBoard devices
```

### Terminal 2 — Frontend

```bash
cd client
npx vite --host
```

You should see:

```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

## Step 6: Open the Dashboard

Open your web browser and go to:

```
http://localhost:5173
```

You'll see a login screen.

### Default Login Credentials

| Username | Password | Role | Access Level |
|----------|----------|------|-------------|
| `owner` | `hilton2026` | Owner | Full access — all controls, revenue, user management |
| `admin` | `hilton2026` | Admin | Operations — room controls, PMS, logs |
| `frontdesk` | `hilton2026` | Front Desk | Room status changes, view-only sensors |

You can also click the quick-access buttons at the bottom of the login page.

---

## How It All Works (Architecture)

```
┌──────────────┐     MQTT      ┌──────────────┐
│  ESP32 Room   │──────────────▶│ ThingsBoard  │
│  Gateways     │◀──────────────│  :8080       │
│  (Hardware)   │   Shared Attr │              │
└──────────────┘               └──────┬───────┘
                                      │ REST API
                                      ▼
                              ┌────────────────────┐
                              │  Express Server     │
                              │  :3000              │
                              │  • JWT Auth         │
                              │  • SQLite DB        │
                              │  • SSE Push         │
                              │  • Rate Limiting    │
                              │  • Helmet Security  │
                              └────────┬───────────┘
                                       │ REST + SSE
                                       ▼
                              ┌────────────────────┐
                              │  React Frontend     │
                              │  :5173 (dev)        │
                              │  • Zustand State    │
                              │  • Tailwind CSS     │
                              │  • Component-based  │
                              └────────────────────┘
```

---

## Security Features (What's New vs v1)

| Feature | v1 (Old) | v2 (New) |
|---------|----------|----------|
| **Authentication** | Hardcoded passwords in browser JS | JWT tokens with bcrypt hashing |
| **Session** | None — anyone with URL has access | 8-hour access tokens + 7-day refresh |
| **Password Storage** | Plaintext in JavaScript | bcrypt hashed in SQLite database |
| **API Protection** | None — all routes open | Every route requires valid JWT |
| **Rate Limiting** | None | 10 login attempts per 15 minutes |
| **Security Headers** | None | Helmet.js (XSS, MIME sniffing, etc.) |
| **Data Persistence** | In-memory (lost on restart) | SQLite database file |
| **CORS** | Allow all origins | Locked to specific frontend URL |
| **Input Validation** | None | Server-side validation on all inputs |
| **Audit Log** | In-memory array | Persistent SQLite table |

---

## Changing Passwords

Default password is `hilton2026`. To change it:

1. Login as **owner**
2. Use the API directly (user management UI coming soon):

```bash
# From a terminal, while the server is running:
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"newuser","password":"SecurePass123!","role":"admin","fullName":"John Smith"}'
```

---

## Building for Production

When you're ready to deploy to an actual hotel server:

### 1. Build the Frontend

```bash
cd client
npx vite build
```

This creates a `client/dist/` folder with optimized files.

### 2. Run in Production Mode

```bash
cd server
NODE_ENV=production node index.js
```

Now the server serves both the API AND the frontend from port 3000. You only need **one terminal**.

Open: `http://localhost:3000`

### 3. Use a Reverse Proxy (Recommended)

For HTTPS support, put nginx in front:

```nginx
server {
    listen 443 ssl;
    server_name hotel.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails | Make sure Node.js v18+ is installed: `node --version` |
| "Cannot find module 'better-sqlite3'" | Run `cd server && npm install` again |
| Server says "TB auth failed" | Check ThingsBoard is running at the URL in `.env` |
| Login page shows but login fails | Check server terminal for errors. Default password is `hilton2026` |
| Frontend shows blank white page | Check browser console (F12) for errors |
| "CORS error" in browser | Make sure CORS_ORIGIN in `.env` matches your frontend URL |
| Dashboard shows no rooms | ThingsBoard needs devices created (run setup.py from v1) |
| Vite command not found | Run `cd client && npm install` first |

---

## File Descriptions

### Server Files

| File | Purpose |
|------|---------|
| `server/index.js` | Main Express server — all API routes, SSE, control logic |
| `server/db.js` | SQLite database — creates tables, seeds default users |
| `server/auth.js` | JWT middleware — token generation, verification, role checks |
| `server/thingsboard.js` | ThingsBoard REST API client |
| `server/.env` | Your configuration (ThingsBoard URL, JWT secret, etc.) |
| `server/hilton.db` | SQLite database file (auto-created on first run) |

### Client Files

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main app — routing between login and dashboard |
| `src/store/authStore.js` | Login state — manages JWT tokens, user info |
| `src/store/hotelStore.js` | Hotel state — rooms, telemetry, SSE connection |
| `src/utils/api.js` | HTTP client — auto-attaches JWT, refreshes expired tokens |
| `src/pages/LoginPage.jsx` | Login screen with username/password form |
| `src/pages/DashboardPage.jsx` | Main dashboard layout with tabs |
| `src/components/RoomModal.jsx` | Room control popup — lights, AC, door, services |
| `src/components/KPIRow.jsx` | KPI cards — occupancy, revenue, alerts |
| `src/components/Heatmap.jsx` | 15×20 room color grid |
| `src/components/RoomTable.jsx` | Room list with filters |
| `src/components/PMSPanel.jsx` | Reservation management |
| `src/components/LogsPanel.jsx` | Event log viewer |
| `src/components/AlertToast.jsx` | SOS/MUR notification popups |
