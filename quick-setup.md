# iHotel — Quick Setup Guide (Azhar Demo)

## Prerequisites
- Docker running with ThingsBoard at `http://localhost:8080`
- Azhar tenant created, admin: `admin@azhar.com` / `azhar123`
- Node.js ≥ 18, Python 3.8+

---

## Step 1 — Install dependencies

**Terminal A (server):**
```bash
cd server
npm install
```

**Terminal B (client):**
```bash
cd client
npm install
```

---

## Step 2 — Provision 80 devices in ThingsBoard

From the project root:
```bash
python3 setup.py --seed-telemetry
```

Creates `gateway-room-101` → `gateway-room-1008` (10 floors × 8 rooms).
Verify in TB: **http://localhost:8080** → Tenant Azhar → Devices → 80 entries.

---

## Step 3 — Fresh database (first run only)

Delete the old single-tenant DB so multi-tenant migrations run clean:
```bash
rm server/hilton.db server/hilton.db-shm server/hilton.db-wal
```

---

## Step 4 — Start the server

**Terminal A:**
```bash
cd server
npm run dev
```

On first boot you should see:
```
Platform admin seeded: superadmin
Server running on port 3000
```

---

## Step 5 — Start the client

**Terminal B:**
```bash
cd client
npm run dev
```

App available at **http://localhost:5173**

---

## Step 6 — Log in as Platform Admin

Open **http://localhost:5173/platform/login**

| Field    | Value        |
|----------|--------------|
| Username | `superadmin` |
| Password | `123123123`  |

---

## Step 7 — Create the Azhar hotel

Click **+ Create Hotel** and fill in:

| Field          | Value                    |
|----------------|--------------------------|
| Hotel Name     | `Azhar`                  |
| Hotel Code     | `azhar`                  |
| Contact Email  | `admin@azhar.com`        |
| TB Host        | `http://localhost:8080`  |
| TB Username    | `admin@azhar.com`        |
| TB Password    | `azhar123`               |

Click **Create**.

---

## Step 8 — Discover rooms from ThingsBoard

1. Click the **Azhar** hotel row to open its detail drawer
2. Go to the **Rooms** tab
3. Click **"Discover Rooms from TB"**

Expected result: `80 rooms discovered` — all `gateway-room-*` devices linked.

---

## Step 9 — Create a staff user

Hotel detail drawer → **Users** tab → **+ Create User**:

| Field     | Value        |
|-----------|--------------|
| Username  | `frontdesk`  |
| Password  | `azhar2026`  |
| Role      | `frontdesk`  |
| Full Name | `Front Desk` |

---

## Step 10 — Log in as hotel staff

Open **http://localhost:5173/login**

| Field      | Value       |
|------------|-------------|
| Hotel Code | `azhar`     |
| Username   | `frontdesk` |
| Password   | `azhar2026` |

Dashboard should show all 80 rooms with seeded telemetry.

---

## Credentials Summary

| Who             | URL               | Username          | Password    |
|-----------------|-------------------|-------------------|-------------|
| Platform Admin  | `/platform/login` | `superadmin`      | `123123123` |
| Hotel Staff     | `/login`          | `frontdesk`       | `azhar2026` |
| ThingsBoard     | `localhost:8080`  | `admin@azhar.com` | `azhar123`  |

---

## Room Layout (every floor identical)

| Rooms   | Type     | Count       | Rate          |
|---------|----------|-------------|---------------|
| 1 – 4   | STANDARD | 40 total    | SAR 600/night |
| 5 – 6   | SUITE    | 20 total    | SAR 1500/night|
| 7 – 8   | VIP      | 20 total    | SAR 2500/night|

Room numbers: F1 → 101–108, F2 → 201–208, … F10 → 1001–1008

---

## Useful Commands

```bash
# Re-run setup only (no telemetry seed)
python3 setup.py

# Check provisioning status
python3 setup.py --status

# Remove all TB devices and start over
python3 setup.py --cleanup --force

# Dry-run (preview without creating)
python3 setup.py --dry-run
```
