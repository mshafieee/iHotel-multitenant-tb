/**
 * ╔═════════════════════════════════════════════════════════════════╗
 * ║  iHotel SaaS Platform — Server v4.0 (Multi-Tenant + Modular)  ║
 * ║  JWT Auth · SQLite · IoT Adapter · SSE · Helmet · Rate Lim    ║
 * ╚═════════════════════════════════════════════════════════════════╝
 */
require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const http      = require('http');
const path      = require('path');
const WebSocket = require('ws');

const { initDB }                  = require('./db');
const { createPool }              = require('./adapters');
const { initServices, state, sse, control, room, scene, audit } = require('./services');
const { setDB, authenticate, requireRole, generateAccessToken, generateRefreshToken, JWT_SECRET } = require('./auth');
const nodemailer                  = require('nodemailer');
const webpush                     = require('web-push');

// ═══ INIT ═══
const db          = initDB();
setDB(db);
const adapterPool = createPool() // platform type is per-hotel (hotels.platform_type);
initServices(db, adapterPool);

// ── Web Push VAPID keys (generated once, stored in platform_config) ──────────
(function initVapid() {
  let pub = db.prepare("SELECT value FROM platform_config WHERE key='vapid_public'").get();
  let prv = db.prepare("SELECT value FROM platform_config WHERE key='vapid_private'").get();
  if (!pub || !prv) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare("INSERT OR REPLACE INTO platform_config (key,value) VALUES ('vapid_public',?)").run(keys.publicKey);
    db.prepare("INSERT OR REPLACE INTO platform_config (key,value) VALUES ('vapid_private',?)").run(keys.privateKey);
    pub = { value: keys.publicKey };
    prv = { value: keys.privateKey };
    console.log('✓ VAPID keys generated');
  }
  webpush.setVapidDetails('mailto:admin@ihotel.app', pub.value, prv.value);
})();

// ── Email transporter (optional — only used for password reset) ──────────────
// Configure SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in server/.env
// Works with Outlook, Gmail (app password), or any SMTP relay.
let _mailer = null;
function getMailer() {
  if (_mailer) return _mailer;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  _mailer = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
  return _mailer;
}

// ═══ PLATFORM ROUTER ═══
const platformModule = require('./platform');
platformModule.init(db, adapterPool);

// ═══ CONSTANTS (from services) ═══
const PORT = process.env.PORT || 3000;
const { ROOM_TYPES, FLOOR_TYPE, TELEMETRY_KEYS, RELAY_KEYS, SHARED_CONTROL_KEYS, extractRoom, parseTelemetry } = room;
const { sendControl, controlToTelemetry, controlToRelayAttributes, impliesActivity, startNotOccupiedTimer, restoreOccupied, vacateRoom, coerceTelemetry } = control;
const { fetchAndBroadcast, processTelemetry, startPlatformSubscription, detectAndLogChanges } = room;
const { sseConnect, sseBroadcast, sseBroadcastAlert, sseBroadcastRoles, sseBroadcastUser, sseBatchTelemetry, fireServiceAlert } = sse;
const { getDeviceRoomMap, getLastOverviewRooms, getLastKnownTelemetry, getRoomPDState, getDoorOpenTimers, getSleepTimers, getRoomStateSnapshots, isOverviewStale, isFetchingOverview, setFetchingOverview, clearFetchingOverview } = state;
const { addLog } = audit;
const { checkEventScenes, executeScene } = scene;

const ROOM_STATUS   = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED'];
const AC_MODES      = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS    = ['LOW', 'MED', 'HIGH', 'AUTO'];
const DEVICE_STATUSES = ['normal', 'boot', 'fault'];
const RACK_RATES    = { STANDARD: 600, DELUXE: 950, SUITE: 1500, VIP: 2500 };
const WATCHABLE_KEYS = [
  'roomStatus','pirMotionStatus','doorStatus',
  'line1','line2','line3','line4','line5','line6','line7','line8',
  'dimmer1','dimmer2','dimmer3','dimmer4',
  'acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition',
  'dndService','murService','sosService','deviceStatus','pdMode'
];

// ═══ EXPRESS APP ═══
const app = express();
app.set('trust proxy', 1); // Required when running behind Fly.io / reverse proxy

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({
  windowMs: (parseInt(process.env.LOGIN_RATE_WINDOW_MIN) || 15) * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT) || 10,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true, legacyHeaders: false
});

const guestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed attempts. Please wait a few minutes and try again.' },
  standardHeaders: true, legacyHeaders: false
});

const clientBuild = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuild));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);

// ═══ PLATFORM ROUTES ═══
app.use('/api/platform', platformModule.router);

// ═══ ADAPTER HELPER ═══
function getHotelAdapter(hotelId) {
  const adapter = adapterPool.getAdapter(hotelId, db);
  if (!adapter) throw new Error('Smart room control is not configured for this hotel. Contact the platform admin.');
  return adapter;
}

// (State, SSE, telemetry pipeline, change detection, control logic, scene engine
//  are all now in server/services/ — imported above)

// (processTelemetry, startTbSubscription, SSE broadcast, batching, audit log,
//  telemetry helpers, change detection — all now in services/)

// (Real-time subscription — now in room.service.startPlatformSubscription)

// (SSE broadcast, batching, service alerts, audit log — all in services/)

// ═══ AUTH ROUTES ═══
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { hotelSlug, username, password } = req.body;
  if (!hotelSlug || !username || !password) {
    return res.status(400).json({ error: 'Hotel code, username and password required' });
  }

  // Resolve hotel by slug
  const hotel = db.prepare('SELECT * FROM hotels WHERE slug = ? AND active = 1').get(hotelSlug.trim().toLowerCase());
  if (!hotel) {
    return res.status(401).json({ error: 'Invalid hotel code' });
  }

  const user = db.prepare('SELECT * FROM hotel_users WHERE hotel_id = ? AND username = ? AND active = 1')
    .get(hotel.id, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    addLog(hotel.id, 'auth', 'Login failed', { source: username });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const accessToken  = generateAccessToken({ ...user, hotelId: hotel.id });
  const refreshToken = generateRefreshToken(user);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, user_type, token, expires_at) VALUES (?,?,?,?)').run(user.id, 'hotel', refreshToken, expiresAt);
  db.prepare("UPDATE hotel_users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  addLog(hotel.id, 'auth', 'Login successful', { user: username });
  let deviceConfig = hotel.device_config ? JSON.parse(hotel.device_config) : null;
  // Seed default config for TB hotels that haven't run Discover Rooms yet
  if (!deviceConfig && (hotel.platform_type || 'thingsboard') === 'thingsboard') {
    deviceConfig = { lamps: 3, dimmers: 2, ac: 1, curtains: 1, blinds: 1,
      lampNames: ['Line 1 (Main)', 'Line 2 (Bedside)', 'Line 3 (Bath)'],
      dimmerNames: ['Dimmer 1', 'Dimmer 2'] };
    db.prepare('UPDATE hotels SET device_config = ? WHERE id = ?').run(JSON.stringify(deviceConfig), hotel.id);
  }
  res.json({
    accessToken, refreshToken,
    user: { id: user.id, username: user.username, role: user.role, fullName: user.full_name, hotelId: hotel.id, hotelSlug: hotel.slug, hotelName: hotel.name, logoUrl: hotel.logo_url || null, deviceConfig }
  });
});

// ── POST /api/auth/qr-login ───────────────────────────────────────────────
// Instant login using the per-user QR token (no password needed).
app.post('/api/auth/qr-login', authLimiter, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'QR token required' });

  const row = db.prepare(`
    SELECT hu.*, h.slug AS hotelSlug, h.name AS hotelName, h.logo_url AS logoUrl
    FROM hotel_users hu
    JOIN hotels h ON h.id = hu.hotel_id
    WHERE hu.qr_login_token = ? AND hu.active = 1 AND h.active = 1
  `).get(token);
  if (!row) return res.status(401).json({ error: 'Invalid or revoked QR code' });

  const accessToken  = generateAccessToken({ ...row, hotelId: row.hotel_id });
  const refreshToken = generateRefreshToken(row);
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, user_type, token, expires_at) VALUES (?,?,?,?)')
    .run(row.id, 'hotel', refreshToken, expiresAt);
  db.prepare("UPDATE hotel_users SET last_login = datetime('now') WHERE id = ?").run(row.id);

  addLog(row.hotel_id, 'auth', `QR login: ${row.username}`, { user: row.username });
  res.json({
    accessToken, refreshToken,
    user: { id: row.id, username: row.username, role: row.role, fullName: row.full_name,
            hotelId: row.hotel_id, hotelSlug: row.hotelSlug, hotelName: row.hotelName, logoUrl: row.logoUrl || null }
  });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });
  try {
    const jwt     = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const stored  = db.prepare("SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')").get(refreshToken);
    if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });

    const user = db.prepare('SELECT * FROM hotel_users WHERE id = ? AND active = 1').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Find hotelId for this user
    const hotelId = user.hotel_id;
    res.json({ accessToken: generateAccessToken({ ...user, hotelId }) });
  } catch { res.status(401).json({ error: 'Invalid refresh token' }); }
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user  = db.prepare('SELECT id, username, role, full_name, last_login FROM hotel_users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hotel = db.prepare('SELECT slug, name, logo_url, device_config, platform_type FROM hotels WHERE id = ?').get(req.user.hotelId);
  let deviceConfig = hotel?.device_config ? JSON.parse(hotel.device_config) : null;
  if (!deviceConfig && (hotel?.platform_type || 'thingsboard') === 'thingsboard') {
    deviceConfig = { lamps: 3, dimmers: 2, ac: 1, curtains: 1, blinds: 1,
      lampNames: ['Line 1 (Main)', 'Line 2 (Bedside)', 'Line 3 (Bath)'],
      dimmerNames: ['Dimmer 1', 'Dimmer 2'] };
    db.prepare('UPDATE hotels SET device_config = ? WHERE id = ?').run(JSON.stringify(deviceConfig), hotel.id);
  }
  res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name, lastLogin: user.last_login, hotelId: req.user.hotelId, hotelSlug: hotel?.slug || '', hotelName: hotel?.name || '', logoUrl: hotel?.logo_url || null, deviceConfig });
});

// ═══ SSE (authenticated via query token or header) ═══
app.get('/api/events', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  authenticate(req, res, next);
}, sseConnect);

// (Telemetry helpers — now in room.service)

// (Change detection, control logic, NOT_OCCUPIED automation, scene engine
// — all extracted to services/ modules)
// ═══ PROTECTED API ROUTES ═══

// Room control (owner, admin)
app.post('/api/devices/:id/rpc', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const hotelId      = req.user.hotelId;
    const { method, params } = req.body;
    const targetStatus = params?.roomStatus != null ? parseInt(params.roomStatus) : -1;

    // Transitioning to VACANT or NOT_OCCUPIED → full room cleanup
    if (method === 'setRoomStatus' && (targetStatus === 0 || targetStatus === 4)) {
      const deviceRoomMap = getDeviceRoomMap(hotelId);
      const roomNum = Object.keys(deviceRoomMap).find(k => deviceRoomMap[k] === req.params.id) || '?';
      await vacateRoom(hotelId, req.params.id, roomNum, targetStatus, req.user.username);
      return res.json({ success: true });
    }

    res.json({ ok: true });
    sendControl(hotelId, req.params.id, method, params || {}, req.user.username)
      .catch(e => console.error(`[admin rpc] ${method} failed:`, e.message));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// (fetchAndBroadcast is now in room.service — imported at top)

// ── PUT /api/hotel/device-names ────────────────────────────────────────────
// Lets owner/admin rename individual lamps and dimmers in the room UI.
app.put('/api/hotel/device-names', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { lampNames, dimmerNames } = req.body;
  if (!Array.isArray(lampNames) && !Array.isArray(dimmerNames)) {
    return res.status(400).json({ error: 'lampNames or dimmerNames array required' });
  }
  const hotelRow = db.prepare('SELECT device_config FROM hotels WHERE id = ?').get(hotelId);
  const current  = hotelRow?.device_config ? JSON.parse(hotelRow.device_config) : {};
  if (Array.isArray(lampNames))   current.lampNames   = lampNames.map(n => String(n || '').trim());
  if (Array.isArray(dimmerNames)) current.dimmerNames = dimmerNames.map(n => String(n || '').trim());
  db.prepare('UPDATE hotels SET device_config = ? WHERE id = ?').run(JSON.stringify(current), hotelId);
  res.json({ deviceConfig: current });
});

// ── PUT /api/rooms/:roomNumber/device-names ────────────────────────────────
// Rename individual lamps / dimmers for a specific room.
// Writes to hotel_rooms.device_names (per-room override); does NOT touch hotels.device_config.
// After saving, pushes the updated deviceNames via SSE so open RoomModals refresh instantly.
app.put('/api/rooms/:roomNumber/device-names', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId    = req.user.hotelId;
  const roomNumber = req.params.roomNumber;
  const { lampNames, dimmerNames } = req.body;
  if (!Array.isArray(lampNames) && !Array.isArray(dimmerNames)) {
    return res.status(400).json({ error: 'lampNames or dimmerNames required' });
  }

  const row = db.prepare('SELECT device_names FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, roomNumber);
  if (!row) return res.status(404).json({ error: 'Room not found' });

  const current = row.device_names ? JSON.parse(row.device_names) : {};
  if (Array.isArray(lampNames))   current.lampNames   = lampNames.map(n => String(n || '').trim());
  if (Array.isArray(dimmerNames)) current.dimmerNames = dimmerNames.map(n => String(n || '').trim());

  db.prepare('UPDATE hotel_rooms SET device_names=? WHERE hotel_id=? AND room_number=?')
    .run(JSON.stringify(current), hotelId, roomNumber);

  // Push updated names via SSE so the UI reflects them without a page reload
  const lastOverview = getLastOverviewRooms(hotelId);
  if (lastOverview[roomNumber]) lastOverview[roomNumber].deviceNames = current;
  const deviceId = lastOverview[roomNumber]?.deviceId;
  sseBatchTelemetry(hotelId, roomNumber, deviceId || roomNumber, { deviceNames: current });

  res.json({ deviceNames: current });
});

// Hotel overview — always responds instantly with cached snapshot.
// ── GET /api/hotel/meter-stats ─────────────────────────────────────────────
// Returns per-room consumption since last reset and current-month hotel totals.
// Monthly snapshot: if today's YYYY-MM differs from what's stored in hotel_profiles,
// the current total is snapshotted as the new month-start and the month resets.
app.get('/api/hotel/meter-stats', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId  = req.user.hotelId;
  const liveData = getLastOverviewRooms(hotelId);
  const roomRows = db.prepare(
    'SELECT room_number, elec_meter_baseline, water_meter_baseline FROM hotel_rooms WHERE hotel_id=?'
  ).all(hotelId);

  // Build per-room delta (consumption since last reset)
  const rooms = {};
  let hotelElecDelta = 0;
  let hotelWaterDelta = 0;
  for (const r of roomRows) {
    const live = liveData[r.room_number] || {};
    const elec  = live.elecConsumption  || 0;
    const water = live.waterConsumption || 0;
    const elecDelta  = Math.max(0, elec  - (r.elec_meter_baseline  || 0));
    const waterDelta = Math.max(0, water - (r.water_meter_baseline || 0));
    rooms[r.room_number] = { elecDelta: +elecDelta.toFixed(3), waterDelta: +waterDelta.toFixed(3) };
    hotelElecDelta  += elecDelta;
    hotelWaterDelta += waterDelta;
  }

  // Monthly snapshot: track cumulative delta totals across the month.
  // On new month, reset the running totals to 0.
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  let profile = db.prepare('SELECT meter_month, elec_month_start, water_month_start FROM hotel_profiles WHERE hotel_id=?').get(hotelId);
  if (!profile) {
    db.prepare('INSERT OR IGNORE INTO hotel_profiles (hotel_id) VALUES (?)').run(hotelId);
    profile = { meter_month: '', elec_month_start: 0, water_month_start: 0 };
  }
  if ((profile.meter_month || '') !== currentMonth) {
    // New month — snapshot current delta totals as the month-start baseline (effectively 0 since we use deltas)
    db.prepare(
      'UPDATE hotel_profiles SET meter_month=?, elec_month_start=?, water_month_start=? WHERE hotel_id=?'
    ).run(currentMonth, hotelElecDelta, hotelWaterDelta, hotelId);
    profile = { meter_month: currentMonth, elec_month_start: hotelElecDelta, water_month_start: hotelWaterDelta };
  }

  const monthlyKwh = +Math.max(0, hotelElecDelta  - (profile.elec_month_start  || 0)).toFixed(3);
  const monthlyM3  = +Math.max(0, hotelWaterDelta - (profile.water_month_start || 0)).toFixed(3);

  res.json({ rooms, monthlyKwh, monthlyM3, month: currentMonth });
});

// If data is stale (> OVERVIEW_CACHE_TTL), kicks off background TB fetch;
// fresh data is pushed to the client via SSE 'snapshot' event when ready.
app.get('/api/hotel/overview', authenticate, async (req, res) => {
  const hotelId      = req.user.hotelId;
  const lastOverview = getLastOverviewRooms(hotelId);

  // Respond immediately with cached snapshot — never block on IoT platform
  res.json({ rooms: lastOverview, deviceCount: Object.keys(lastOverview).length, cached: true });

  // Trigger a background refresh only when cache is stale OR empty (first load).
  // The subscribe poll keeps lastOverview current between refreshes — don't race with it.
  const hasRooms = Object.keys(lastOverview).length > 0;
  if ((hasRooms && !state.isOverviewStale(hotelId)) || state.isFetchingOverview(hotelId)) return;
  state.setFetchingOverview(hotelId);
  fetchAndBroadcast(hotelId)
    .catch(e => console.error(`[${hotelId}] Overview fetch error:`, e.message))
    .finally(() => state.clearFetchingOverview(hotelId));
});

// Logs
app.get('/api/logs', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const since   = parseInt(req.query.since) || 0;
  const logs    = db.prepare('SELECT ts, category as cat, message as msg, room, source FROM audit_log WHERE hotel_id=? AND ts>? ORDER BY ts DESC LIMIT 200').all(hotelId, since);
  res.json(logs);
});

app.get('/api/logs/export', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const logs    = db.prepare('SELECT ts, category, message, room, source, user FROM audit_log WHERE hotel_id=? ORDER BY ts DESC').all(hotelId);
  const header  = 'Timestamp,Date,Category,Message,Room,Source,User';
  const rows    = logs.map(l => [
    l.ts, new Date(l.ts).toISOString(),
    l.category || '',
    `"${(l.message || '').replace(/"/g, '""')}"`,
    l.room || '', l.source || '', l.user || ''
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="hotel-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header, ...rows].join('\n'));
});

app.delete('/api/logs', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  db.prepare('DELETE FROM audit_log WHERE hotel_id=?').run(hotelId);
  res.json({ success: true });
});

// ═══ PMS ROUTES ═══
app.get('/api/pms/reservations', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;
  const rows    = db.prepare('SELECT * FROM reservations WHERE hotel_id=? ORDER BY created_at DESC LIMIT 100').all(hotelId);
  res.json(rows.map(r => ({
    id: r.id, room: r.room, guestName: r.guest_name,
    checkIn: r.check_in, checkOut: r.check_out,
    password: r.password, active: !!r.active, token: r.token,
    paymentMethod: r.payment_method, thirdPartyChannel: r.thirdparty_channel || '',
  })));
});

app.post('/api/pms/reservations', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { room, guestName, checkIn, checkOut, paymentMethod, ratePerNight, thirdPartyChannel } = req.body;
  if (!room || !guestName || !checkIn || !checkOut) return res.status(400).json({ error: 'All fields required' });
  const bookingChannel = (paymentMethod === 'thirdparty' && thirdPartyChannel)
    ? String(thirdPartyChannel).trim().slice(0, 100) : '';

  // Validate dates
  if (new Date(checkOut) <= new Date(checkIn)) {
    return res.status(400).json({ error: 'Check-out date must be after check-in date' });
  }

  // Validate room exists in this hotel
  const lastOverview = getLastOverviewRooms(hotelId);
  const hotelRoomRow = db.prepare('SELECT room_number FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, String(room));
  if (!hotelRoomRow && !lastOverview[String(room)]) {
    return res.status(400).json({ error: `Room ${room} does not exist in this hotel` });
  }

  // No duplicate active reservations
  const existingRes = db.prepare("SELECT id FROM reservations WHERE hotel_id=? AND room=? AND active=1").get(hotelId, String(room));
  if (existingRes) {
    return res.status(409).json({ error: `Room ${room} already has an active reservation. Cancel it first.` });
  }

  const id            = crypto.randomUUID();
  const plainPassword = crypto.randomInt(100000, 999999).toString();
  const hashedPassword = bcrypt.hashSync(plainPassword, 10);
  const token         = crypto.randomBytes(16).toString('hex');

  // Determine room type: check hotel_rooms first, then fall back to floor-based
  const hotelRoom = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, room);
  const roomType  = hotelRoom?.room_type || ROOM_TYPES[FLOOR_TYPE[parseInt(room.length <= 3 ? room[0] : room.slice(0, -2))] ?? 0];
  const rateRow   = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(hotelId, roomType);
  const resolvedRate = ratePerNight ? parseFloat(ratePerNight) : (rateRow ? rateRow.rate_per_night : null);

  const roomData     = lastOverview[room] || {};
  const elecAtCheckin  = roomData.elecConsumption ?? null;
  const waterAtCheckin = roomData.waterConsumption ?? null;

  const ci = new Date(checkIn); const co = new Date(checkOut);
  const nights      = Math.max(1, Math.round((co - ci) / 86400000));
  const totalAmount = resolvedRate ? nights * resolvedRate : null;

  db.prepare(`INSERT INTO reservations
    (id,hotel_id,room,guest_name,check_in,check_out,password,password_hash,token,created_by,payment_method,thirdparty_channel,rate_per_night,elec_at_checkin,water_at_checkin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, hotelId, room, guestName, checkIn, checkOut, plainPassword, hashedPassword, token, req.user.username,
      paymentMethod || 'pending', bookingChannel, resolvedRate, elecAtCheckin, waterAtCheckin);

  if (resolvedRate) {
    try {
      db.prepare(`INSERT INTO income_log
        (id,hotel_id,reservation_id,room,guest_name,check_in,check_out,nights,room_type,rate_per_night,total_amount,payment_method,thirdparty_channel,elec_at_checkin,water_at_checkin,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), hotelId, id, room, guestName, checkIn, checkOut,
          nights, roomType, resolvedRate, totalAmount, paymentMethod || 'pending', bookingChannel,
          elecAtCheckin, waterAtCheckin, req.user.username);
    } catch (e) { console.error('Income log write at reservation failed:', e.message); }
  }

  addLog(hotelId, 'pms', `Reservation created Rm${room} (${nights}n × ${resolvedRate} SAR = ${totalAmount} SAR)`, { room, user: req.user.username });
  const guestBase = process.env.GUEST_URL_BASE || `${req.protocol}://${req.get('host')}`;
  const guestUrl = `${guestBase}/guest?token=${encodeURIComponent(token)}`;
  res.json({
    reservation: { id, room, guestName, checkIn, checkOut, active: true, token, paymentMethod: paymentMethod || 'pending', ratePerNight: resolvedRate, nights, totalAmount },
    password: plainPassword, guestUrl
  });

  // Update server-side overview cache with the new reservation immediately so
  // pirMotionStatus / appliance activity telemetry can correctly trigger OCCUPIED
  // before the 60-second background overview refresh runs.
  const loNew = getLastOverviewRooms(hotelId);
  if (loNew[String(room)]) {
    loNew[String(room)].reservation = { id, guestName, checkIn, checkOut, paymentMethod: paymentMethod || 'pending' };
    // Broadcast so all connected clients see the reservation badge without polling delay.
    const devIdNew = getDeviceRoomMap(hotelId)[String(room)];
    if (devIdNew) sseBroadcast(hotelId, 'telemetry', { room: String(room), deviceId: devIdNew, data: { reservation: { id, guestName, checkIn, checkOut, paymentMethod: paymentMethod || 'pending' } } });
  }
  // Room stays VACANT until guest physically arrives (door open → OCCUPIED)
});

app.get('/api/pms/export', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const rows    = db.prepare('SELECT * FROM reservations WHERE hotel_id=? ORDER BY created_at DESC').all(hotelId);
  const header  = 'ID,Room,Guest Name,Check In,Check Out,Active,Created By,Created At';
  const csv     = rows.map(r => [
    r.id, r.room, `"${(r.guest_name || '').replace(/"/g, '""')}"`,
    r.check_in, r.check_out, r.active ? 'yes' : 'no', r.created_by || '', r.created_at || ''
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="hotel-pms-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header, ...csv].join('\n'));
});

app.delete('/api/pms/history', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const result  = db.prepare('DELETE FROM reservations WHERE hotel_id=? AND active=0').run(hotelId);
  res.json({ success: true, deleted: result.changes });
});

app.delete('/api/pms/reservations/:id', authenticate, (req, res) => {
  const hotelId  = req.user.hotelId;
  const existing = db.prepare('SELECT * FROM reservations WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE reservations SET active=0 WHERE id=? AND hotel_id=?').run(req.params.id, hotelId);
  addLog(hotelId, 'pms', 'Reservation cancelled', { room: existing.room, user: req.user.username });
  if (existing.room) {
    sseBroadcast(hotelId, 'lockout', { room: existing.room });
    // Also clear the reservation from the server cache so door-open / motion
    // logic no longer treats this room as reserved.
    const loCx = getLastOverviewRooms(hotelId);
    if (loCx[existing.room]) {
      loCx[existing.room].reservation = null;
      const devIdCx = getDeviceRoomMap(hotelId)[existing.room];
      if (devIdCx) sseBroadcast(hotelId, 'telemetry', { room: existing.room, deviceId: devIdCx, data: { reservation: null } });
    }
  }
  res.json({ success: true });

  // If the room is still NOT_OCCUPIED (guest never arrived), immediately restore it to VACANT
  if (existing.room) setImmediate(async () => {
    const devId = getDeviceRoomMap(hotelId)[existing.room];
    if (!devId) return;
    const roomData = getLastOverviewRooms(hotelId)[existing.room];
    if (roomData?.roomStatus === 4) {
      delete getRoomStateSnapshots(hotelId)[existing.room];
      try {
        await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 0 }, req.user.username);
      } catch (e) { console.error('Failed to vacate room after reservation cancel:', e.message); }
    }
  });
});

app.post('/api/pms/reservations/:id/extend', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId        = req.user.hotelId;
  const { newCheckOut, paymentMethod, thirdPartyChannel } = req.body;
  if (!newCheckOut) return res.status(400).json({ error: 'newCheckOut required' });

  const ar = db.prepare('SELECT * FROM reservations WHERE id=? AND hotel_id=? AND active=1').get(req.params.id, hotelId);
  if (!ar) return res.status(404).json({ error: 'Active reservation not found' });
  if (newCheckOut <= ar.check_out) return res.status(400).json({ error: 'New check-out must be after current check-out' });

  const hotelRoom = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, ar.room);
  const roomType  = hotelRoom?.room_type || ROOM_TYPES[FLOOR_TYPE[parseInt(ar.room.length <= 3 ? ar.room[0] : ar.room.slice(0, -2))] ?? 0];
  const rateRow   = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(hotelId, roomType);
  const ratePerNight  = ar.rate_per_night || (rateRow ? rateRow.rate_per_night : 0);
  const nights        = Math.max(1, Math.round((new Date(newCheckOut) - new Date(ar.check_in)) / 86400000));
  const totalAmount   = nights * ratePerNight;
  const pm            = paymentMethod || ar.payment_method;
  const extChannel    = (pm === 'thirdparty' && thirdPartyChannel)
    ? String(thirdPartyChannel).trim().slice(0, 100) : (ar.thirdparty_channel || '');

  db.prepare('UPDATE reservations SET check_out=?, payment_method=?, thirdparty_channel=? WHERE id=?').run(newCheckOut, pm, extChannel, ar.id);
  db.prepare('UPDATE income_log SET check_out=?, nights=?, total_amount=?, payment_method=?, thirdparty_channel=? WHERE reservation_id=?')
    .run(newCheckOut, nights, totalAmount, pm, extChannel, ar.id);

  addLog(hotelId, 'pms', `Stay extended Rm${ar.room}: ${ar.check_out} → ${newCheckOut} (${nights}n, ${totalAmount} SAR)`, { room: ar.room, user: req.user.username });
  res.json({ success: true, newCheckOut, nights, totalAmount, ratePerNight, paymentMethod: pm });
});

app.post('/api/rooms/:room/lockdown', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { room } = req.params;
  db.prepare('UPDATE reservations SET active=0 WHERE hotel_id=? AND room=? AND active=1').run(hotelId, room);
  sseBroadcast(hotelId, 'lockout', { room });
  res.json({ success: true });
});

app.post('/api/rooms/:room/checkout', authenticate, requireRole('owner', 'admin', 'frontdesk'), async (req, res) => {
  const hotelId      = req.user.hotelId;
  const { room }     = req.params;
  const { paymentMethod, thirdPartyChannel } = req.body || {};
  const VALID_PM     = ['cash', 'visa', 'online', 'thirdparty'];
  const resolvedPM   = VALID_PM.includes(paymentMethod) ? paymentMethod : null;
  const resolvedChannel = (resolvedPM === 'thirdparty' && thirdPartyChannel)
    ? String(thirdPartyChannel).trim().slice(0, 100) : '';

  const ar = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1').get(hotelId, room);
  db.prepare('UPDATE reservations SET active=0 WHERE hotel_id=? AND room=? AND active=1').run(hotelId, room);

  if (ar) {
    try {
      const lastOverview = getLastOverviewRooms(hotelId);
      const roomData     = lastOverview[room] || {};
      const elecOut  = roomData.elecConsumption ?? null;
      const waterOut = roomData.waterConsumption ?? null;

      // Soft-reset meters: snapshot current absolute reading as new baseline
      // so the next guest's consumption starts from 0 (physical device unchanged).
      db.prepare(
        'UPDATE hotel_rooms SET elec_meter_baseline=?, water_meter_baseline=? WHERE hotel_id=? AND room_number=?'
      ).run(elecOut ?? 0, waterOut ?? 0, hotelId, room);

      // Use the staff-selected payment method; fall back to what was on the reservation.
      const finalPM = resolvedPM || (ar.payment_method !== 'pending' ? ar.payment_method : 'pending');

      // Also persist chosen payment method on the reservation record.
      if (resolvedPM) {
        db.prepare('UPDATE reservations SET payment_method=?, thirdparty_channel=? WHERE id=?')
          .run(resolvedPM, resolvedChannel, ar.id);
      }

      const existing = db.prepare('SELECT id FROM income_log WHERE reservation_id=?').get(ar.id);
      if (existing) {
        db.prepare("UPDATE income_log SET elec_at_checkout=?, water_at_checkout=?, payment_method=?, thirdparty_channel=?, checked_out_at=datetime('now') WHERE reservation_id=?")
          .run(elecOut, waterOut, finalPM, resolvedChannel, ar.id);
      } else {
        const hotelRoom = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, room);
        const roomType  = hotelRoom?.room_type || ROOM_TYPES[FLOOR_TYPE[parseInt(room.length <= 3 ? room[0] : room.slice(0, -2))] ?? 0];
        const rateRow   = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(hotelId, roomType);
        const ratePerNight = ar.rate_per_night || (rateRow ? rateRow.rate_per_night : 0);
        const ci = new Date(ar.check_in); const co = new Date(ar.check_out);
        const nights = Math.max(1, Math.round((co - ci) / 86400000));
        db.prepare(`INSERT INTO income_log
          (id,hotel_id,reservation_id,room,guest_name,check_in,check_out,nights,room_type,rate_per_night,total_amount,payment_method,thirdparty_channel,elec_at_checkin,water_at_checkin,elec_at_checkout,water_at_checkout,checked_out_at,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)`)
          .run(crypto.randomUUID(), hotelId, ar.id, room, ar.guest_name, ar.check_in, ar.check_out,
            nights, roomType, ratePerNight, nights * ratePerNight, finalPM, resolvedChannel,
            ar.elec_at_checkin ?? null, ar.water_at_checkin ?? null, elecOut, waterOut, req.user.username);
      }
    } catch (e) { console.error('Income log update at checkout failed:', e.message); }
  }

  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId = deviceRoomMap[room];
  if (devId) {
    try { await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 2 }, req.user.username); } catch {}
  }
  // Generate a one-time review token for the guest so they can rate their stay
  // without needing a login. The token is stored on the reservation.
  let reviewUrl = null;
  if (ar) {
    const reviewToken = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE reservations SET review_token=? WHERE id=?').run(reviewToken, ar.id);
    const base = process.env.GUEST_URL_BASE || `${req.protocol}://${req.get('host')}`;
    reviewUrl = `${base}/review?t=${reviewToken}`;
  }

  sseBroadcast(hotelId, 'lockout', { room });
  addLog(hotelId, 'pms', `Room ${room} checked out → SERVICE`, { room, user: req.user.username });

  // Clear reservation from the server-side overview cache immediately.
  // Without this, stale reservation data persists in memory and the door-open
  // handler would see reservation !== null on the SERVICE room and wrongly
  // flip it back to OCCUPIED when housekeeping enters.
  const lo = getLastOverviewRooms(hotelId);
  if (lo[room]) {
    lo[room].reservation = null;
    sseBroadcast(hotelId, 'telemetry', { room, deviceId: devId, data: { reservation: null } });
  }

  // Reset all room appliances to default state (non-blocking)
  setImmediate(async () => {
    const CHECKOUT_RESET = {
      pdMode: false, line1: false, line2: false, line3: false,
      dimmer1: 0, dimmer2: 0, acMode: 0, fanSpeed: 0, acTemperatureSet: 26,
      curtainsPosition: 0, blindsPosition: 0,
      dndService: false, murService: false, sosService: false
    };
    const lt = getLastKnownTelemetry(hotelId);
    const lo = getLastOverviewRooms(hotelId);
    lt[room] = { ...(lt[room] || {}), ...CHECKOUT_RESET };
    if (lo[room]) Object.assign(lo[room], CHECKOUT_RESET);
    if (devId) {
      sseBatchTelemetry(hotelId, room, devId, CHECKOUT_RESET);
      const adapter = getHotelAdapter(hotelId);
      try {
        await adapter.sendTelemetry(devId, CHECKOUT_RESET);
        await adapter.sendAttributes(devId, CHECKOUT_RESET);
      } catch (e) { console.error(`Reset TB write at checkout room ${room}:`, e.message); }
    }
    // Fire checkOut event scenes after reset
    checkEventScenes(hotelId, room, { checkOut: 1 });
  });

  res.json({ success: true, reviewUrl });
});

app.get('/api/pms/today-checkouts', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const today   = new Date().toISOString().split('T')[0];
  res.json(db.prepare('SELECT room, guest_name, check_out FROM reservations WHERE hotel_id=? AND check_out=? AND active=1 ORDER BY room').all(hotelId, today));
});

app.get('/api/pms/reservations/:id/link', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;
  const r       = db.prepare('SELECT * FROM reservations WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const guestBase2 = process.env.GUEST_URL_BASE || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${guestBase2}/guest?token=${encodeURIComponent(r.token)}`, password: r.password });
});

// ═══ PASSWORD RESET (public, no auth) ═══

// Platform admin forgot password — sends reset link to SUPERADMIN_EMAIL env var
app.post('/api/public/forgot-password/platform', async (req, res) => {
  // Always respond 200 to prevent username enumeration
  res.json({ ok: true });

  try {
    const adminEmail = process.env.SUPERADMIN_EMAIL || 'm.shafiee.osama@outlook.com';
    const token      = crypto.randomBytes(32).toString('hex');
    const expiresAt  = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

    // Invalidate any previous platform tokens
    db.prepare("DELETE FROM password_reset_tokens WHERE type='platform'").run();
    db.prepare(
      "INSERT INTO password_reset_tokens (token, type, identifier, expires_at) VALUES (?, 'platform', 'superadmin', ?)"
    ).run(token, expiresAt);

    const mailer = getMailer();
    if (!mailer) {
      console.warn('[reset] SMTP not configured — reset token generated but email not sent:', token);
      return;
    }

    const appBase = process.env.GUEST_URL_BASE || 'http://localhost:5173';
    const resetUrl = `${appBase}/platform/reset-password?token=${token}`;

    await mailer.sendMail({
      from:    `"iHotel Platform" <${process.env.SMTP_USER}>`,
      to:      adminEmail,
      subject: 'iHotel Platform — Password Reset',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e293b">Password Reset Request</h2>
          <p>A password reset was requested for the iHotel Platform super admin account.</p>
          <p>Click the button below to set a new password. This link expires in 30 minutes.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Reset Password
          </a>
          <p style="color:#94a3b8;font-size:12px">If you did not request this, ignore this email. The link will expire automatically.</p>
          <p style="color:#cbd5e1;font-size:11px">iHotel Smart Hotel Platform</p>
        </div>
      `,
    });

    console.log('[reset] Platform reset email sent to', adminEmail);
  } catch (e) {
    console.error('[reset] Failed to send platform reset email:', e.message);
  }
});

// Platform admin reset password — validates token and sets new password
app.post('/api/public/reset-password/platform', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Token and new password (min 8 chars) required' });
  }

  const row = db.prepare(
    "SELECT * FROM password_reset_tokens WHERE token=? AND type='platform' AND used=0"
  ).get(token);

  if (!row) return res.status(400).json({ error: 'Invalid or expired reset link' });
  if (new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE platform_admins SET password_hash=? WHERE username=?').run(hash, row.identifier);
  db.prepare('UPDATE password_reset_tokens SET used=1 WHERE id=?').run(row.id);

  res.json({ ok: true });
});

// ═══ PUBLIC API (no auth) ═══
// Returns hotel display name for the guest login page — exposes only the name, nothing sensitive
app.get('/api/public/hotel', (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const hotel = db.prepare('SELECT name, logo_url FROM hotels WHERE slug = ? AND active = 1').get(slug.toLowerCase());
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
  res.json({ name: hotel.name, logoUrl: hotel.logo_url || null });
});

// ═══ SELF-BOOKING PUBLIC APIs ═══

// List all hotels with online booking enabled (for /book directory page)
app.get('/api/public/hotels', (req, res) => {
  const hotels = db.prepare(`
    SELECT h.name, h.slug, h.logo_url,
           p.description, p.description_ar, p.location, p.location_ar,
           p.hero_image_url, p.amenities, p.currency, p.check_in_time, p.check_out_time
    FROM hotels h
    JOIN hotel_profiles p ON p.hotel_id = h.id
    WHERE h.active = 1 AND p.booking_enabled = 1
    ORDER BY h.name
  `).all();

  const result = hotels.map(h => {
    // Get cheapest rate for this hotel
    const hotel = db.prepare('SELECT id FROM hotels WHERE slug=?').get(h.slug);
    let minRate = null;
    if (hotel) {
      const rate = db.prepare('SELECT MIN(rate_per_night) as min_rate FROM night_rates WHERE hotel_id=?').get(hotel.id);
      minRate = rate?.min_rate || null;
    }
    // Count room types
    let roomTypeCount = 0;
    if (hotel) {
      const rtCount = db.prepare('SELECT COUNT(DISTINCT room_type) as cnt FROM hotel_rooms WHERE hotel_id=?').get(hotel.id);
      roomTypeCount = rtCount?.cnt || 0;
    }
    return {
      name: h.name,
      slug: h.slug,
      logoUrl: h.logo_url || null,
      description: h.description || null,
      descriptionAr: h.description_ar || null,
      location: h.location || null,
      locationAr: h.location_ar || null,
      heroImageUrl: h.hero_image_url || null,
      amenities: h.amenities ? JSON.parse(h.amenities) : [],
      currency: h.currency || 'SAR',
      checkInTime: h.check_in_time || '15:00',
      checkOutTime: h.check_out_time || '12:00',
      startingFrom: minRate,
      roomTypeCount
    };
  });

  res.json({ hotels: result });
});

// Public hotel profile for booking page — /book/:slug
app.get('/api/public/book/:slug', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const hotel = db.prepare('SELECT id, name, slug, logo_url FROM hotels WHERE slug=? AND active=1').get(slug);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  const profile = db.prepare('SELECT * FROM hotel_profiles WHERE hotel_id=?').get(hotel.id);
  if (!profile || !profile.booking_enabled) {
    return res.status(404).json({ error: 'Online booking is not available for this hotel' });
  }

  // Get room types with rates and availability
  const rates = db.prepare('SELECT room_type, rate_per_night FROM night_rates WHERE hotel_id=?').all(hotel.id);
  const rateMap = {};
  rates.forEach(r => { rateMap[r.room_type] = r.rate_per_night; });

  const roomTypeInfo = db.prepare('SELECT * FROM room_type_info WHERE hotel_id=?').all(hotel.id);
  const images = db.prepare('SELECT room_type, image_url, caption, sort_order FROM room_type_images WHERE hotel_id=? ORDER BY sort_order').all(hotel.id);

  // Group images by room type
  const imagesByType = {};
  images.forEach(img => {
    if (!imagesByType[img.room_type]) imagesByType[img.room_type] = [];
    imagesByType[img.room_type].push({ url: img.image_url, caption: img.caption });
  });

  // Get distinct room types from hotel_rooms
  const roomTypes = db.prepare('SELECT DISTINCT room_type FROM hotel_rooms WHERE hotel_id=?').all(hotel.id).map(r => r.room_type);

  // Build room type list with info
  const types = roomTypes.map(type => {
    const info = roomTypeInfo.find(i => i.room_type === type) || {};
    return {
      type,
      rate: rateMap[type] || null,
      description: info.description || null,
      descriptionAr: info.description_ar || null,
      maxGuests: info.max_guests || 2,
      bedType: info.bed_type || 'King',
      areaSqm: info.area_sqm || null,
      amenities: info.amenities ? JSON.parse(info.amenities) : [],
      images: imagesByType[type] || []
    };
  });

  res.json({
    hotel: {
      name: hotel.name,
      slug: hotel.slug,
      logoUrl: hotel.logo_url || null,
      description: profile.description || null,
      descriptionAr: profile.description_ar || null,
      location: profile.location || null,
      locationAr: profile.location_ar || null,
      phone: profile.phone || null,
      email: profile.email || null,
      website: profile.website || null,
      amenities: profile.amenities ? JSON.parse(profile.amenities) : [],
      checkInTime: profile.check_in_time || '15:00',
      checkOutTime: profile.check_out_time || '12:00',
      currency: profile.currency || 'SAR',
      bookingTerms: profile.booking_terms || null,
      bookingTermsAr: profile.booking_terms_ar || null,
      heroImageUrl: profile.hero_image_url || null
    },
    roomTypes: types
  });
});

// Check room availability for a date range
app.get('/api/public/book/:slug/availability', (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const { checkIn, checkOut, roomType } = req.query;
  if (!checkIn || !checkOut) return res.status(400).json({ error: 'checkIn and checkOut required' });

  const hotel = db.prepare('SELECT id FROM hotels WHERE slug=? AND active=1').get(slug);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  const profile = db.prepare('SELECT booking_enabled FROM hotel_profiles WHERE hotel_id=?').get(hotel.id);
  if (!profile || !profile.booking_enabled) return res.status(404).json({ error: 'Booking not available' });

  // Get all rooms of the requested type (or all types if not specified)
  let roomQuery = 'SELECT room_number, room_type FROM hotel_rooms WHERE hotel_id=?';
  const params = [hotel.id];
  if (roomType) { roomQuery += ' AND room_type=?'; params.push(roomType); }
  const allRooms = db.prepare(roomQuery).all(...params);

  // Get rooms with active reservations overlapping the date range
  const occupied = db.prepare(
    `SELECT DISTINCT room FROM reservations WHERE hotel_id=? AND active=1
     AND check_in < ? AND check_out > ?`
  ).all(hotel.id, checkOut, checkIn).map(r => String(r.room));
  const occupiedSet = new Set(occupied);

  // Also exclude rooms physically unavailable (OCCUPIED=1, SERVICE=2, MAINTENANCE=3)
  const liveOverview = getLastOverviewRooms(hotel.id);
  const physOccupied = new Set(
    Object.entries(liveOverview)
      .filter(([, d]) => [1, 2, 3].includes(d.roomStatus))
      .map(([roomNum]) => String(roomNum))
  );

  // Count available rooms per type
  const availability = {};
  allRooms.forEach(r => {
    if (!availability[r.room_type]) availability[r.room_type] = { total: 0, available: 0 };
    availability[r.room_type].total++;
    if (!occupiedSet.has(String(r.room_number)) && !physOccupied.has(String(r.room_number)))
      availability[r.room_type].available++;
  });

  res.json({ checkIn, checkOut, availability });
});

// Self-booking: guest creates their own reservation (public endpoint with rate limiting)
const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many booking attempts' } });

app.post('/api/public/book/:slug', bookingLimiter, (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const { roomType, guestName, guestEmail, guestPhone, checkIn, checkOut } = req.body;
  if (!roomType || !guestName || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'roomType, guestName, checkIn, checkOut required' });
  }

  const hotel = db.prepare('SELECT id, name FROM hotels WHERE slug=? AND active=1').get(slug);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  const profile = db.prepare('SELECT booking_enabled FROM hotel_profiles WHERE hotel_id=?').get(hotel.id);
  if (!profile || !profile.booking_enabled) return res.status(404).json({ error: 'Online booking not available' });

  // Validate dates
  const ciDate = new Date(checkIn);
  const coDate = new Date(checkOut);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (ciDate < today) return res.status(400).json({ error: 'Check-in date cannot be in the past' });
  if (coDate <= ciDate) return res.status(400).json({ error: 'Check-out must be after check-in' });

  // Find an available room of the requested type — lowest floor first
  const allRooms = db.prepare('SELECT room_number, floor FROM hotel_rooms WHERE hotel_id=? AND room_type=? ORDER BY floor ASC, CAST(room_number AS INTEGER) ASC')
    .all(hotel.id, roomType);
  if (!allRooms.length) return res.status(400).json({ error: `No rooms of type ${roomType} exist` });

  // Cast to String to guard against rooms stored as INTEGER vs TEXT
  const occupied = db.prepare(
    `SELECT DISTINCT room FROM reservations WHERE hotel_id=? AND active=1
     AND check_in < ? AND check_out > ?`
  ).all(hotel.id, checkOut, checkIn).map(r => String(r.room));
  const occupiedSet = new Set(occupied);

  // Skip rooms physically unavailable (OCCUPIED=1, SERVICE=2, MAINTENANCE=3)
  const liveData = getLastOverviewRooms(hotel.id);
  const physOccupiedBook = new Set(
    Object.entries(liveData)
      .filter(([, d]) => [1, 2, 3].includes(d.roomStatus))
      .map(([roomNum]) => String(roomNum))
  );

  const availableRoom = allRooms.find(r =>
    !occupiedSet.has(String(r.room_number)) && !physOccupiedBook.has(String(r.room_number))
  );
  if (!availableRoom) return res.status(409).json({ error: 'No rooms available for the selected dates and type' });

  const room = availableRoom.room_number;

  // Final safety check — confirm this room is still free (guards against any edge case)
  const doubleCheck = db.prepare(
    `SELECT id FROM reservations WHERE hotel_id=? AND room=? AND active=1
     AND check_in < ? AND check_out > ?`
  ).get(hotel.id, String(room), checkOut, checkIn);
  if (doubleCheck) return res.status(409).json({ error: 'No rooms available for the selected dates and type' });

  // Get rate
  const rateRow = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(hotel.id, roomType);
  const ratePerNight = rateRow ? rateRow.rate_per_night : null;
  const nights = Math.max(1, Math.round((coDate - ciDate) / 86400000));
  const totalAmount = ratePerNight ? nights * ratePerNight : null;

  // Create the reservation
  const id = crypto.randomUUID();
  const plainPassword = crypto.randomInt(100000, 999999).toString();
  const hashedPassword = bcrypt.hashSync(plainPassword, 10);
  const token = crypto.randomBytes(16).toString('hex');

  const lastOverview = getLastOverviewRooms(hotel.id);
  const roomData = lastOverview[room] || {};

  db.prepare(`INSERT INTO reservations
    (id,hotel_id,room,guest_name,check_in,check_out,password,password_hash,token,created_by,payment_method,rate_per_night,elec_at_checkin,water_at_checkin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, hotel.id, room, guestName, checkIn, checkOut, plainPassword, hashedPassword, token, 'self-booking',
      'online', ratePerNight, roomData.elecConsumption ?? null, roomData.waterConsumption ?? null);

  // Income log
  if (ratePerNight) {
    try {
      db.prepare(`INSERT INTO income_log
        (id,hotel_id,reservation_id,room,guest_name,check_in,check_out,nights,room_type,rate_per_night,total_amount,payment_method,elec_at_checkin,water_at_checkin,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), hotel.id, id, room, guestName, checkIn, checkOut,
          nights, roomType, ratePerNight, totalAmount, 'online',
          roomData.elecConsumption ?? null, roomData.waterConsumption ?? null, 'self-booking');
    } catch (e) { console.error('Income log from self-booking failed:', e.message); }
  }

  addLog(hotel.id, 'pms', `Self-booking: Rm${room} ${guestName} (${nights}n × ${ratePerNight} SAR)`, { room, user: 'self-booking' });

  const guestBase = process.env.GUEST_URL_BASE || `${req.protocol}://${req.get('host')}`;
  const guestUrl = `${guestBase}/guest?token=${encodeURIComponent(token)}`;

  // Room stays VACANT until guest physically arrives (door open → OCCUPIED)

  res.json({
    success: true,
    booking: {
      id, room, floor: availableRoom.floor, guestName, roomType, checkIn, checkOut,
      nights, ratePerNight, totalAmount,
      currency: profile.currency || 'SAR'
    },
    credentials: {
      password: plainPassword,
      guestUrl,
      token
    },
    hotel: { name: hotel.name, slug }
  });
});

// ═══ GUEST REVIEWS ════════════════════════════════════════════════════════════

const reviewLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: 'Too many review attempts' } });

// GET /api/public/review/:token — fetch booking details for the review form
app.get('/api/public/review/:token', (req, res) => {
  const { token } = req.params;
  const row = db.prepare(`
    SELECT r.id, r.guest_name, r.room, r.check_in, r.check_out, r.hotel_id,
           h.name AS hotel_name, h.logo_url,
           (SELECT id FROM guest_reviews WHERE reservation_id = r.id) AS already_reviewed
    FROM reservations r
    JOIN hotels h ON h.id = r.hotel_id
    WHERE r.review_token = ? AND r.active = 0
  `).get(token);
  if (!row) return res.status(404).json({ error: 'Review link not found or not yet checked out' });
  const ci = new Date(row.check_in); const co = new Date(row.check_out);
  const nights = Math.max(1, Math.round((co - ci) / 86400000));
  res.json({
    guestName:  row.guest_name,
    room:       row.room,
    checkIn:    row.check_in,
    checkOut:   row.check_out,
    nights,
    hotelName:  row.hotel_name,
    logoUrl:    row.logo_url || null,
    alreadyReviewed: !!row.already_reviewed,
  });
});

// POST /api/public/review/:token — submit a review (one per reservation)
app.post('/api/public/review/:token', reviewLimiter, (req, res) => {
  const { token } = req.params;
  const { stars, reviewText } = req.body;
  if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'Stars must be 1–5' });
  const reservation = db.prepare(`
    SELECT r.*, h.name AS hotel_name
    FROM reservations r
    JOIN hotels h ON h.id = r.hotel_id
    WHERE r.review_token = ? AND r.active = 0
  `).get(token);
  if (!reservation) return res.status(404).json({ error: 'Review link not found or not yet checked out' });
  // One review per reservation (UNIQUE on reservation_id)
  const existing = db.prepare('SELECT id FROM guest_reviews WHERE reservation_id=?').get(reservation.id);
  if (existing) return res.status(409).json({ error: 'You have already submitted a review for this stay' });
  const ci = new Date(reservation.check_in); const co = new Date(reservation.check_out);
  const nights = Math.max(1, Math.round((co - ci) / 86400000));
  db.prepare(`
    INSERT INTO guest_reviews (id, hotel_id, reservation_id, room, guest_name, check_in, check_out, nights, stars, review_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), reservation.hotel_id, reservation.id, reservation.room,
         reservation.guest_name, reservation.check_in, reservation.check_out,
         nights, Number(stars), reviewText?.trim() || null);
  addLog(reservation.hotel_id, 'pms', `Guest review: Room ${reservation.room} — ${stars}★`, { room: reservation.room, stars });
  res.json({ success: true });
});

// GET /api/reviews — list reviews for the hotel (owner/admin)
app.get('/api/reviews', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const reviews = db.prepare(`
    SELECT * FROM guest_reviews WHERE hotel_id=? ORDER BY created_at DESC
  `).all(hotelId);
  const agg = db.prepare(`
    SELECT COUNT(*) as total, AVG(stars) as avg_stars FROM guest_reviews WHERE hotel_id=?
  `).get(hotelId);
  res.json({ reviews, total: agg.total, avgStars: agg.avg_stars ? Math.round(agg.avg_stars * 10) / 10 : null });
});

// ═══ HOTEL PROFILE MANAGEMENT (Owner) ═══

// Get hotel profile
app.get('/api/hotel/profile', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const hotel = db.prepare('SELECT slug FROM hotels WHERE id=?').get(hotelId);
  const profile = db.prepare('SELECT * FROM hotel_profiles WHERE hotel_id=?').get(hotelId);
  const roomTypeInfo = db.prepare('SELECT * FROM room_type_info WHERE hotel_id=?').all(hotelId);
  const images = db.prepare('SELECT * FROM room_type_images WHERE hotel_id=? ORDER BY sort_order').all(hotelId);
  res.json({ profile: profile || {}, roomTypeInfo, images, slug: hotel?.slug || '' });
});

// Update hotel profile
app.put('/api/hotel/profile', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const {
    description, descriptionAr, location, locationAr, phone, email, website,
    amenities, checkInTime, checkOutTime, currency, bookingEnabled,
    bookingTerms, bookingTermsAr, heroImageUrl, publicUrl
  } = req.body;

  // Normalize publicUrl: strip trailing slash, ensure starts with http if non-empty
  const cleanPublicUrl = publicUrl ? String(publicUrl).replace(/\/+$/, '') : null;

  db.prepare(`INSERT INTO hotel_profiles (hotel_id, description, description_ar, location, location_ar, phone, email, website, amenities, check_in_time, check_out_time, currency, booking_enabled, booking_terms, booking_terms_ar, hero_image_url, public_url, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(hotel_id) DO UPDATE SET
      description=?, description_ar=?, location=?, location_ar=?, phone=?, email=?, website=?,
      amenities=?, check_in_time=?, check_out_time=?, currency=?, booking_enabled=?,
      booking_terms=?, booking_terms_ar=?, hero_image_url=?, public_url=?, updated_at=datetime('now')`)
    .run(
      hotelId, description || null, descriptionAr || null, location || null, locationAr || null,
      phone || null, email || null, website || null,
      JSON.stringify(amenities || []), checkInTime || '15:00', checkOutTime || '12:00',
      currency || 'SAR', bookingEnabled ? 1 : 0, bookingTerms || null, bookingTermsAr || null,
      heroImageUrl || null, cleanPublicUrl,
      // ON CONFLICT values:
      description || null, descriptionAr || null, location || null, locationAr || null,
      phone || null, email || null, website || null,
      JSON.stringify(amenities || []), checkInTime || '15:00', checkOutTime || '12:00',
      currency || 'SAR', bookingEnabled ? 1 : 0, bookingTerms || null, bookingTermsAr || null,
      heroImageUrl || null, cleanPublicUrl
    );
  res.json({ success: true });
});

// Update room type info (description, amenities, etc.)
app.put('/api/hotel/room-type-info/:roomType', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const roomType = req.params.roomType;
  const { description, descriptionAr, maxGuests, bedType, areaSqm, amenities } = req.body;

  db.prepare(`INSERT INTO room_type_info (hotel_id, room_type, description, description_ar, max_guests, bed_type, area_sqm, amenities)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(hotel_id, room_type) DO UPDATE SET
      description=?, description_ar=?, max_guests=?, bed_type=?, area_sqm=?, amenities=?`)
    .run(
      hotelId, roomType, description || null, descriptionAr || null,
      maxGuests || 2, bedType || 'King', areaSqm || null, JSON.stringify(amenities || []),
      // ON CONFLICT:
      description || null, descriptionAr || null, maxGuests || 2, bedType || 'King',
      areaSqm || null, JSON.stringify(amenities || [])
    );
  res.json({ success: true });
});

// Upload room type image
const multer = require('multer');
const fs = require('fs');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, _file, cb) => {
    const ext = _file.originalname.split('.').pop();
    cb(null, `hotel-${req.user.hotelId}-${req.params.roomType || 'hero'}-${Date.now()}.${ext}`);
  }
});
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  }
});

app.post('/api/hotel/room-type-images/:roomType', authenticate, requireRole('owner'), uploadImage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  const hotelId = req.user.hotelId;
  const roomType = req.params.roomType;
  const imageUrl = `/uploads/${req.file.filename}`;
  const caption = req.body.caption || null;
  const sortOrder = parseInt(req.body.sortOrder) || 0;

  db.prepare('INSERT INTO room_type_images (hotel_id, room_type, image_url, caption, sort_order) VALUES (?,?,?,?,?)')
    .run(hotelId, roomType, imageUrl, caption, sortOrder);
  res.json({ success: true, imageUrl });
});

// Delete room type image
app.delete('/api/hotel/room-type-images/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const img = db.prepare('SELECT image_url FROM room_type_images WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  // Remove file
  try { fs.unlinkSync(path.join(__dirname, img.image_url)); } catch {}
  db.prepare('DELETE FROM room_type_images WHERE id=? AND hotel_id=?').run(req.params.id, hotelId);
  res.json({ success: true });
});

// Upload hero image
app.post('/api/hotel/hero-image', authenticate, requireRole('owner'), uploadImage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  const imageUrl = `/uploads/${req.file.filename}`;
  db.prepare(`INSERT INTO hotel_profiles (hotel_id, hero_image_url, updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(hotel_id) DO UPDATE SET hero_image_url=?, updated_at=datetime('now')`)
    .run(req.user.hotelId, imageUrl, imageUrl);
  res.json({ success: true, imageUrl });
});

// Resolves an opaque reservation token → hotel display name (no room, no PII)
// Used by the guest login page to show the hotel name without exposing room/hotel in URL
app.get('/api/public/guest/resolve', (req, res) => {
  const { t } = req.query;
  if (!t) return res.status(400).json({ error: 'Token required' });
  const r = db.prepare('SELECT hotel_id FROM reservations WHERE token=? AND active=1').get(t);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const hotel = db.prepare('SELECT name, logo_url FROM hotels WHERE id=?').get(r.hotel_id);
  res.json({ hotelName: hotel?.name || '', logoUrl: hotel?.logo_url || null });
});

// ═══ GUEST API ═══
app.post('/api/guest/login', guestLimiter, (req, res) => {
  const { token, room, hotelSlug, lastName, password } = req.body;
  if ((!token && !room) || !password) {
    return res.status(400).json({ error: 'Name and password required' });
  }

  const providedPassword = String(password || '').trim();

  let r        = null;
  let hotelId  = null;

  if (token) {
    // Token-based login: token is globally unique
    r = db.prepare('SELECT * FROM reservations WHERE token=? AND active=1').get(token);
    if (r) hotelId = r.hotel_id;
  } else if (room && hotelSlug) {
    // Room-based login: resolve hotel from slug
    const hotel = db.prepare('SELECT id FROM hotels WHERE slug=? AND active=1').get(hotelSlug.toLowerCase());
    if (!hotel) return res.status(401).json({ error: 'Invalid hotel code' });
    hotelId = hotel.id;
    const today = new Date().toISOString().split('T')[0];
    r = db.prepare("SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=? AND check_out>=?").get(hotelId, room, today, today);
  } else if (room) {
    return res.status(400).json({ error: 'hotelSlug is required for room-based login' });
  }

  if (!r) return res.status(401).json({ error: 'Invalid or expired link' });

  const now = new Date().toISOString().split('T')[0];
  if (now < r.check_in || now > r.check_out) {
    return res.status(401).json({ error: 'Outside reservation dates' });
  }

  const inputName  = (lastName || '').trim().toLowerCase();
  const storedFull = r.guest_name.trim().toLowerCase();
  const storedParts = r.guest_name.trim().split(/\s+/).map(p => p.toLowerCase());
  const nameMatch  = (inputName === storedFull) || storedParts.includes(inputName);

  const passwordMatch = r.password_hash
    ? bcrypt.compareSync(providedPassword, r.password_hash)
    : String(r.password).trim() === providedPassword;  // legacy plaintext fallback

  if (!nameMatch || !passwordMatch) {
    addLog(hotelId, 'auth', 'Guest login failed', { source: `guest:${lastName}`, room: r.room });
    return res.status(401).json({ error: 'Invalid name or password. Use the name given at check-in.' });
  }

  const guestToken = generateAccessToken({ id: 0, username: `guest:${r.guest_name}`, role: 'guest', room: r.room, hotelId });
  addLog(hotelId, 'auth', 'Guest login', { source: `guest:${r.guest_name}`, room: r.room });
  res.json({ accessToken: guestToken, room: r.room, guestName: r.guest_name, reservationToken: r.token });
});

app.get('/api/guest/room', authenticate, (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  const hotelId = req.user.hotelId;
  const today   = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare("SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=? AND check_out>=?").get(hotelId, req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND guest_name=? AND active=1').get(hotelId, name);
  }
  if (!r) {
    return res.status(403).json({
      error: 'session_expired', lockout: true,
      title: 'Room Access Suspended',
      message: 'Dear Guest, your room access has been suspended. Please visit the reception desk to renew your stay or arrange checkout. We apologize for any inconvenience and are happy to assist you.'
    });
  }
  const lastOverview = getLastOverviewRooms(hotelId);
  const hotel = db.prepare('SELECT name, logo_url, device_config FROM hotels WHERE id=?').get(hotelId);
  const deviceConfig = hotel?.device_config ? JSON.parse(hotel.device_config) : null;
  res.json({ room: r.room, telemetry: lastOverview[r.room] || {}, hotelName: hotel?.name || '', logoUrl: hotel?.logo_url || null, deviceConfig });
});

app.get('/api/guest/room/data', authenticate, async (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  const hotelId = req.user.hotelId;
  const today   = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare("SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=? AND check_out>=?").get(hotelId, req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND guest_name=? AND active=1').get(hotelId, name);
  }
  if (!r) {
    return res.status(403).json({
      error: 'session_expired', lockout: true, title: 'Room Access Suspended',
      message: 'Dear Guest, your room access has been suspended. Please visit the reception desk.'
    });
  }
  const roomNum      = r.room;
  const lastOverview = getLastOverviewRooms(hotelId);

  if (lastOverview[roomNum]) return res.json(lastOverview[roomNum]);

  try {
    const adapter     = getHotelAdapter(hotelId);
    const deviceRoomMap = getDeviceRoomMap(hotelId);
    let devId = deviceRoomMap[roomNum];
    if (!devId) {
      const devices = await adapter.listDevices();
      const dev     = devices.find(d => d.roomNumber === roomNum || extractRoom(d.name) === roomNum);
      if (!dev) return res.status(404).json({ error: 'Room device not found on IoT platform' });
      devId = dev.id;
      deviceRoomMap[roomNum] = devId;
    }
    const rawT      = await adapter.getAllDeviceStates([devId], TELEMETRY_KEYS);
    const t         = parseTelemetry(rawT[devId] || {});
    const relays    = await adapter.getDeviceAttributes(devId, RELAY_KEYS);

    const hotelRoom = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, roomNum);
    const typeId    = hotelRoom ? ROOM_TYPES.indexOf(hotelRoom.room_type) : (FLOOR_TYPE[parseInt(roomNum.length <= 3 ? roomNum[0] : roomNum.slice(0, -2))] ?? 0);
    const ar        = db.prepare("SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=date('now') AND check_out>=date('now')").get(hotelId, roomNum);
    const roomData  = {
      room: roomNum, floor: parseInt(roomNum.length <= 3 ? roomNum[0] : roomNum.slice(0, -2)),
      type: ROOM_TYPES[typeId] || 'STANDARD', typeId, deviceId: devId, deviceName: `gateway-room-${roomNum}`,
      online: Object.keys(t).length > 0,
      temperature: t.temperature ?? null, humidity: t.humidity ?? null, co2: t.co2 ?? null,
      pirMotionStatus: t.pirMotionStatus ?? false, doorStatus: t.doorStatus ?? false,
      doorLockBattery: t.doorLockBattery ?? null, doorContactsBattery: t.doorContactsBattery ?? null,
      airQualityBattery: t.airQualityBattery ?? null,
      line1: t.line1 ?? false, line2: t.line2 ?? false, line3: t.line3 ?? false,
      dimmer1: t.dimmer1 ?? 0, dimmer2: t.dimmer2 ?? 0,
      acTemperatureSet: t.acTemperatureSet ?? 22, acMode: t.acMode ?? 0, fanSpeed: t.fanSpeed ?? 3,
      curtainsPosition: t.curtainsPosition ?? 0, blindsPosition: t.blindsPosition ?? 0,
      dndService: t.dndService ?? false, murService: t.murService ?? false, sosService: t.sosService ?? false,
      roomStatus: t.roomStatus ?? 0, lastCleanedTime: t.lastCleanedTime ?? null,
      pdMode: t.pdMode ?? false,
      relay1: relays.relay1 ?? false, relay2: relays.relay2 ?? false,
      relay3: relays.relay3 ?? false, relay4: relays.relay4 ?? false,
      relay5: relays.relay5 ?? false, relay6: relays.relay6 ?? false,
      relay7: relays.relay7 ?? false, relay8: relays.relay8 ?? false,
      doorUnlock: relays.doorUnlock ?? false,
      reservation: ar ? { id: ar.id, guestName: ar.guest_name, checkIn: ar.check_in, checkOut: ar.check_out, paymentMethod: ar.payment_method } : null
    };
    lastOverview[roomNum] = roomData;
    res.json(roomData);
  } catch (e) { res.status(502).json({ error: 'Failed to fetch room data: ' + e.message }); }
});

app.post('/api/guest/rpc', authenticate, async (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  const hotelId = req.user.hotelId;
  const today   = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare("SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=? AND check_out>=?").get(hotelId, req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND guest_name=? AND active=1').get(hotelId, name);
  }
  if (!r) {
    return res.status(403).json({
      error: 'session_expired', lockout: true,
      title: 'Room Access Suspended',
      message: 'Dear Guest, your room access has been suspended. Please visit the reception desk to renew your stay or arrange checkout. We apologize for any inconvenience and are happy to assist you.'
    });
  }
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const pdState       = getRoomPDState(hotelId);
  const lastOverview  = getLastOverviewRooms(hotelId);
  const devId         = deviceRoomMap[r.room];
  if (!devId) return res.status(404).json({ error: 'Device not found' });

  if (pdState[r.room]) {
    return res.status(403).json({ error: 'room_pd', message: 'Room power has been restricted by hotel management. Please contact reception.' });
  }

  const { method, params } = req.body;
  const allowed = ['setLines', 'setAC', 'setCurtainsBlinds', 'setService', 'resetServices', 'setDoorUnlock', 'setDoorLock'];
  if (!allowed.includes(method)) return res.status(403).json({ error: 'Not allowed' });

  const roomData = lastOverview[r.room];
  if (roomData && roomData.roomStatus === 4) {
    // Claim snapshot before sendControl clears it on status change
    const snapshots = getRoomStateSnapshots(hotelId);
    const snap = snapshots[r.room];
    if (snap) delete snapshots[r.room];
    try { await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, `guest:${r.guest_name}`); } catch {}
    if (snap) {
      // Returning guest: restore saved room state (lights, AC, curtains)
      try {
        const lineParams = {};
        for (const k of Object.keys(snap)) {
          if (/^line\d+$/.test(k) || /^dimmer\d+$/.test(k)) lineParams[k] = snap[k];
        }
        await sendControl(hotelId, devId, 'setLines', lineParams, 'auto');
        await sendControl(hotelId, devId, 'setAC',
          { acMode: snap.acMode, acTemperatureSet: snap.acTemperatureSet,
            fanSpeed: snap.fanSpeed }, 'auto');
        await sendControl(hotelId, devId, 'setCurtainsBlinds',
          { curtainsPosition: snap.curtainsPosition,
            blindsPosition: snap.blindsPosition }, 'auto');
      } catch {}
    } else {
      // First-time arrival: no saved state — fire the welcome scene
      checkEventScenes(hotelId, r.room, { roomStatus: 1 }, { roomStatus: 4 });
    }
  }
  // Respond immediately — optimistic update already applied in sendControl via SSE.
  // Hardware command runs in background; UI is already updated.
  res.json({ ok: true });
  sendControl(hotelId, devId, method, params || {}, req.user.username)
    .catch(e => console.error(`[guest rpc] ${method} failed:`, e.message));
});

// ═══ SLEEP TIMER ═══
// Shared helper — schedules a 2-hr AC warm-up; cancels any prior timer for the room.
function scheduleSleepTimer(hotelId, room, devId) {
  const timers = getSleepTimers(hotelId);
  if (timers[room]) clearTimeout(timers[room]);
  const fireAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  timers[room] = setTimeout(async () => {
    delete timers[room];
    try { await sendControl(hotelId, devId, 'setAC', { acTemperatureSet: 25 }, 'sleep-timer'); } catch {}
  }, 2 * 60 * 60 * 1000);
  return fireAt;
}

// Guest: POST /api/guest/sleep-timer
app.post('/api/guest/sleep-timer', authenticate, async (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  const hotelId = req.user.hotelId;
  const today   = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=? AND check_out>=?')
         .get(hotelId, req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND guest_name=? AND active=1').get(hotelId, name);
  }
  if (!r) return res.status(403).json({ error: 'session_expired' });
  const devId = getDeviceRoomMap(hotelId)[r.room];
  if (!devId) return res.status(404).json({ error: 'Device not found' });
  if (getRoomPDState(hotelId)[r.room]) return res.status(403).json({ error: 'room_pd' });
  const fireAt = scheduleSleepTimer(hotelId, r.room, devId);
  res.json({ success: true, fireAt });
});

// Staff: POST /api/rooms/:room/sleep-timer
app.post('/api/rooms/:room/sleep-timer', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const room    = req.params.room;
  const devId   = getDeviceRoomMap(hotelId)[room];
  if (!devId) return res.status(404).json({ error: 'Device not found' });
  const fireAt = scheduleSleepTimer(hotelId, room, devId);
  res.json({ success: true, fireAt });
});

// Guest: DELETE /api/guest/sleep-timer  — cancel pending sleep timer
app.delete('/api/guest/sleep-timer', authenticate, async (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  const hotelId = req.user.hotelId;
  const today   = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare('SELECT room FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in<=? AND check_out>=?')
         .get(hotelId, req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT room FROM reservations WHERE hotel_id=? AND guest_name=? AND active=1').get(hotelId, name);
  }
  if (r) {
    const timers = getSleepTimers(hotelId);
    if (timers[r.room]) { clearTimeout(timers[r.room]); delete timers[r.room]; }
  }
  res.json({ success: true });
});

// Staff: DELETE /api/rooms/:room/sleep-timer  — cancel pending sleep timer
app.delete('/api/rooms/:room/sleep-timer', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const timers  = getSleepTimers(hotelId);
  const room    = req.params.room;
  if (timers[room]) { clearTimeout(timers[room]); delete timers[room]; }
  res.json({ success: true });
});

// ═══ RESET ROOM ═══
app.post('/api/rooms/reset-all', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId       = req.user.hotelId;
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const rooms         = Object.keys(deviceRoomMap);
  res.json({ success: true, total: rooms.length, message: 'Reset started in background' });

  // Reset state applied to every room
  const RESET_STATE = {
    pdMode: false, line1: false, line2: false, line3: false,
    dimmer1: 0, dimmer2: 0, acMode: 0, fanSpeed: 0, acTemperatureSet: 26,
    curtainsPosition: 0, blindsPosition: 0,
    dndService: false, murService: false, sosService: false, roomStatus: 0
  };

  (async () => {
    const lastTelemetry = getLastKnownTelemetry(hotelId);
    const lastOverview  = getLastOverviewRooms(hotelId);
    const adapter       = getHotelAdapter(hotelId);

    // Step 1: update all in-memory state instantly + queue into ONE batch-telemetry SSE flush.
    // sseBatchTelemetry accumulates all rooms within the 500ms window and fires a single
    // batch-telemetry event — client processes it in one React state update instead of
    // the 4 200 individual SSE events that sendControl() would have produced.
    for (const room of rooms) {
      const devId = deviceRoomMap[room];
      if (!devId) continue;
      lastTelemetry[room] = { ...(lastTelemetry[room] || {}), ...RESET_STATE };
      if (lastOverview[room]) Object.assign(lastOverview[room], RESET_STATE);
      sseBatchTelemetry(hotelId, room, devId, RESET_STATE);
    }

    // Step 2: persist to ThingsBoard in background (non-blocking for UI).
    const BATCH = 20;
    for (let i = 0; i < rooms.length; i += BATCH) {
      const batch = rooms.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async room => {
        const devId = deviceRoomMap[room];
        if (!devId) return;
        try {
          await adapter.sendTelemetry(devId, RESET_STATE);
          await adapter.sendAttributes(devId, RESET_STATE);
        } catch (e) { console.error(`Reset TB write room ${room}:`, e.message); }
      }));
    }
  })();
});

// Update room type — stored in hotel_rooms table, applied immediately to next broadcast
app.patch('/api/rooms/:room/type', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId      = req.user.hotelId;
  const { room }     = req.params;
  const { roomType } = req.body;
  if (!ROOM_TYPES.includes(roomType)) return res.status(400).json({ error: 'Invalid room type' });

  const changed = db.prepare(
    'UPDATE hotel_rooms SET room_type=? WHERE hotel_id=? AND room_number=?'
  ).run(roomType, hotelId, room);

  if (changed.changes === 0) {
    // Row missing — insert with auto-detected floor
    const floor = parseInt(room.length <= 3 ? room[0] : room.slice(0, -2)) || 1;
    db.prepare('INSERT OR IGNORE INTO hotel_rooms (hotel_id, room_number, floor, room_type) VALUES (?,?,?,?)')
      .run(hotelId, room, floor, roomType);
  }

  // Update the in-memory cache immediately — no need for a full 600-room TB refetch
  const lastOverview = getLastOverviewRooms(hotelId);
  if (lastOverview[room]) {
    lastOverview[room].type = roomType;
    lastOverview[room].typeId = ROOM_TYPES.indexOf(roomType);
    sseBroadcast(hotelId, 'telemetry', { room, deviceId: lastOverview[room].deviceId || `sim-${room}`, data: { type: roomType } });
  }
  res.json({ ok: true });
});

app.post('/api/rooms/:room/reset', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const hotelId       = req.user.hotelId;
  const { room }      = req.params;
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId         = deviceRoomMap[room];
  if (!devId) return res.status(404).json({ error: 'Device not found' });
  try {
    await sendControl(hotelId, devId, 'setPDMode', { pdMode: false }, req.user.username);
    await sendControl(hotelId, devId, 'setLines', { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 }, req.user.username);
    await sendControl(hotelId, devId, 'setAC', { acMode: 0, fanSpeed: 0, acTemperatureSet: 26 }, req.user.username);
    await sendControl(hotelId, devId, 'setCurtainsBlinds', { curtainsPosition: 0, blindsPosition: 0 }, req.user.username);
    await sendControl(hotelId, devId, 'resetServices', { services: ['dndService', 'murService', 'sosService'] }, req.user.username);
    await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 0 }, req.user.username);
    // Soft-reset meters: store current absolute reading as new baseline so the
    // next guest's consumption starts from 0 without touching the physical device.
    const liveData = getLastOverviewRooms(hotelId);
    const liveRoom = liveData[room] || {};
    db.prepare(
      'UPDATE hotel_rooms SET elec_meter_baseline=?, water_meter_baseline=? WHERE hotel_id=? AND room_number=?'
    ).run(liveRoom.elecConsumption || 0, liveRoom.waterConsumption || 0, hotelId, room);
    // Cancel any active reservation for this room
    db.prepare('UPDATE reservations SET active=0 WHERE hotel_id=? AND room=? AND active=1').run(hotelId, room);
    sseBroadcast(hotelId, 'lockout', { room });
    addLog(hotelId, 'pms', `Reservation cancelled (room reset) Rm${room}`, { room, user: req.user.username });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// (coerceTelemetry imported from control.service at top)

// ═══ SIMULATOR — DIRECT INJECT ═══
// Bypasses IoT platform: updates in-memory state and broadcasts SSE immediately.
app.post('/api/simulator/inject', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const hotelId = req.user.hotelId;
  const { room, telemetry } = req.body;
  if (!room || !telemetry || typeof telemetry !== 'object') {
    return res.status(400).json({ error: 'room and telemetry object required' });
  }

  const coerced = coerceTelemetry(telemetry);
  if (!Object.keys(coerced).length) return res.status(400).json({ error: 'No valid telemetry keys provided' });

  // Update in-memory overview state so SSE reflects the simulated values
  const lastOverview = getLastOverviewRooms(hotelId);
  if (!lastOverview[room]) lastOverview[room] = { room, floor: Math.floor(Number(room) / 100), online: true };
  Object.assign(lastOverview[room], coerced);

  detectAndLogChanges(hotelId, room, coerced);

  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId         = deviceRoomMap[room] || `sim-${room}`;

  // Broadcast SSE immediately (works even without ThingsBoard)
  sseBroadcast(hotelId, 'telemetry', { room, deviceId: devId, data: coerced });

  // Auto-close door after 5 seconds when simulator opens it
  if (coerced.doorStatus === true) {
    setTimeout(() => {
      const snap = getLastOverviewRooms(hotelId);
      if (snap[room]) snap[room].doorStatus = false;
      sseBroadcast(hotelId, 'telemetry', { room, deviceId: devId, data: { doorStatus: false } });
    }, 5000);
  }

  // Also push to ThingsBoard if a real device is mapped (best-effort, non-blocking)
  const realDevId = deviceRoomMap[room];
  if (realDevId) {
    try {
      const adapter = getHotelAdapter(hotelId);
      await adapter.sendTelemetry(realDevId, coerced);
    } catch (_) { /* ignore TB errors in simulator */ }
  }

  res.json({ success: true, injected: coerced, mode: realDevId ? 'hardware' : 'virtual' });
});

// ═══ SIMULATOR — TB NATIVE INJECT ═══
// The "real operation" path: pushes telemetry TO ThingsBoard for real devices so
// it flows back through the TB WebSocket → processTelemetry() pipeline, exactly
// like a physical room controller would.  For virtual rooms (no TB device) it
// calls processTelemetry() directly, giving the same code path without TB.
app.post('/api/simulator/tb-inject', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const hotelId = req.user.hotelId;
  const { room, telemetry } = req.body;
  if (!room || !telemetry || typeof telemetry !== 'object')
    return res.status(400).json({ error: 'room and telemetry object required' });

  const coerced = coerceTelemetry(telemetry);
  if (!Object.keys(coerced).length) return res.status(400).json({ error: 'No valid telemetry keys provided' });

  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId         = deviceRoomMap[room];

  if (devId) {
    // Real device: publish to ThingsBoard. TB stores it and pushes it back to our
    // WebSocket subscription → processTelemetry() fires → SSE → browser.
    // This is identical to what a real room controller does.
    try {
      const adapter = getHotelAdapter(hotelId);
      await adapter.sendTelemetry(devId, coerced);
      res.json({ success: true, mode: 'platform', room, injected: coerced });
    } catch (e) {
      res.status(502).json({ error: `IoT platform write failed: ${e.message}` });
    }
  } else {
    // Virtual room: no TB device, but run through the exact same processing
    // pipeline as if the data came from the TB WebSocket.
    const virtualDevId  = `sim-${room}`;
    const lastOverview  = getLastOverviewRooms(hotelId);
    if (!lastOverview[room]) lastOverview[room] = { room, floor: Math.floor(Number(room) / 100), online: true };
    processTelemetry(hotelId, room, virtualDevId, coerced);

    // Auto-close door after 5 s for virtual rooms
    if (coerced.doorStatus === true) {
      setTimeout(() => {
        const snap = getLastOverviewRooms(hotelId);
        if (snap[room]) snap[room].doorStatus = false;
        processTelemetry(hotelId, room, virtualDevId, { doorStatus: false });
      }, 5000);
    }
    res.json({ success: true, mode: 'virtual-pipeline', room, injected: coerced });
  }
});

// ═══ FINANCIAL ROUTES ═══
app.get('/api/finance/rates', authenticate, requireRole('owner', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM night_rates WHERE hotel_id=? ORDER BY room_type').all(req.user.hotelId));
});

app.put('/api/finance/rates', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const rates   = req.body;
  const update  = db.prepare("INSERT OR REPLACE INTO night_rates (hotel_id, room_type, rate_per_night, updated_by, updated_at) VALUES (?,?,?,?,datetime('now'))");
  const run     = db.transaction(() => {
    for (const [type, rate] of Object.entries(rates)) {
      if (ROOM_TYPES.includes(type) && !isNaN(rate)) update.run(hotelId, type, parseFloat(rate), req.user.username);
    }
  });
  run();
  res.json({ success: true });
});

app.get('/api/finance/income', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const limit   = parseInt(req.query.limit) || 100;
  const offset  = parseInt(req.query.offset) || 0;
  const rows    = db.prepare('SELECT * FROM income_log WHERE hotel_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(hotelId, limit, offset);
  const total   = db.prepare('SELECT COUNT(*) as cnt, SUM(total_amount) as sum FROM income_log WHERE hotel_id=?').get(hotelId);
  res.json({ rows, total: total.cnt, totalAmount: total.sum || 0 });
});

app.get('/api/finance/income/export', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const rows    = db.prepare('SELECT * FROM income_log WHERE hotel_id=? ORDER BY created_at DESC').all(hotelId);
  const header  = 'Room,Guest,Check-In,Planned-Check-Out,Actual-Checkout,Nights,Type,Rate/Night,Total,Payment,Elec-In,Elec-Out,Water-In,Water-Out,Staff';
  const csv     = rows.map(r => [
    r.room, `"${(r.guest_name||'').replace(/"/g,'""')}"`,
    r.check_in, r.check_out, r.created_at, r.nights, r.room_type,
    r.rate_per_night, r.total_amount, r.payment_method,
    r.elec_at_checkin ?? '', r.elec_at_checkout ?? '',
    r.water_at_checkin ?? '', r.water_at_checkout ?? '',
    r.created_by || ''
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="income-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send([header, ...csv].join('\n'));
});

app.delete('/api/finance/income', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const result  = db.prepare('DELETE FROM income_log WHERE hotel_id=?').run(hotelId);
  res.json({ success: true, deleted: result.changes });
});

app.get('/api/finance/summary', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId  = req.user.hotelId;
  const byType   = db.prepare('SELECT room_type, COUNT(*) as stays, SUM(nights) as nights, SUM(total_amount) as revenue FROM income_log WHERE hotel_id=? GROUP BY room_type').all(hotelId);
  const byPayment = db.prepare('SELECT payment_method, COUNT(*) as count, SUM(total_amount) as amount FROM income_log WHERE hotel_id=? GROUP BY payment_method').all(hotelId);
  const total    = db.prepare('SELECT SUM(total_amount) as total FROM income_log WHERE hotel_id=?').get(hotelId);
  res.json({ byType, byPayment, total: total.total || 0 });
});

// ═══ UTILITY COSTS & TOTAL CONSUMPTION ═══

// Get utility cost settings (cost per kWh, cost per m³)
app.get('/api/finance/utility-costs', authenticate, requireRole('owner'), (req, res) => {
  const rows = db.prepare('SELECT cost_type, cost_per_unit FROM utility_costs WHERE hotel_id=?').all(req.user.hotelId);
  const costs = {};
  rows.forEach(r => { costs[r.cost_type] = r.cost_per_unit; });
  res.json({ costPerKwh: costs.kwh || 0, costPerM3: costs.m3 || 0 });
});

// Update utility cost settings
app.put('/api/finance/utility-costs', authenticate, requireRole('owner'), (req, res) => {
  const { costPerKwh, costPerM3 } = req.body;
  const hotelId = req.user.hotelId;
  const upsert = db.prepare(
    'INSERT INTO utility_costs (hotel_id, cost_type, cost_per_unit, updated_by) VALUES (?,?,?,?) ON CONFLICT(hotel_id, cost_type) DO UPDATE SET cost_per_unit=?, updated_by=?, updated_at=datetime(\'now\')'
  );
  if (costPerKwh !== undefined) upsert.run(hotelId, 'kwh', parseFloat(costPerKwh) || 0, req.user.username, parseFloat(costPerKwh) || 0, req.user.username);
  if (costPerM3 !== undefined)  upsert.run(hotelId, 'm3',  parseFloat(costPerM3)  || 0, req.user.username, parseFloat(costPerM3)  || 0, req.user.username);
  res.json({ success: true });
});

// Get total hotel consumption (sum of all room meters from in-memory cache)
app.get('/api/hotel/consumption', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const lastOverview = getLastOverviewRooms(hotelId);
  let totalKwh = 0, totalM3 = 0;
  for (const room of Object.values(lastOverview)) {
    totalKwh += room.elecConsumption || 0;
    totalM3  += room.waterConsumption || 0;
  }
  // Get cost rates
  const rows = db.prepare('SELECT cost_type, cost_per_unit FROM utility_costs WHERE hotel_id=?').all(hotelId);
  const costs = {};
  rows.forEach(r => { costs[r.cost_type] = r.cost_per_unit; });
  const costPerKwh = costs.kwh || 0;
  const costPerM3  = costs.m3  || 0;

  res.json({
    totalKwh: Math.round(totalKwh * 100) / 100,
    totalM3: Math.round(totalM3 * 1000) / 1000,
    costPerKwh, costPerM3,
    totalElecCost: Math.round(totalKwh * costPerKwh * 100) / 100,
    totalWaterCost: Math.round(totalM3 * costPerM3 * 100) / 100,
    roomCount: Object.keys(lastOverview).length
  });
});

// ═══ SHIFT ACCOUNTING ═══
app.post('/api/shifts/open', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId  = req.user.hotelId;
  const existing = db.prepare("SELECT id FROM shifts WHERE hotel_id=? AND username=? AND status='open'").get(hotelId, req.user.username);
  if (existing) return res.status(400).json({ error: 'You already have an open shift. Close it first.' });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO shifts (id, hotel_id, user_id, username, status) VALUES (?,?,?,?,'open')").run(id, hotelId, req.user.id, req.user.username);
  addLog(hotelId, 'shift', 'Shift opened', { user: req.user.username });
  res.json({ id, username: req.user.username, status: 'open' });
});

app.get('/api/shifts/current', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const shift   = db.prepare("SELECT * FROM shifts WHERE hotel_id=? AND username=? AND status='open' ORDER BY created_at DESC LIMIT 1").get(hotelId, req.user.username);
  if (!shift) return res.json(null);
  const expected     = db.prepare('SELECT payment_method, SUM(total_amount) as amount FROM income_log WHERE hotel_id=? AND created_at>=? GROUP BY payment_method').all(hotelId, shift.opened_at);
  const expectedCash = expected.find(e => e.payment_method === 'cash')?.amount || 0;
  const expectedVisa = expected.find(e => e.payment_method === 'visa')?.amount || 0;
  res.json({ ...shift, expectedCash, expectedVisa });
});

app.post('/api/shifts/close', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId       = req.user.hotelId;
  const { actualCash, actualVisa, notes } = req.body;
  const shift         = db.prepare("SELECT * FROM shifts WHERE hotel_id=? AND username=? AND status='open'").get(hotelId, req.user.username);
  if (!shift) return res.status(404).json({ error: 'No open shift found' });
  const expected     = db.prepare('SELECT payment_method, SUM(total_amount) as amount FROM income_log WHERE hotel_id=? AND created_at>=? GROUP BY payment_method').all(hotelId, shift.opened_at);
  const expectedCash = expected.find(e => e.payment_method === 'cash')?.amount || 0;
  const expectedVisa = expected.find(e => e.payment_method === 'visa')?.amount || 0;
  db.prepare("UPDATE shifts SET status='closed', closed_at=datetime('now'), actual_cash=?, actual_visa=?, expected_cash=?, expected_visa=?, notes=? WHERE id=?")
    .run(parseFloat(actualCash) || 0, parseFloat(actualVisa) || 0, expectedCash, expectedVisa, notes || null, shift.id);
  addLog(hotelId, 'shift', 'Shift closed', { user: req.user.username });
  res.json({ success: true, expectedCash, expectedVisa, actualCash, actualVisa, diffCash: actualCash - expectedCash, diffVisa: actualVisa - expectedVisa });
});

app.post('/api/shifts/:id/force-close', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { actualCash, actualVisa, notes } = req.body || {};
  const shift = db.prepare("SELECT * FROM shifts WHERE id=? AND hotel_id=? AND status='open'").get(req.params.id, hotelId);
  if (!shift) return res.status(404).json({ error: 'Open shift not found' });
  const expected = db.prepare('SELECT payment_method, SUM(total_amount) as amount FROM income_log WHERE hotel_id=? AND created_at>=? GROUP BY payment_method').all(hotelId, shift.opened_at);
  const expectedCash = expected.find(e => e.payment_method === 'cash')?.amount || 0;
  const expectedVisa = expected.find(e => e.payment_method === 'visa')?.amount || 0;
  const noteText = notes || `Force closed by ${req.user.username}`;
  db.prepare("UPDATE shifts SET status='closed', closed_at=datetime('now'), actual_cash=?, actual_visa=?, expected_cash=?, expected_visa=?, notes=? WHERE id=?")
    .run(parseFloat(actualCash) || 0, parseFloat(actualVisa) || 0, expectedCash, expectedVisa, noteText, shift.id);
  addLog(hotelId, 'shift', `Shift force-closed: @${shift.username} (by ${req.user.username})`, { user: req.user.username });
  res.json({ success: true, expectedCash, expectedVisa, diffCash: (parseFloat(actualCash)||0) - expectedCash, diffVisa: (parseFloat(actualVisa)||0) - expectedVisa });
});

app.get('/api/shifts', authenticate, requireRole('owner', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM shifts WHERE hotel_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.hotelId));
});

app.get('/api/shifts/:id', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const shift   = db.prepare('SELECT * FROM shifts WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!shift) return res.status(404).json({ error: 'Not found' });
  const entries = db.prepare('SELECT * FROM income_log WHERE hotel_id=? AND created_at>=? AND (? IS NULL OR created_at<=?) ORDER BY created_at DESC')
    .all(hotelId, shift.opened_at, shift.closed_at, shift.closed_at || new Date().toISOString());
  res.json({ ...shift, entries });
});

// ═══ USER MANAGEMENT ═══
app.get('/api/users', authenticate, requireRole('owner', 'admin'), (req, res) => {
  res.json(db.prepare('SELECT id, username, role, full_name, active, last_login, created_at FROM hotel_users WHERE hotel_id=? ORDER BY created_at DESC').all(req.user.hotelId));
});

app.post('/api/users', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { username, password, role, fullName } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Required: username, password, role' });
  if (!['owner', 'admin', 'frontdesk', 'housekeeper', 'maintenance'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO hotel_users (hotel_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)').run(hotelId, username, hash, role, fullName || null);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/users/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId      = req.user.hotelId;
  const { fullName, role, active } = req.body;
  const user         = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (role && !['owner', 'admin', 'frontdesk', 'housekeeper', 'maintenance'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const isDeactivating = active === false && user.active === 1;

  db.prepare('UPDATE hotel_users SET full_name=COALESCE(?,full_name), role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=? AND hotel_id=?')
    .run(fullName ?? null, role ?? null, active != null ? (active ? 1 : 0) : null, req.params.id, hotelId);

  // When deactivating: stamp tokens_valid_after so any currently-held access
  // token is rejected by the authenticate middleware immediately on next call,
  // and delete all refresh tokens so they cannot obtain a new access token.
  if (isDeactivating) {
    db.prepare("UPDATE hotel_users SET tokens_valid_after=datetime('now') WHERE id=?").run(user.id);
    db.prepare("DELETE FROM refresh_tokens WHERE user_id=? AND user_type='hotel'").run(user.id);
    addLog(hotelId, 'auth', `Account deactivated & all sessions terminated: ${user.username}`, { user: req.user.username });
  }

  res.json({ success: true });
});

app.put('/api/users/:id/password', authenticate, async (req, res) => {
  const hotelId               = req.user.hotelId;
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const targetId = parseInt(req.params.id);
  if (req.user.role !== 'owner') {
    if (req.user.id !== targetId) return res.status(403).json({ error: 'You can only change your own password' });
    const user = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=?').get(targetId, hotelId);
    if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE hotel_users SET password_hash=? WHERE id=? AND hotel_id=?').run(hash, targetId, hotelId);
  db.prepare('DELETE FROM refresh_tokens WHERE user_id=?').run(targetId);
  const targetUser = db.prepare('SELECT username FROM hotel_users WHERE id=?').get(targetId);
  res.json({ success: true });
});

app.delete('/api/users/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const user    = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' });
  db.prepare('UPDATE hotel_users SET active=0 WHERE id=? AND hotel_id=?').run(req.params.id, hotelId);
  res.json({ success: true });
});

// ── GET /api/users/:id/qr-token ───────────────────────────────────────────
app.get('/api/users/:id/qr-token', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const user    = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=? AND active=1').get(req.params.id, hotelId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let token = user.qr_login_token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE hotel_users SET qr_login_token=? WHERE id=?').run(token, user.id);
  }
  const base     = process.env.GUEST_URL_BASE || `${req.protocol}://${req.get('host')}`;
  res.json({ token, loginUrl: `${base}/qr?t=${token}`, username: user.username, fullName: user.full_name, role: user.role });
});

// ── DELETE /api/users/:id/qr-token — revoke & regenerate ─────────────────
app.delete('/api/users/:id/qr-token', authenticate, requireRole('owner'), (req, res) => {
  const hotelId  = req.user.hotelId;
  const user     = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newToken = crypto.randomBytes(32).toString('hex');
  // Replace the QR token (blocks new logins via old QR image) and stamp
  // tokens_valid_after to NOW so any existing access token issued via the old
  // QR is rejected by authenticate immediately — not just on next refresh.
  // Also delete refresh tokens so the device cannot silently get a new one.
  db.prepare(`
    UPDATE hotel_users
    SET qr_login_token=?, tokens_valid_after=datetime('now')
    WHERE id=?
  `).run(newToken, user.id);
  db.prepare("DELETE FROM refresh_tokens WHERE user_id=? AND user_type='hotel'").run(user.id);

  const base = process.env.GUEST_URL_BASE || `${req.protocol}://${req.get('host')}`;
  addLog(hotelId, 'auth', `QR token revoked & all sessions force-terminated for ${user.username}`, { user: req.user.username });
  res.json({ success: true, token: newToken, loginUrl: `${base}/qr?t=${newToken}` });
});

// ═══ WEB PUSH ════════════════════════════════════════════════════════════════

app.get('/api/push/vapid-key', (req, res) => {
  const row = db.prepare("SELECT value FROM platform_config WHERE key='vapid_public'").get();
  if (!row) return res.status(503).json({ error: 'Push not configured' });
  res.json({ publicKey: row.value });
});

app.post('/api/push/subscribe', authenticate, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'endpoint and keys (p256dh, auth) required' });
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO push_subscriptions (id, hotel_id, username, endpoint, keys_p256dh, keys_auth, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      hotel_id=excluded.hotel_id, username=excluded.username,
      keys_p256dh=excluded.keys_p256dh, keys_auth=excluded.keys_auth,
      created_at=excluded.created_at
  `).run(id, req.user.hotelId, req.user.username, endpoint, keys.p256dh, keys.auth, Date.now());
  res.json({ success: true });
});

app.delete('/api/push/unsubscribe', authenticate, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND username=?").run(endpoint, req.user.username);
  res.json({ success: true });
});

// ═══ HOUSEKEEPING WORKFLOW ═══
//
// Role access summary:
//   GET  /api/housekeeping/queue         — managers see all dirty rooms; housekeepers see theirs
//   GET  /api/housekeeping/assignments   — managers see all; housekeepers see own active ones
//   GET  /api/housekeeping/housekeepers  — managers only; list housekeeper accounts for assignment dropdown
//   POST /api/housekeeping/assign        — managers only; bulk-assign rooms to one housekeeper
//   POST /api/housekeeping/assignments/:id/start    — housekeeper or manager; pending → in_progress
//   POST /api/housekeeping/assignments/:id/complete — housekeeper or manager; in_progress → done
//                                                     also resets room appliances and sets VACANT
//   DELETE /api/housekeeping/assignments/:id        — managers only; cancel an assignment

// ── GET /api/housekeeping/queue ───────────────────────────────────────────
// Returns SERVICE-status rooms that have no active (pending/in_progress) assignment.
// Managers see all; housekeepers see the rooms already assigned to them.
app.get('/api/housekeeping/queue', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper'), (req, res) => {
  const hotelId    = req.user.hotelId;
  const isManager  = ['owner', 'admin', 'frontdesk'].includes(req.user.role);
  const lastOverview = getLastOverviewRooms(hotelId);

  // Build set of rooms that already have an active assignment
  const activeRooms = new Set(
    db.prepare(
      "SELECT room FROM housekeeping_assignments WHERE hotel_id=? AND status IN ('pending','in_progress')"
    ).all(hotelId).map(r => r.room)
  );

  // For managers: SERVICE rooms with no active assignment (the "unassigned dirty" queue)
  if (isManager) {
    const dirty = Object.values(lastOverview)
      .filter(r => r.roomStatus === 2 && !activeRooms.has(String(r.room)))
      .map(r => ({ room: r.room, floor: r.floor, type: r.type, guestName: r.reservation?.guestName || null }));
    return res.json(dirty);
  }

  // For housekeepers: their own pending/in_progress assignments
  const myAssignments = db.prepare(
    "SELECT * FROM housekeeping_assignments WHERE hotel_id=? AND assigned_to=? AND status IN ('pending','in_progress') ORDER BY assigned_at DESC"
  ).all(hotelId, req.user.username);
  const enriched = myAssignments.map(a => ({
    ...a,
    floor: lastOverview[a.room]?.floor ?? null,
    type:  lastOverview[a.room]?.type  ?? null,
  }));
  res.json(enriched);
});

// ── GET /api/housekeeping/assignments ─────────────────────────────────────
// Managers get all active assignments. Housekeepers get only their own.
app.get('/api/housekeeping/assignments', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper'), (req, res) => {
  const hotelId   = req.user.hotelId;
  const isManager = ['owner', 'admin', 'frontdesk'].includes(req.user.role);
  const lastOverview = getLastOverviewRooms(hotelId);

  let rows;
  if (isManager) {
    rows = db.prepare(
      "SELECT * FROM housekeeping_assignments WHERE hotel_id=? AND status != 'cancelled' ORDER BY assigned_at DESC LIMIT 200"
    ).all(hotelId);
  } else {
    rows = db.prepare(
      "SELECT * FROM housekeeping_assignments WHERE hotel_id=? AND assigned_to=? AND status IN ('pending','in_progress') ORDER BY assigned_at DESC"
    ).all(hotelId, req.user.username);
  }

  const enriched = rows.map(a => ({
    ...a,
    floor: lastOverview[a.room]?.floor ?? null,
    type:  lastOverview[a.room]?.type  ?? null,
  }));
  res.json(enriched);
});

// ── GET /api/housekeeping/housekeepers ────────────────────────────────────
// List active housekeeper accounts for the assignment dropdown.
app.get('/api/housekeeping/housekeepers', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const list = db.prepare(
    "SELECT id, username, full_name FROM hotel_users WHERE hotel_id=? AND role='housekeeper' AND active=1 ORDER BY full_name, username"
  ).all(hotelId);
  res.json(list);
});

// ── GET /api/housekeeping/maintenance-workers ─────────────────────────────
// List all assignable staff (admin, housekeeper, maintenance) for the ticket assignment dropdown.
app.get('/api/housekeeping/maintenance-workers', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const list = db.prepare(
    "SELECT id, username, full_name, role FROM hotel_users WHERE hotel_id=? AND role IN ('admin','housekeeper','maintenance') AND active=1 ORDER BY role, full_name, username"
  ).all(hotelId);
  res.json(list);
});

// ── POST /api/housekeeping/assign ─────────────────────────────────────────
// Body: { rooms: ['101','102'], assignedTo: 'housekeeper_username', notes: '' }
// Creates one assignment record per room, then notifies the housekeeper via SSE.
app.post('/api/housekeeping/assign', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId              = req.user.hotelId;
  const { rooms, assignedTo, notes } = req.body;

  if (!rooms?.length || !assignedTo) {
    return res.status(400).json({ error: 'rooms (array) and assignedTo (username) are required' });
  }

  // Verify housekeeper belongs to this hotel
  const hkUser = db.prepare(
    "SELECT username, full_name FROM hotel_users WHERE hotel_id=? AND username=? AND role='housekeeper' AND active=1"
  ).get(hotelId, assignedTo);
  if (!hkUser) return res.status(404).json({ error: 'Housekeeper not found or inactive' });

  const now    = Date.now();
  const crypto = require('crypto');
  const created = [];

  for (const room of rooms) {
    // Prevent duplicate active assignments for the same room
    const existing = db.prepare(
      "SELECT id FROM housekeeping_assignments WHERE hotel_id=? AND room=? AND status IN ('pending','in_progress')"
    ).get(hotelId, String(room));
    if (existing) continue; // skip rooms already assigned

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO housekeeping_assignments
         (id, hotel_id, room, assigned_to, assigned_by, assigned_at, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(id, hotelId, String(room), assignedTo, req.user.username, now, notes || null);

    created.push({ id, room: String(room) });
  }

  if (!created.length) {
    return res.status(409).json({ error: 'All selected rooms already have active assignments' });
  }

  addLog(hotelId, 'housekeeping',
    `${created.length} room(s) assigned to ${hkUser.full_name || assignedTo} by ${req.user.username}`,
    { user: req.user.username }
  );

  // Notify the housekeeper in real-time via their personal SSE channel
  sseBroadcastUser(hotelId, assignedTo, 'housekeeping_assign', {
    assignments: created,
    assignedBy: req.user.username,
    notes: notes || null,
    ts: now,
  });

  // Also update the manager view for everyone with manager roles
  sseBroadcastRoles(hotelId, 'housekeeping_update', { action: 'assigned', assignments: created, assignedTo }, ['owner', 'admin', 'frontdesk']);

  // Send Web Push to all registered devices of this housekeeper
  const pushSubs = db.prepare("SELECT * FROM push_subscriptions WHERE hotel_id=? AND username=?").all(hotelId, assignedTo);
  const roomList = created.map(c => c.room).join(', ');
  const pushPayload = JSON.stringify({
    title: '🧹 New Cleaning Assignment',
    body: `Room${created.length > 1 ? 's' : ''} ${roomList} assigned to you${notes ? ` — ${notes}` : ''}`,
    tag: 'hk-assign', url: '/',
  });
  for (const sub of pushSubs) {
    webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
      pushPayload
    ).catch(() => {
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint);
    });
  }

  res.json({ success: true, assigned: created.length, skipped: rooms.length - created.length });
});

// ── POST /api/housekeeping/assignments/:id/start ──────────────────────────
// Housekeeper (or manager) marks a task as in_progress.
app.post('/api/housekeeping/assignments/:id/start', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper'), async (req, res) => {
  const hotelId = req.user.hotelId;
  const row     = db.prepare('SELECT * FROM housekeeping_assignments WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);

  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: `Cannot start — current status is '${row.status}'` });

  // Housekeepers can only operate on their own assignments
  if (req.user.role === 'housekeeper' && row.assigned_to !== req.user.username) {
    return res.status(403).json({ error: 'Not your assignment' });
  }

  db.prepare(
    "UPDATE housekeeping_assignments SET status='in_progress', started_at=? WHERE id=?"
  ).run(Date.now(), row.id);

  addLog(hotelId, 'housekeeping', `Rm${row.room} cleaning started by ${req.user.username}`, { room: row.room, user: req.user.username });

  sseBroadcastRoles(hotelId, 'housekeeping_update',
    { action: 'started', id: row.id, room: row.room, assignedTo: row.assigned_to },
    ['owner', 'admin', 'frontdesk']
  );

  res.json({ success: true });
});

// ── POST /api/housekeeping/assignments/:id/complete ───────────────────────
// Housekeeper (or manager) marks cleaning as done.
// Resets all room appliances (lights off, AC off 26°C, curtains closed, services cleared)
// and sets room status to VACANT (0), which also writes lastCleanedTime automatically.
app.post('/api/housekeeping/assignments/:id/complete', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper'), async (req, res) => {
  const hotelId = req.user.hotelId;
  const row     = db.prepare('SELECT * FROM housekeeping_assignments WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);

  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (row.status === 'done')      return res.status(400).json({ error: 'Already completed' });
  if (row.status === 'cancelled') return res.status(400).json({ error: 'Assignment was cancelled' });

  // Housekeepers can only complete their own assignments
  if (req.user.role === 'housekeeper' && row.assigned_to !== req.user.username) {
    return res.status(403).json({ error: 'Not your assignment' });
  }

  db.prepare(
    "UPDATE housekeeping_assignments SET status='done', completed_at=? WHERE id=?"
  ).run(Date.now(), row.id);

  // ── Reset room appliances (housekeeping-safe: no reservation cancel, no meter reset) ──
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId         = deviceRoomMap[row.room];

  if (devId) {
    try {
      // Disable power-down mode first so the device wakes up
      await sendControl(hotelId, devId, 'setPDMode',         { pdMode: false }, req.user.username);
      // Lights off (dimmers also zeroed)
      await sendControl(hotelId, devId, 'setLines',          { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 }, req.user.username);
      // AC off, 26°C standby, fan off
      await sendControl(hotelId, devId, 'setAC',             { acMode: 0, fanSpeed: 0, acTemperatureSet: 26 }, req.user.username);
      // Curtains and blinds closed
      await sendControl(hotelId, devId, 'setCurtainsBlinds', { curtainsPosition: 0, blindsPosition: 0 }, req.user.username);
      // Clear all service flags (DND / MUR / SOS)
      await sendControl(hotelId, devId, 'resetServices',     { services: ['dndService', 'murService', 'sosService'] }, req.user.username);
      // Set VACANT — also auto-writes lastCleanedTime (see controlToTelemetry)
      await sendControl(hotelId, devId, 'setRoomStatus',     { roomStatus: 0 }, req.user.username);
    } catch (e) {
      console.error(`Housekeeping reset failed for room ${row.room}:`, e.message);
      // Don't fail the HTTP response — DB is already marked done
    }
  }

  // Soft-reset meters: snapshot current absolute reading as new baseline
  // so the next guest's consumption starts from 0 (physical device unchanged).
  const liveRooms2 = getLastOverviewRooms(hotelId);
  const liveRoom2  = liveRooms2[row.room] || {};
  db.prepare(
    'UPDATE hotel_rooms SET elec_meter_baseline=?, water_meter_baseline=? WHERE hotel_id=? AND room_number=?'
  ).run(liveRoom2.elecConsumption || 0, liveRoom2.waterConsumption || 0, hotelId, row.room);

  addLog(hotelId, 'housekeeping',
    `Rm${row.room} cleaned by ${req.user.username} → VACANT`,
    { room: row.room, user: req.user.username }
  );

  // Notify all managers that a room is now clean and back in inventory
  sseBroadcastRoles(hotelId, 'housekeeping_update',
    { action: 'completed', id: row.id, room: row.room, assignedTo: row.assigned_to },
    ['owner', 'admin', 'frontdesk']
  );

  res.json({ success: true });
});

// ── DELETE /api/housekeeping/assignments/:id ──────────────────────────────
// Managers cancel an assignment (e.g. wrong room, re-assignment needed).
app.delete('/api/housekeeping/assignments/:id', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const row     = db.prepare('SELECT * FROM housekeeping_assignments WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);

  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (['done', 'cancelled'].includes(row.status)) {
    return res.status(400).json({ error: `Cannot cancel — status is already '${row.status}'` });
  }

  db.prepare("UPDATE housekeeping_assignments SET status='cancelled' WHERE id=?").run(row.id);
  addLog(hotelId, 'housekeeping', `Rm${row.room} assignment cancelled by ${req.user.username}`, { room: row.room, user: req.user.username });

  // Notify the housekeeper their task was removed
  sseBroadcastUser(hotelId, row.assigned_to, 'housekeeping_cancel', { id: row.id, room: row.room });
  sseBroadcastRoles(hotelId, 'housekeeping_update',
    { action: 'cancelled', id: row.id, room: row.room },
    ['owner', 'admin', 'frontdesk']
  );

  res.json({ success: true });
});

// ═══ MAINTENANCE TICKETS ═══════════════════════════════════════════════════

// GET /api/maintenance  — all roles except guest; housekeepers see own tickets; maintenance workers see assigned tickets
app.get('/api/maintenance', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper', 'maintenance'), (req, res) => {
  const hotelId   = req.user.hotelId;
  const isManager = ['owner', 'admin', 'frontdesk'].includes(req.user.role);
  const { status } = req.query;

  let sql  = 'SELECT * FROM maintenance_tickets WHERE hotel_id=?';
  const params = [hotelId];

  if (req.user.role === 'maintenance') {
    sql += ' AND assigned_to=?';
    params.push(req.user.username);
  } else if (!isManager) {
    sql += ' AND reported_by=?';
    params.push(req.user.username);
  }
  if (status && status !== 'all') {
    sql += ' AND status=?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';

  res.json(db.prepare(sql).all(...params));
});

// POST /api/maintenance  — any staff can open a ticket
app.post('/api/maintenance', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper', 'maintenance'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { room_number, category, description, priority = 'medium' } = req.body;

  if (!category || !description) {
    return res.status(400).json({ error: 'category and description are required' });
  }

  const validCategories = ['AC', 'Plumbing', 'Electrical', 'Furniture', 'Cleaning', 'Other'];
  const validPriorities = ['low', 'medium', 'high', 'urgent'];

  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }

  const stmt = db.prepare(`
    INSERT INTO maintenance_tickets (hotel_id, room_number, category, description, priority, status, reported_by)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
  `);
  const result = stmt.run(hotelId, room_number || null, category, description, priority, req.user.username);
  const ticket = db.prepare('SELECT * FROM maintenance_tickets WHERE id=?').get(result.lastInsertRowid);

  addLog(hotelId, 'maintenance', `Ticket #${ticket.id} opened by ${req.user.username}: [${category}] ${description.slice(0, 60)}`, { user: req.user.username });
  sseBroadcastRoles(hotelId, 'maintenance_update', { action: 'created', ticket }, ['owner', 'admin', 'frontdesk']);

  // Auto-set room to MAINTENANCE (3) when a ticket specifies a room number
  if (room_number) {
    const devId = getDeviceRoomMap(hotelId)[String(room_number)];
    if (devId) {
      setImmediate(() => sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 3 }, req.user.username).catch(() => {}));
    }
  }

  // Push notification to all maintenance workers
  setImmediate(() => {
    const maintWorkers = db.prepare("SELECT username FROM hotel_users WHERE hotel_id=? AND role='maintenance' AND active=1").all(hotelId);
    const pushBody = `${room_number ? `Room ${room_number} — ` : ''}[${category}] ${description.slice(0, 60)}`;
    const pushPayload = JSON.stringify({ title: '🔧 New Maintenance Ticket', body: pushBody, tag: 'maint-new', url: '/' });
    for (const w of maintWorkers) {
      const subs = db.prepare("SELECT * FROM push_subscriptions WHERE hotel_id=? AND username=?").all(hotelId, w.username);
      for (const sub of subs) {
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
          pushPayload
        ).catch(() => { db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint); });
      }
    }
  });

  res.status(201).json(ticket);
});

// PATCH /api/maintenance/:id  — managers: full edit; maintenance workers: update status on assigned tickets; reporters: edit description
app.patch('/api/maintenance/:id', authenticate, requireRole('owner', 'admin', 'frontdesk', 'housekeeper', 'maintenance'), (req, res) => {
  const hotelId   = req.user.hotelId;
  const isManager = ['owner', 'admin', 'frontdesk'].includes(req.user.role);
  const isMaintWorker = req.user.role === 'maintenance';
  const ticket    = db.prepare('SELECT * FROM maintenance_tickets WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  // Maintenance workers can only update tickets assigned to them
  if (isMaintWorker && ticket.assigned_to !== req.user.username) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Housekeepers can only edit their own tickets
  if (!isManager && !isMaintWorker && ticket.reported_by !== req.user.username) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { status, assigned_to, notes, description, priority } = req.body;
  const now = Math.floor(Date.now() / 1000);

  const updates = ['updated_at=?'];
  const params  = [now];

  if (isManager) {
    if (status)      { updates.push('status=?');      params.push(status); }
    if (assigned_to !== undefined) { updates.push('assigned_to=?'); params.push(assigned_to); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes); }
    if (priority)    { updates.push('priority=?');    params.push(priority); }
    if (description) { updates.push('description=?'); params.push(description); }
    if (status === 'resolved') { updates.push('resolved_at=?'); params.push(now); }
  } else if (isMaintWorker) {
    // Maintenance workers can mark in_progress or resolved
    if (status && ['in_progress', 'resolved'].includes(status)) {
      updates.push('status=?'); params.push(status);
      if (status === 'resolved') { updates.push('resolved_at=?'); params.push(now); }
    }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes); }
  } else {
    if (description && ticket.status === 'open') { updates.push('description=?'); params.push(description); }
  }

  params.push(ticket.id);
  db.prepare(`UPDATE maintenance_tickets SET ${updates.join(', ')} WHERE id=?`).run(...params);

  const updated = db.prepare('SELECT * FROM maintenance_tickets WHERE id=?').get(ticket.id);
  addLog(hotelId, 'maintenance', `Ticket #${ticket.id} updated by ${req.user.username}`, { user: req.user.username });
  sseBroadcastRoles(hotelId, 'maintenance_update', { action: 'updated', ticket: updated }, ['owner', 'admin', 'frontdesk']);
  // When resolved with a room number → set room back to SERVICE so it appears in housekeeping queue
  if (updated.status === 'resolved' && updated.room_number) {
    const devId = getDeviceRoomMap(hotelId)[String(updated.room_number)];
    if (devId) {
      setImmediate(() => sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 2 }, req.user.username).catch(() => {}));
    }
    // Push notification to all housekeepers that the room is ready for cleaning
    setImmediate(() => {
      const hkWorkers = db.prepare("SELECT username FROM hotel_users WHERE hotel_id=? AND role='housekeeper' AND active=1").all(hotelId);
      const hkPayload = JSON.stringify({
        title: '🧹 Room Ready for Cleaning',
        body: `Room ${updated.room_number} maintenance resolved — ready for housekeeping`,
        tag: 'hk-maint-resolved', url: '/',
      });
      for (const w of hkWorkers) {
        const subs = db.prepare("SELECT * FROM push_subscriptions WHERE hotel_id=? AND username=?").all(hotelId, w.username);
        for (const sub of subs) {
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
            hkPayload
          ).catch(() => { db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint); });
        }
      }
    });
  }
  if (ticket.reported_by !== req.user.username) {
    sseBroadcastUser(hotelId, ticket.reported_by, 'maintenance_update', { action: 'updated', ticket: updated });
  }
  // Notify the assigned maintenance worker when a ticket is assigned or updated
  if (updated.assigned_to && updated.assigned_to !== req.user.username) {
    sseBroadcastUser(hotelId, updated.assigned_to, 'maintenance_assigned', { ticket: updated });
    // Push notification to the assigned worker
    const assignSubs = db.prepare("SELECT * FROM push_subscriptions WHERE hotel_id=? AND username=?").all(hotelId, updated.assigned_to);
    if (assignSubs.length) {
      const assignPayload = JSON.stringify({
        title: '🔧 Maintenance Ticket Assigned',
        body: `${updated.room_number ? `Room ${updated.room_number} — ` : ''}${updated.description.slice(0, 60)}`,
        tag: 'maint-assign', url: '/',
      });
      for (const sub of assignSubs) {
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
          assignPayload
        ).catch(() => { db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint); });
      }
    }
  }

  res.json(updated);
});

// DELETE /api/maintenance/:id  — managers only; hard-delete (rare, for test data)
app.delete('/api/maintenance/:id', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const ticket  = db.prepare('SELECT * FROM maintenance_tickets WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  db.prepare('DELETE FROM maintenance_tickets WHERE id=?').run(ticket.id);
  addLog(hotelId, 'maintenance', `Ticket #${ticket.id} deleted by ${req.user.username}`, { user: req.user.username });
  sseBroadcastRoles(hotelId, 'maintenance_update', { action: 'deleted', id: ticket.id }, ['owner', 'admin', 'frontdesk']);

  res.json({ success: true });
});

// ═══ UPSELL ENGINE ═════════════════════════════════════════════════════════

// ── GET /api/upsell/offers ────────────────────────────────────────────────
// Guest + staff: list active offers for the hotel (ordered by sort_order)
app.get('/api/upsell/offers', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;
  let rows = db.prepare(
    'SELECT * FROM upsell_offers WHERE hotel_id=? AND active=1 ORDER BY sort_order, id'
  ).all(hotelId);

  // For guests, filter by room_types if set
  if (req.user.role === 'guest' && req.user.room) {
    const FLOOR_TYPE = { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3 };
    const ROOM_TYPES = ['STANDARD', 'SUPERIOR', 'DELUXE', 'SUITE'];
    const hotelRoom = db.prepare(
      'SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?'
    ).get(hotelId, String(req.user.room));
    const roomNum = String(req.user.room);
    const guestRoomType = hotelRoom?.room_type
      || ROOM_TYPES[FLOOR_TYPE[parseInt(roomNum.length <= 3 ? roomNum[0] : roomNum.slice(0, -2))] ?? 0];

    rows = rows.filter(o => {
      if (!o.room_types) return true; // null = visible to all
      try {
        const allowed = JSON.parse(o.room_types);
        return Array.isArray(allowed) && allowed.includes(guestRoomType);
      } catch { return true; }
    });
  }

  res.json(rows);
});

// ── GET /api/upsell/my-extras ─────────────────────────────────────────────
// Guest JWT: list own extras for the active reservation
app.get('/api/upsell/my-extras', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;

  // For guests, find their active reservation via room
  let reservationId;
  if (req.user.role === 'guest') {
    const res_ = db.prepare(
      "SELECT id FROM reservations WHERE hotel_id=? AND room=? AND active=1 LIMIT 1"
    ).get(hotelId, String(req.user.room));
    if (!res_) return res.json([]);
    reservationId = res_.id;
  } else {
    return res.status(403).json({ error: 'Use /api/upsell/reservations/:id/extras for staff' });
  }

  const rows = db.prepare(
    'SELECT * FROM reservation_extras WHERE hotel_id=? AND reservation_id=? ORDER BY created_at DESC'
  ).all(hotelId, reservationId);
  res.json(rows);
});

// ── POST /api/upsell/extras ───────────────────────────────────────────────
// Guest or staff: submit an extras request
// Body: { offerId, quantity, reservationId? }
// Guests: reservationId inferred from room; staff must provide reservationId
app.post('/api/upsell/extras', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;
  const { offerId, quantity = 1, reservationId: bodyResId } = req.body;

  if (!offerId) return res.status(400).json({ error: 'offerId is required' });
  if (!Number.isInteger(Number(quantity)) || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  // Validate offer belongs to this hotel and is active
  const offer = db.prepare('SELECT * FROM upsell_offers WHERE id=? AND hotel_id=? AND active=1').get(offerId, hotelId);
  if (!offer) return res.status(404).json({ error: 'Offer not found or inactive' });

  // Resolve reservation
  let reservation;
  if (req.user.role === 'guest') {
    reservation = db.prepare(
      "SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1 LIMIT 1"
    ).get(hotelId, String(req.user.room));
  } else {
    if (!bodyResId) return res.status(400).json({ error: 'reservationId is required for staff' });
    reservation = db.prepare('SELECT * FROM reservations WHERE id=? AND hotel_id=?').get(bodyResId, hotelId);
  }
  if (!reservation) return res.status(404).json({ error: 'No active reservation found' });

  const totalPrice = Math.round(offer.price * quantity * 100) / 100;
  const requestedBy = req.user.role === 'guest' ? 'guest' : req.user.username;

  const result = db.prepare(`
    INSERT INTO reservation_extras
      (hotel_id, reservation_id, offer_id, offer_name, offer_name_ar,
       quantity, unit_price, total_price, status, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(hotelId, reservation.id, offer.id, offer.name, offer.name_ar,
         quantity, offer.price, totalPrice, requestedBy);

  const extra = db.prepare('SELECT * FROM reservation_extras WHERE id=?').get(result.lastInsertRowid);

  addLog(hotelId, 'upsell',
    `Extra requested: [${offer.category}] ${offer.name} ×${quantity} by ${requestedBy} (Rm ${reservation.room})`,
    { room: reservation.room, user: requestedBy }
  );

  // Notify managers in real-time
  sseBroadcastRoles(hotelId, 'upsell_request', {
    extra, room: reservation.room, guestName: reservation.guest_name
  }, ['owner', 'admin', 'frontdesk']);

  res.status(201).json(extra);
});

// ── GET /api/upsell/reservations/:resId/extras ────────────────────────────
// Staff: list all extras for a specific reservation
app.get('/api/upsell/reservations/:resId/extras', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=? AND hotel_id=?').get(req.params.resId, hotelId);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });

  const rows = db.prepare(
    'SELECT * FROM reservation_extras WHERE reservation_id=? AND hotel_id=? ORDER BY created_at DESC'
  ).all(req.params.resId, hotelId);
  res.json(rows);
});

// ── GET /api/upsell/pending ───────────────────────────────────────────────
// Staff: all pending extras across all reservations (for badge + quick view)
app.get('/api/upsell/pending', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const rows = db.prepare(`
    SELECT re.*, r.room, r.guest_name
    FROM reservation_extras re
    JOIN reservations r ON re.reservation_id = r.id
    WHERE re.hotel_id=? AND re.status='pending'
    ORDER BY re.created_at DESC
  `).all(hotelId);
  res.json(rows);
});

// ── PATCH /api/upsell/extras/:id ──────────────────────────────────────────
// Staff: update extra status (confirmed / delivered / cancelled) + optional note
app.patch('/api/upsell/extras/:id', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const extra = db.prepare('SELECT * FROM reservation_extras WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!extra) return res.status(404).json({ error: 'Extra not found' });

  const { status, staffNote } = req.body;
  const validStatuses = ['confirmed', 'delivered', 'cancelled'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  const now = Math.floor(Date.now() / 1000);
  const updates = ['updated_at=?'];
  const params  = [now];
  if (status)                   { updates.push('status=?');     params.push(status); }
  if (staffNote !== undefined)  { updates.push('staff_note=?'); params.push(staffNote); }
  params.push(extra.id);

  db.prepare(`UPDATE reservation_extras SET ${updates.join(', ')} WHERE id=?`).run(...params);
  const updated = db.prepare('SELECT * FROM reservation_extras WHERE id=?').get(extra.id);

  // On confirm: log revenue to income_log
  if (status === 'confirmed') {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(extra.reservation_id);
    if (reservation) {
      const room       = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, reservation.room);
      const roomType   = room?.room_type || 'STANDARD';
      const todayISO   = new Date().toISOString().slice(0, 10);
      try {
        const crypto = require('crypto');
        db.prepare(`INSERT INTO income_log
          (id, hotel_id, reservation_id, room, guest_name, nights, room_type,
           rate_per_night, total_amount, payment_method, created_by,
           check_in, check_out, created_at)
          VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?, datetime('now'))`)
          .run(crypto.randomUUID(), hotelId, reservation.id, reservation.room,
               reservation.guest_name, roomType, extra.unit_price,
               updated.total_price, reservation.payment_method,
               req.user.username, todayISO, todayISO);
      } catch (e) { console.error('upsell income_log write failed:', e.message); }
    }
  }

  addLog(hotelId, 'upsell',
    `Extra #${extra.id} (${extra.offer_name}) ${status || 'updated'} by ${req.user.username}`,
    { user: req.user.username }
  );

  // Notify managers + the guest (if they have an SSE connection)
  sseBroadcastRoles(hotelId, 'upsell_update', { extra: updated }, ['owner', 'admin', 'frontdesk']);
  // Notify guest's SSE channel by room
  const reservation = db.prepare('SELECT room FROM reservations WHERE id=?').get(extra.reservation_id);
  if (reservation) {
    sseBroadcast(hotelId, 'upsell_update', { extra: updated, room: reservation.room });
  }

  res.json(updated);
});

// ── GET /api/upsell/catalog ───────────────────────────────────────────────
// Owner/admin: list all offers (including inactive)
app.get('/api/upsell/catalog', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const rows = db.prepare(
    'SELECT * FROM upsell_offers WHERE hotel_id=? ORDER BY sort_order, id'
  ).all(hotelId);
  res.json(rows);
});

// ── POST /api/upsell/catalog ──────────────────────────────────────────────
// Owner: create a new offer
app.post('/api/upsell/catalog', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { name, name_ar, description, description_ar, category = 'SERVICE', price, unit = 'one-time', active = 1, sort_order = 0, room_types } = req.body;

  if (!name || !name_ar) return res.status(400).json({ error: 'name and name_ar are required' });
  if (price === undefined || isNaN(Number(price))) return res.status(400).json({ error: 'price is required' });

  const validCategories = ['FOOD', 'TRANSPORT', 'AMENITY', 'SERVICE'];
  if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  const roomTypesVal = Array.isArray(room_types) && room_types.length > 0 ? JSON.stringify(room_types) : null;

  const result = db.prepare(`
    INSERT INTO upsell_offers (hotel_id, name, name_ar, description, description_ar, category, price, unit, active, sort_order, room_types)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hotelId, name, name_ar, description || null, description_ar || null, category, Number(price), unit, active ? 1 : 0, sort_order, roomTypesVal);

  const offer = db.prepare('SELECT * FROM upsell_offers WHERE id=?').get(result.lastInsertRowid);
  addLog(hotelId, 'upsell', `Offer created: ${name} (${category}) by ${req.user.username}`, { user: req.user.username });
  res.status(201).json(offer);
});

// ── PATCH /api/upsell/catalog/:id ─────────────────────────────────────────
// Owner: update an offer
app.patch('/api/upsell/catalog/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const offer = db.prepare('SELECT * FROM upsell_offers WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });

  const fields = ['name', 'name_ar', 'description', 'description_ar', 'category', 'price', 'unit', 'active', 'sort_order', 'room_types'];
  const updates = [];
  const params  = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f}=?`);
      let val = req.body[f];
      if (f === 'room_types') val = Array.isArray(val) && val.length > 0 ? JSON.stringify(val) : null;
      params.push(val);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(offer.id);

  db.prepare(`UPDATE upsell_offers SET ${updates.join(', ')} WHERE id=?`).run(...params);
  const updated = db.prepare('SELECT * FROM upsell_offers WHERE id=?').get(offer.id);
  addLog(hotelId, 'upsell', `Offer updated: ${updated.name} by ${req.user.username}`, { user: req.user.username });
  res.json(updated);
});

// ── DELETE /api/upsell/catalog/:id ────────────────────────────────────────
// Owner: hard-delete the offer
app.delete('/api/upsell/catalog/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const offer = db.prepare('SELECT * FROM upsell_offers WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });

  db.prepare('DELETE FROM upsell_offers WHERE id=?').run(offer.id);
  addLog(hotelId, 'upsell', `Offer deleted: ${offer.name} by ${req.user.username}`, { user: req.user.username });
  res.json({ success: true });
});

// ── GET /api/upsell/stats ─────────────────────────────────────────────────
// Owner/admin: per-offer request counts + revenue totals
app.get('/api/upsell/stats', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const rows = db.prepare(`
    SELECT
      o.id, o.name, o.name_ar, o.category, o.price, o.unit,
      COUNT(e.id)                                                AS total_requests,
      COALESCE(SUM(e.quantity), 0)                              AS total_qty,
      COALESCE(SUM(e.total_price), 0)                           AS total_revenue,
      COUNT(CASE WHEN e.status = 'pending'   THEN 1 END)        AS pending_count,
      COUNT(CASE WHEN e.status = 'confirmed' THEN 1 END)        AS confirmed_count,
      COUNT(CASE WHEN e.status = 'delivered' THEN 1 END)        AS delivered_count,
      COUNT(CASE WHEN e.status = 'cancelled' THEN 1 END)        AS cancelled_count
    FROM upsell_offers o
    LEFT JOIN reservation_extras e ON e.offer_id = o.id AND e.hotel_id = o.hotel_id
    WHERE o.hotel_id = ?
    GROUP BY o.id
    ORDER BY total_requests DESC, o.sort_order
  `).all(hotelId);
  res.json(rows);
});

// ── GET /api/upsell/stats/:offerId/rooms ──────────────────────────────────
// Owner/admin: per-room breakdown for one offer
app.get('/api/upsell/stats/:offerId/rooms', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const offer = db.prepare('SELECT id FROM upsell_offers WHERE id=? AND hotel_id=?').get(req.params.offerId, hotelId);
  if (!offer) return res.status(404).json({ error: 'Offer not found' });

  const rows = db.prepare(`
    SELECT
      r.room,
      COUNT(e.id)            AS total_requests,
      COALESCE(SUM(e.quantity), 0)   AS total_qty,
      COALESCE(SUM(e.total_price), 0) AS total_revenue
    FROM reservation_extras e
    JOIN reservations r ON r.id = e.reservation_id
    WHERE e.hotel_id = ? AND e.offer_id = ?
    GROUP BY r.room
    ORDER BY total_requests DESC
  `).all(hotelId, offer.id);
  res.json(rows);
});

// ─── Platform scenes (Greentech cj devices / other platform presets) ──────────
// Returns the list of scene presets available in the hotel's IoT platform.
// Used by ScenesPanel to offer "Import Platform Scenes".
app.get('/api/platform-scenes', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const hotelId = req.user.hotelId;
  try {
    const adapter = getHotelAdapter(hotelId);
    if (typeof adapter.listPlatformScenes !== 'function') {
      return res.json({ scenes: [], supported: false });
    }
    // Use the first registered device as the source for scene discovery
    const deviceRoomMap = getDeviceRoomMap(hotelId);
    const deviceIds = Object.values(deviceRoomMap);
    if (!deviceIds.length) return res.json({ scenes: [], supported: true });
    const scenes = await adapter.listPlatformScenes(deviceIds[0]);
    res.json({ scenes, supported: true });
  } catch (e) {
    console.error('[platform-scenes]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══ SCENES CRUD ═══

app.get('/api/scenes', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { room, isDefault } = req.query;
  // isDefault=1 → system scenes (shown in RoomModal); default → custom scenes (isDefault=0)
  const defFilter = isDefault === '1' ? 1 : 0;
  let rows;
  if (room) {
    // Room-specific view: room scenes + shared scenes
    rows = db.prepare(
      'SELECT * FROM scenes WHERE hotel_id=? AND (room_number=? OR is_shared=1) AND is_default=? ORDER BY is_shared DESC, created_at'
    ).all(hotelId, room, defFilter);
  } else {
    rows = db.prepare(
      'SELECT * FROM scenes WHERE hotel_id=? AND is_default=? ORDER BY is_shared DESC, room_number, created_at'
    ).all(hotelId, defFilter);
  }
  res.json(rows.map(s => ({
    ...s,
    room_number: s.is_shared ? null : s.room_number,
    enabled: !!s.enabled,
    is_shared: !!s.is_shared,
    trigger_config: JSON.parse(s.trigger_config),
    actions: JSON.parse(s.actions)
  })));
});

app.post('/api/scenes', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { roomNumber, name, triggerType, triggerConfig, actions, isDefault, isShared } = req.body;
  if ((!roomNumber && !isShared) || !name || !triggerType)
    return res.status(400).json({ error: 'roomNumber (or isShared), name, triggerType required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO scenes (id,hotel_id,room_number,name,trigger_type,trigger_config,actions,is_default,is_shared) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, hotelId, isShared ? '' : roomNumber, name, triggerType,
      JSON.stringify(triggerConfig || {}), JSON.stringify(actions || []), isDefault ? 1 : 0, isShared ? 1 : 0);
  res.json({ id, is_shared: !!isShared });
});

app.put('/api/scenes/:id', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const scene = db.prepare('SELECT id FROM scenes WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  const { name, triggerType, triggerConfig, actions, enabled } = req.body;
  db.prepare(`UPDATE scenes SET
    name           = COALESCE(?, name),
    trigger_type   = COALESCE(?, trigger_type),
    trigger_config = COALESCE(?, trigger_config),
    actions        = COALESCE(?, actions),
    enabled        = COALESCE(?, enabled)
    WHERE id = ?`)
    .run(
      name         ?? null,
      triggerType  ?? null,
      triggerConfig !== undefined ? JSON.stringify(triggerConfig) : null,
      actions       !== undefined ? JSON.stringify(actions)       : null,
      enabled       !== undefined ? (enabled ? 1 : 0)            : null,
      scene.id
    );
  res.json({ success: true });
});

app.delete('/api/scenes/:id', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const scene = db.prepare('SELECT id, name FROM scenes WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  db.prepare('DELETE FROM scenes WHERE id=?').run(scene.id);
  res.json({ success: true });
});

// Bulk delete — deletes all provided IDs in one transaction
app.delete('/api/scenes', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'ids array required' });
  const del = db.prepare('DELETE FROM scenes WHERE id=? AND hotel_id=?');
  const run = db.transaction(() => ids.forEach(id => del.run(id, hotelId)));
  run();
  res.json({ success: true, deleted: ids.length });
});

// Manual run — respond immediately, execute async
app.post('/api/scenes/:id/run', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const row = db.prepare('SELECT * FROM scenes WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!row) return res.status(404).json({ error: 'Scene not found' });
  res.json({ success: true });
  const scene = { ...row, actions: JSON.parse(row.actions) };
  executeScene(hotelId, scene, `manual:${req.user.username}`).catch(() => {});
});

// Push all scenes for a room to the gateway device as a shared attribute.
// The ESP32 firmware can read 'ihotel_offline_scenes' and execute them locally when offline.
app.post('/api/scenes/:id/push', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const hotelId = req.user.hotelId;
  const row = db.prepare('SELECT * FROM scenes WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!row) return res.status(404).json({ error: 'Scene not found' });

  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId = deviceRoomMap[row.room_number];
  if (!devId) return res.status(404).json({ error: `No device mapped to room ${row.room_number}` });

  // Collect ALL scenes for this room (not just this one) so the gateway has a complete picture
  const allRows = db.prepare('SELECT * FROM scenes WHERE hotel_id=? AND room_number=?').all(hotelId, row.room_number);
  const payload = allRows.map(s => ({
    id:             s.id,
    name:           s.name,
    trigger_type:   s.trigger_type,
    trigger_config: JSON.parse(s.trigger_config),
    actions:        JSON.parse(s.actions),
    enabled:        !!s.enabled
  }));

  try {
    const adapter = getHotelAdapter(hotelId);
    await adapter.sendAttributes(devId, { ihotel_offline_scenes: JSON.stringify(payload) });
    res.json({ success: true, scenes: payload.length });
  } catch (e) {
    console.error('[scene push]', e.message);
    res.status(502).json({ error: `Gateway push failed: ${e.message}` });
  }
});

// ═══ CATCH-ALL for SPA (only when client/dist is present locally) ═══
app.get('*', (req, res) => {
  const indexPath = path.join(clientBuild, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// ═══ CHANNEL MANAGER ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════

// ── iCal feed — public, secured by per-channel token in URL ──────────
// GET /api/channel/ical/:hotelId/:token.ics
app.get('/api/channel/ical/:hotelId/:tokenFile', (req, res) => {
  const { hotelId, tokenFile } = req.params;
  // strip ".ics" extension if present
  const token = tokenFile.endsWith('.ics') ? tokenFile.slice(0, -4) : tokenFile;

  const channel = db.prepare(
    `SELECT id FROM channel_connections WHERE hotel_id=? AND ical_token=? AND active=1`
  ).get(hotelId, token);
  if (!channel) return res.status(404).send('Not found');

  const hotel = db.prepare('SELECT name FROM hotels WHERE id=?').get(hotelId);
  if (!hotel) return res.status(404).send('Not found');

  // Fetch all active + future reservations for the hotel
  const today = new Date().toISOString().slice(0, 10);
  const reservations = db.prepare(
    `SELECT id, room, guest_name, check_in, check_out
     FROM reservations WHERE hotel_id=? AND active=1 AND check_out >= ?`
  ).all(hotelId, today);

  // Build RFC-5545 iCal
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//iHotel//Channel Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${hotel.name} - Availability`,
    'X-WR-TIMEZONE:UTC',
  ];
  for (const r of reservations) {
    const dtStart = r.check_in.replace(/-/g, '');
    const dtEnd   = r.check_out.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${r.id}@ihotel`);
    lines.push(`DTSTAMP:${now}Z`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:Blocked - Room ${r.room}`);
    lines.push(`STATUS:CONFIRMED`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  // Update last_sync_at
  db.prepare('UPDATE channel_connections SET last_sync_at=? WHERE id=?')
    .run(Math.floor(Date.now() / 1000), channel.id);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${hotel.name}-availability.ics"`);
  res.send(lines.join('\r\n'));
});

// ── Webhook receiver — OTA pushes new booking to us ──────────────────
// POST /api/channel/webhook/:channelId
app.post('/api/channel/webhook/:channelId', express.json(), (req, res) => {
  const channelId = parseInt(req.params.channelId);
  if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel' });

  const channel = db.prepare(
    'SELECT * FROM channel_connections WHERE id=? AND active=1'
  ).get(channelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  // HMAC-SHA256 signature verification (optional — skip if no secret configured)
  if (channel.webhook_secret) {
    const sig = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'] || '';
    const body = JSON.stringify(req.body);
    const expected = 'sha256=' + crypto.createHmac('sha256', channel.webhook_secret).update(body).digest('hex');
    if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
  }

  const { reservation_id, check_in, checkIn, check_out, checkOut,
          room_type, roomType, guest_name, guestName,
          guest_email, guestEmail, total_amount, totalAmount } = req.body;

  // Normalize field names (different OTAs use different naming)
  const ci = check_in || checkIn;
  const co = check_out || checkOut;
  const rt = room_type || roomType;
  const gn = guest_name || guestName || 'OTA Guest';
  const ge = guest_email || guestEmail || '';
  const ta = total_amount || totalAmount || null;

  if (!ci || !co || !rt) {
    return res.status(400).json({ error: 'check_in, check_out, room_type required' });
  }

  // Validate dates
  const ciDate = new Date(ci);
  const coDate = new Date(co);
  if (isNaN(ciDate) || isNaN(coDate) || coDate <= ciDate) {
    return res.status(400).json({ error: 'Invalid dates' });
  }

  // Find an available room of the requested type — lowest floor first
  const allRooms = db.prepare(
    'SELECT room_number, floor FROM hotel_rooms WHERE hotel_id=? AND room_type=? ORDER BY floor ASC, CAST(room_number AS INTEGER) ASC'
  ).all(channel.hotel_id, rt);
  if (!allRooms.length) return res.status(409).json({ error: `No rooms of type ${rt}` });

  const occupied = db.prepare(
    'SELECT DISTINCT room FROM reservations WHERE hotel_id=? AND active=1 AND check_in < ? AND check_out > ?'
  ).all(channel.hotel_id, co, ci).map(r => String(r.room));
  const occupiedSet = new Set(occupied);

  const availableRoom = allRooms.find(r => !occupiedSet.has(String(r.room_number)));
  if (!availableRoom) return res.status(409).json({ error: 'No rooms available for the selected dates' });

  const room = availableRoom.room_number;

  // Double-check
  const doubleCheck = db.prepare(
    'SELECT id FROM reservations WHERE hotel_id=? AND room=? AND active=1 AND check_in < ? AND check_out > ?'
  ).get(channel.hotel_id, String(room), co, ci);
  if (doubleCheck) return res.status(409).json({ error: 'No rooms available for the selected dates' });

  // Rate
  const rateRow = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(channel.hotel_id, rt);
  const ratePerNight = rateRow ? rateRow.rate_per_night : null;
  const nights = Math.max(1, Math.round((coDate - ciDate) / 86400000));
  const totalAmt = ta || (ratePerNight ? nights * ratePerNight : null);

  // Create reservation
  const id = crypto.randomUUID();
  const plainPassword = crypto.randomInt(100000, 999999).toString();
  const hashedPassword = bcrypt.hashSync(plainPassword, 10);
  const token = crypto.randomBytes(16).toString('hex');

  db.prepare(`INSERT INTO reservations
    (id,hotel_id,room,guest_name,check_in,check_out,password,password_hash,token,
     created_by,payment_method,thirdparty_channel,rate_per_night)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, channel.hotel_id, String(room), gn, ci, co, plainPassword, hashedPassword, token,
      'channel-manager', 'thirdparty', channel.name, ratePerNight);

  // Income log
  if (ratePerNight) {
    try {
      db.prepare(`INSERT INTO income_log
        (id,hotel_id,reservation_id,room,guest_name,check_in,check_out,nights,room_type,
         rate_per_night,total_amount,payment_method,thirdparty_channel,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), channel.hotel_id, id, String(room), gn, ci, co,
          nights, rt, ratePerNight, totalAmt, 'thirdparty', channel.name, 'channel-manager');
    } catch (e) { console.error('Income log from webhook failed:', e.message); }
  }

  // Update last_sync_at on channel
  db.prepare('UPDATE channel_connections SET last_sync_at=? WHERE id=?')
    .run(Math.floor(Date.now() / 1000), channel.id);

  addLog(channel.hotel_id, 'pms',
    `Channel booking [${channel.name}]: Rm${room} ${gn} (${nights}n)`,
    { room, user: 'channel-manager' }
  );

  // Notify staff via SSE
  sseBroadcastRoles(channel.hotel_id, 'channel_booking', {
    channel: channel.name, room, guestName: gn, checkIn: ci, checkOut: co
  }, ['owner', 'admin', 'frontdesk']);

  res.json({ success: true, reservationId: id, room, guestName: gn, checkIn: ci, checkOut: co });
});

// ── Channel CRUD — owner/admin only ──────────────────────────────────

// GET /api/channel/connections — list all channels for the hotel
app.get('/api/channel/connections', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;
  const channels = db.prepare(
    'SELECT * FROM channel_connections WHERE hotel_id=? ORDER BY created_at ASC'
  ).all(hotelId);
  res.json(channels);
});

// POST /api/channel/connections — create a new channel
app.post('/api/channel/connections', authenticate, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const hotelId = req.user.hotelId;
  const { name, type = 'ical', webhook_secret, api_key, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Channel name required' });

  const ical_token = crypto.randomUUID().replace(/-/g, '');
  const result = db.prepare(
    `INSERT INTO channel_connections (hotel_id, name, type, webhook_secret, api_key, ical_token, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(hotelId, name.trim(), type, webhook_secret || null, api_key || null, ical_token, notes || null);

  const created = db.prepare('SELECT * FROM channel_connections WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PATCH /api/channel/connections/:id — update a channel
app.patch('/api/channel/connections/:id', authenticate, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const hotelId = req.user.hotelId;
  const id = parseInt(req.params.id);
  const channel = db.prepare('SELECT * FROM channel_connections WHERE id=? AND hotel_id=?').get(id, hotelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const { name, type, webhook_secret, api_key, active, notes } = req.body;
  const updated = {
    name: name !== undefined ? String(name).trim() : channel.name,
    type: type !== undefined ? type : channel.type,
    webhook_secret: webhook_secret !== undefined ? (webhook_secret || null) : channel.webhook_secret,
    api_key: api_key !== undefined ? (api_key || null) : channel.api_key,
    active: active !== undefined ? (active ? 1 : 0) : channel.active,
    notes: notes !== undefined ? (notes || null) : channel.notes,
  };

  db.prepare(
    `UPDATE channel_connections SET name=?, type=?, webhook_secret=?, api_key=?, active=?, notes=? WHERE id=?`
  ).run(updated.name, updated.type, updated.webhook_secret, updated.api_key, updated.active, updated.notes, id);

  const row = db.prepare('SELECT * FROM channel_connections WHERE id=?').get(id);
  res.json(row);
});

// DELETE /api/channel/connections/:id
app.delete('/api/channel/connections/:id', authenticate, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const hotelId = req.user.hotelId;
  const id = parseInt(req.params.id);
  const channel = db.prepare('SELECT id FROM channel_connections WHERE id=? AND hotel_id=?').get(id, hotelId);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  db.prepare('DELETE FROM channel_connections WHERE id=?').run(id);
  res.json({ success: true });
});

// ═══ WEBSOCKET (TB proxy — per hotel) ═══
const wss = new WebSocket.Server({ server, path: '/ws/telemetry' });
wss.on('connection', async (cws, req) => {
  try {
    // Extract JWT from query param to get hotelId
    const url   = new URL(req.url, 'ws://localhost');
    const token = url.searchParams.get('token');
    if (!token) { cws.close(1008, 'Token required'); return; }

    const jwtLib  = require('jsonwebtoken');
    const decoded = jwtLib.verify(token, JWT_SECRET);
    const hotelId = decoded.hotelId;
    if (!hotelId) { cws.close(1008, 'Invalid token'); return; }

    const adapter = getHotelAdapter(hotelId);
    await adapter.authenticate();
    const wsUrl = adapter.getWsUrl();
    if (!wsUrl) { cws.close(1008, 'Platform does not support WebSocket proxy'); return; }
    const tws = new WebSocket(wsUrl);
    tws.on('message', d => { if (cws.readyState === 1) cws.send(d.toString()); });
    cws.on('message', d => { if (tws.readyState === 1) tws.send(d.toString()); });
    tws.on('close', () => cws.close());
    cws.on('close', () => tws.close());
    tws.on('error', e => { console.error('Platform WS error:', e.message); cws.close(); });
    cws.on('error', () => tws.close());
  } catch (e) {
    console.error('WS setup error:', e.message);
    cws.close(1011, 'Internal error');
  }
});

// ═══ START ═══
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`✓ iHotel server running on port ${PORT}`);
  });
}

module.exports = { app, server, db };
