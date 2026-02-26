/**
 * ╔═════════════════════════════════════════════════════════════╗
 * ║  Hilton Grand Hotel IoT Platform — Server v2.0             ║
 * ║  Production-grade: JWT Auth · SQLite · Helmet · Rate Limit ║
 * ╚═════════════════════════════════════════════════════════════╝
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const { initDB } = require('./db');
const { ThingsBoardClient } = require('./thingsboard');
const { authenticate, requireRole, generateAccessToken, generateRefreshToken, JWT_SECRET } = require('./auth');

// ═══ CONFIG ═══
const PORT = process.env.PORT || 3000;
const TB_HOST = process.env.TB_HOST || 'http://localhost:8080';
const TB_USER = process.env.TB_USER || 'admin@hiltongrand.com';
const TB_PASS = process.env.TB_PASS || 'hilton';

// ═══ INIT ═══
const db = initDB();
const tb = new ThingsBoardClient(TB_HOST, TB_USER, TB_PASS);

// ═══ CONSTANTS ═══
const ROOM_TYPES = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];
const ROOM_STATUS = ['VACANT', 'OCCUPIED', 'MUR', 'MAINTENANCE'];
const AC_MODES = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS = ['LOW', 'MED', 'HIGH', 'AUTO'];
const DEVICE_STATUSES = ['normal', 'boot', 'fault'];
const RACK_RATES = { STANDARD: 600, DELUXE: 950, SUITE: 1500, VIP: 2500 };
const FLOOR_TYPE = { 1:1, 2:0, 3:0, 4:1, 5:2, 6:0, 7:1, 8:0, 9:2, 10:0, 11:1, 12:0, 13:2, 14:3, 15:3 };

const TELEMETRY_KEYS = [
  'roomStatus','pirMotionStatus','doorStatus','doorLockBattery','doorContactsBattery',
  'co2','temperature','humidity','airQualityBattery','elecConsumption','waterConsumption',
  'waterMeterBattery','line1','line2','line3','dimmer1','dimmer2','acTemperatureSet',
  'acMode','fanSpeed','curtainsPosition','blindsPosition','dndService','murService',
  'sosService','lastCleanedTime','lastTelemetryTime','firmwareVersion','gatewayVersion','deviceStatus',
  'pdMode'
];
const RELAY_KEYS = ['relay1','relay2','relay3','relay4','relay5','relay6','relay7','relay8','doorUnlock','defaultUnlockDuration'];
const WATCHABLE_KEYS = ['roomStatus','pirMotionStatus','doorStatus','line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','dndService','murService','sosService','deviceStatus','pdMode'];

// ═══ EXPRESS APP ═══
const app = express();

// Security headers
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// Rate limit on auth routes
const authLimiter = rateLimit({
  windowMs: (parseInt(process.env.LOGIN_RATE_WINDOW_MIN) || 15) * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT) || 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true, legacyHeaders: false
});

const guestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,   // 5 minutes
  max: 20,                     // 20 attempts per 5 min (guests may typo)
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  standardHeaders: true, legacyHeaders: false
});
// Serve built React frontend in production
const clientBuild = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuild));

const server = http.createServer(app);

// ═══ SSE ═══
const sseClients = new Map(); // Map<res, {userId, role}>
function sseConnect(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':\n\n');
  sseClients.set(res, { userId: req.user?.id, role: req.user?.role });
  req.on('close', () => sseClients.delete(res));
}
function sseBroadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c] of sseClients) { try { c.write(msg); } catch {} }
}

// ═══ AUDIT LOG ═══
function addLog(category, message, details = {}) {
  const ts = Date.now();
  const entry = { ts, cat: category, msg: message, ...details };
  try {
    db.prepare('INSERT INTO audit_log (ts, category, message, room, source, user, details) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ts, category, message, details.room || null, details.source || null, details.user || null, JSON.stringify(details));
  } catch (e) { console.error('Log DB error:', e.message); }
  sseBroadcast('log', entry);
}

// ═══ AUTH ROUTES ═══
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    addLog('auth', 'Login failed', { source: username });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store refresh token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, refreshToken, expiresAt);
  db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').run(user.id);

  addLog('auth', 'Login successful', { user: username });
  res.json({
    accessToken, refreshToken,
    user: { id: user.id, username: user.username, role: user.role, fullName: user.full_name }
  });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const stored = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime(\'now\')').get(refreshToken);
    if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newAccess = generateAccessToken(user);
    res.json({ accessToken: newAccess });
  } catch { res.status(401).json({ error: 'Invalid refresh token' }); }
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
  addLog('auth', 'Logout', { user: req.user.username });
  res.json({ success: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, username, role, full_name, last_login FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name, lastLogin: user.last_login });
});

// ═══ SSE (authenticated via query token or header) ═══
app.get('/api/events', (req, res, next) => {
  // EventSource can't send headers, so accept token as query param
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  authenticate(req, res, next);
}, sseConnect);

// ═══ TELEMETRY HELPERS ═══
function parseTelemetry(raw) {
  const r = {};
  if (!raw) return r;
  for (const [key, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    let val = arr[0].value !== undefined ? arr[0].value : arr[0];
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (!isNaN(val) && val !== '' && val !== null) val = parseFloat(val);
    r[key] = val;
  }
  return r;
}

function extractRoom(name) {
  const m = name.match(/gateway-room-(\d+)/);
  return m ? m[1] : null;
}

// ═══ CHANGE DETECTION ═══
const lastKnownTelemetry = {};
// In-memory cache for immediate PD-mode blocking on guest RPC — synced from telemetry
const roomPDState = {};
function detectAndLogChanges(roomNum, t) {
  const prev = lastKnownTelemetry[roomNum];
  if (!prev) { lastKnownTelemetry[roomNum] = { ...t }; return; }
  for (const key of WATCHABLE_KEYS) {
    if (!(key in t) || prev[key] === t[key]) continue;
    const to = t[key];
    let msg, cat = 'telemetry';
    if (key === 'roomStatus') { msg = `Room status → ${ROOM_STATUS[to] ?? to}`; cat = 'system'; }
    else if (key === 'pirMotionStatus') { msg = to ? 'Motion detected' : 'No motion'; cat = 'sensor'; }
    else if (key === 'doorStatus') {
      msg = to ? 'Door OPENED' : 'Door CLOSED'; cat = 'sensor';
      // Auto-occupy: door just opened and room is currently VACANT → set to OCCUPIED
      if (to === true && (t.roomStatus ?? prev.roomStatus ?? 0) === 0) {
        const devId = deviceRoomMap[roomNum];
        if (devId) setImmediate(() => sendControl(devId, 'setRoomStatus', { roomStatus: 1 }, 'auto').catch(() => {}));
      }
    }
    else if (key === 'dndService') { msg = to ? 'DND activated' : 'DND cleared'; cat = 'service'; }
    else if (key === 'murService') {
      msg = to ? 'Housekeeping requested' : 'MUR cleared'; cat = 'service';
      if (to) sseBroadcast('alert', { type: 'MUR', room: roomNum, message: `Room ${roomNum}: Housekeeping`, ts: Date.now() });
    } else if (key === 'sosService') {
      msg = to ? 'SOS EMERGENCY' : 'SOS cleared'; cat = 'service';
      if (to) sseBroadcast('alert', { type: 'SOS', room: roomNum, message: `EMERGENCY Room ${roomNum}`, ts: Date.now() });
    } else if (key === 'pdMode') {
      roomPDState[roomNum] = !!to;
      msg = to ? 'Power Down mode activated' : 'Power Down mode cleared'; cat = 'system';
    } else if (key === 'acMode') { msg = `AC → ${AC_MODES[to] || to}`; }
    else if (key === 'fanSpeed') { msg = `Fan → ${FAN_SPEEDS[to] || to}`; }
    else { msg = `${key} → ${to}`; }
    addLog(cat, msg, { room: roomNum, source: 'gateway' });
  }
  lastKnownTelemetry[roomNum] = { ...prev, ...t };
}

// ═══ CONTROL LOGIC ═══
function controlToTelemetry(method, params) {
  const data = {};
  if (method === 'setLines') {
    if ('line1' in params) data.line1 = !!params.line1;
    if ('line2' in params) data.line2 = !!params.line2;
    if ('line3' in params) data.line3 = !!params.line3;
    if ('dimmer1' in params) data.dimmer1 = Math.max(0, Math.min(100, parseFloat(params.dimmer1)));
    if ('dimmer2' in params) data.dimmer2 = Math.max(0, Math.min(100, parseFloat(params.dimmer2)));
  } else if (method === 'setAC') {
    if ('acMode' in params) data.acMode = parseInt(params.acMode);
    if ('acTemperatureSet' in params) data.acTemperatureSet = parseFloat(params.acTemperatureSet);
    if ('fanSpeed' in params) data.fanSpeed = parseInt(params.fanSpeed);
  } else if (method === 'setDoorUnlock') {
    data.doorUnlock = true;
  } else if (method === 'setDoorLock') {
    data.doorUnlock = false;
  } else if (method === 'setCurtainsBlinds') {
    if ('curtainsPosition' in params) data.curtainsPosition = Math.max(0, Math.min(100, parseFloat(params.curtainsPosition)));
    if ('blindsPosition' in params) data.blindsPosition = Math.max(0, Math.min(100, parseFloat(params.blindsPosition)));
  } else if (method === 'setService') {
    if ('dndService' in params) data.dndService = !!params.dndService;
    if ('murService' in params) data.murService = !!params.murService;
    if ('sosService' in params) data.sosService = !!params.sosService;
  } else if (method === 'resetServices') {
    (params.services || []).forEach(s => { data[s] = false; });
  } else if (method === 'setPowerDown') {
    data.line1 = false; data.line2 = false; data.line3 = false;
    data.dimmer1 = 0; data.dimmer2 = 0; data.acMode = 0; data.fanSpeed = 0;
    data.curtainsPosition = 0; data.blindsPosition = 0;
    data.dndService = false; data.murService = false; data.sosService = false;
  } else if (method === 'setRoomStatus') {
    if ('roomStatus' in params) data.roomStatus = parseInt(params.roomStatus);
    if (data.roomStatus === 0) data.lastCleanedTime = String(Date.now());
  } else if (method === 'setPDMode') {
    data.pdMode = !!params.pdMode;
    // Activating PD cuts all power immediately
    if (data.pdMode) {
      data.line1 = false; data.line2 = false; data.line3 = false;
      data.dimmer1 = 0; data.dimmer2 = 0; data.acMode = 0; data.fanSpeed = 0;
      data.curtainsPosition = 0; data.blindsPosition = 0;
    }
  }
  return data;
}

function controlToRelayAttributes(telemetry) {
  const a = {};
  if ('line1' in telemetry) a.relay1 = !!telemetry.line1;
  if ('line2' in telemetry) a.relay2 = !!telemetry.line2;
  if ('line3' in telemetry) a.relay3 = !!telemetry.line3;
  if ('acMode' in telemetry) {
    const m = telemetry.acMode;
    if (m === 0) { a.relay4 = false; a.relay5 = false; a.relay6 = false; a.relay7 = false; }
    else if (m === 1) a.relay4 = true;
    else if (m === 2) a.relay4 = false;
    else if (m === 3) a.relay4 = false;
    else if (m === 4) a.relay4 = (telemetry.acTemperatureSet || 22) <= 25;
  }
  if ('fanSpeed' in telemetry) {
    const f = telemetry.fanSpeed;
    a.relay5 = f === 2; a.relay6 = f === 1; a.relay7 = f === 0;
    if (f === 3) { a.relay5 = false; a.relay6 = true; a.relay7 = false; }
  }
  if ('doorUnlock' in telemetry) a.relay8 = !!telemetry.doorUnlock;
  return a;
}

let deviceRoomMap = {};

async function sendControl(deviceId, method, params, username = 'system') {
  const telemetry = controlToTelemetry(method, params);
  if (!Object.keys(telemetry).length) throw new Error('Unknown method: ' + method);
  await tb.saveTelemetry(deviceId, telemetry);

  const relayAttrs = controlToRelayAttributes(telemetry);
  const sharedAttrs = { ...relayAttrs };
  const FORWARD = ['line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','dndService','murService','sosService','roomStatus','doorUnlock'];
  for (const k of FORWARD) { if (k in telemetry) sharedAttrs[k] = telemetry[k]; }

  if (Object.keys(sharedAttrs).length) {
    try { await tb.saveAttributes(deviceId, sharedAttrs); } catch (e) { console.error('Attr write failed:', e.message); }
  }

  const roomNum = Object.keys(deviceRoomMap).find(k => deviceRoomMap[k] === deviceId) || '?';
  // Immediately sync PD state so guest RPC is blocked without waiting for the next poll
  if ('pdMode' in telemetry) roomPDState[roomNum] = !!telemetry.pdMode;
  addLog('control', method, { room: roomNum, source: 'dashboard', user: username, params: JSON.stringify(telemetry) });

  if (telemetry.murService) sseBroadcast('alert', { type: 'MUR', room: roomNum, message: `Room ${roomNum}: Housekeeping`, ts: Date.now() });
  if (telemetry.sosService) sseBroadcast('alert', { type: 'SOS', room: roomNum, message: `EMERGENCY Room ${roomNum}`, ts: Date.now() });

  sseBroadcast('telemetry', { room: roomNum, deviceId, data: { ...telemetry, ...sharedAttrs } });
  return { success: true, written: telemetry };
}

// ═══ PROTECTED API ROUTES ═══

// Room control (owner, admin)
app.post('/api/devices/:id/rpc', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { method, params } = req.body;
    res.json(await sendControl(req.params.id, method, params || {}, req.user.username));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Hotel overview
let lastOverviewRooms = {};
app.get('/api/hotel/overview', authenticate, async (req, res) => {
  try {
    const devices = await tb.getDevices();
    if (!devices.length) return res.json({ rooms: {}, deviceCount: 0 });

    const deviceIds = devices.map(d => d.id.id);
    const allT = await tb.getAllTelemetry(deviceIds, TELEMETRY_KEYS);
    const allRelays = {};
    for (let i = 0; i < devices.length; i += 20) {
      const batch = devices.slice(i, i + 20);
      await Promise.all(batch.map(async d => {
        try {
          const attrs = await tb.getSharedAttributes(d.id.id, RELAY_KEYS);
          const parsed = {};
          if (Array.isArray(attrs)) attrs.forEach(a => { parsed[a.key] = a.value; });
          allRelays[d.id.id] = parsed;
        } catch { allRelays[d.id.id] = {}; }
      }));
    }

    const rooms = {};
    devices.forEach(d => {
      const rn = extractRoom(d.name);
      if (!rn) return;
      deviceRoomMap[rn] = d.id.id;
      const floor = parseInt(rn.length <= 3 ? rn[0] : rn.slice(0, -2));
      const t = parseTelemetry(allT[d.id.id]);
      const relays = allRelays[d.id.id] || {};
      const ar = db.prepare('SELECT * FROM reservations WHERE room = ? AND active = 1 AND check_in <= date(\'now\') AND check_out >= date(\'now\')').get(rn);
      detectAndLogChanges(rn, t);
      rooms[rn] = {
        room: rn, floor, type: ROOM_TYPES[FLOOR_TYPE[floor] ?? 0],
        typeId: FLOOR_TYPE[floor] ?? 0, deviceId: d.id.id, deviceName: d.name,
        online: Object.keys(t).length > 0,
        temperature: t.temperature ?? null, humidity: t.humidity ?? null, co2: t.co2 ?? null,
        pirMotionStatus: t.pirMotionStatus ?? false, doorStatus: t.doorStatus ?? false,
        doorLockBattery: t.doorLockBattery ?? null, doorContactsBattery: t.doorContactsBattery ?? null,
        airQualityBattery: t.airQualityBattery ?? null,
        elecConsumption: t.elecConsumption ?? 0, waterConsumption: t.waterConsumption ?? 0,
        waterMeterBattery: t.waterMeterBattery ?? null,
        line1: t.line1 ?? false, line2: t.line2 ?? false, line3: t.line3 ?? false,
        dimmer1: t.dimmer1 ?? 0, dimmer2: t.dimmer2 ?? 0,
        acTemperatureSet: t.acTemperatureSet ?? 22, acMode: t.acMode ?? 0, fanSpeed: t.fanSpeed ?? 3,
        curtainsPosition: t.curtainsPosition ?? 0, blindsPosition: t.blindsPosition ?? 0,
        dndService: t.dndService ?? false, murService: t.murService ?? false, sosService: t.sosService ?? false,
        roomStatus: t.roomStatus ?? 0,
        lastCleanedTime: t.lastCleanedTime ?? null, firmwareVersion: t.firmwareVersion ?? null,
        gatewayVersion: t.gatewayVersion ?? null, deviceStatus: t.deviceStatus ?? 0,
        pdMode: t.pdMode ?? false,
        relay1: relays.relay1 ?? false, relay2: relays.relay2 ?? false,
        relay3: relays.relay3 ?? false, relay4: relays.relay4 ?? false,
        relay5: relays.relay5 ?? false, relay6: relays.relay6 ?? false,
        relay7: relays.relay7 ?? false, relay8: relays.relay8 ?? false,
        doorUnlock: relays.doorUnlock ?? false,
        reservation: ar ? { id: ar.id, guestName: ar.guest_name, checkIn: ar.check_in, checkOut: ar.check_out } : null
      };
    });
    lastOverviewRooms = rooms;
    sseBroadcast('snapshot', { rooms, deviceCount: devices.length, timestamp: Date.now() });
    res.json({ rooms, deviceCount: devices.length, timestamp: Date.now() });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Logs
app.get('/api/logs', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const logs = db.prepare('SELECT ts, category as cat, message as msg, room, source FROM audit_log WHERE ts > ? ORDER BY ts DESC LIMIT 200').all(since);
  res.json(logs);
});

app.get('/api/logs/export', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const logs = db.prepare('SELECT ts, category, message, room, source, user FROM audit_log ORDER BY ts DESC').all();
  const header = 'Timestamp,Date,Category,Message,Room,Source,User';
  const rows = logs.map(l => [
    l.ts,
    new Date(l.ts).toISOString(),
    l.category || '',
    `"${(l.message || '').replace(/"/g, '""')}"`,
    l.room || '',
    l.source || '',
    l.user || ''
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="hotel-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header, ...rows].join('\n'));
});

app.delete('/api/logs', authenticate, requireRole('owner', 'admin'), (req, res) => {
  db.prepare('DELETE FROM audit_log').run();
  addLog('system', 'Audit log cleared', { user: req.user.username });
  res.json({ success: true });
});

// ═══ PMS ROUTES ═══
app.get('/api/pms/reservations', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM reservations ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows.map(r => ({
    id: r.id, room: r.room, guestName: r.guest_name,
    checkIn: r.check_in, checkOut: r.check_out,
    password: r.password, active: !!r.active, token: r.token
  })));
});

app.post('/api/pms/reservations', authenticate, requireRole('owner', 'admin', 'user'), (req, res) => {
  const { room, guestName, checkIn, checkOut } = req.body;
  if (!room || !guestName || !checkIn || !checkOut) return res.status(400).json({ error: 'All fields required' });

  const id = crypto.randomUUID();
  const password = crypto.randomInt(100000, 999999).toString();
  const token = crypto.randomBytes(16).toString('hex');

  db.prepare('INSERT INTO reservations (id, room, guest_name, check_in, check_out, password, token, created_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, room, guestName, checkIn, checkOut, password, token, req.user.username);

  addLog('pms', `Reservation created Rm${room}`, { room, user: req.user.username });
  // Use a stable room-based guest URL (fixed QR per room). Credentials change per reservation.
  const guestUrl = `${req.protocol}://${req.get('host')}/guest?room=${encodeURIComponent(room)}`;
  res.json({ reservation: { id, room, guestName, checkIn, checkOut, active: true, token }, password, guestUrl });
});

app.get('/api/pms/export', authenticate, requireRole('owner', 'admin', 'user'), (req, res) => {
  const rows = db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all();
  const header = 'ID,Room,Guest Name,Check In,Check Out,Active,Created By,Created At';
  const csv = rows.map(r => [
    r.id, r.room,
    `"${(r.guest_name || '').replace(/"/g, '""')}"`,
    r.check_in, r.check_out,
    r.active ? 'yes' : 'no',
    r.created_by || '', r.created_at || ''
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="hotel-pms-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header, ...csv].join('\n'));
});

app.delete('/api/pms/history', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const result = db.prepare('DELETE FROM reservations WHERE active = 0').run();
  addLog('pms', `PMS history cleared (${result.changes} records)`, { user: req.user.username });
  res.json({ success: true, deleted: result.changes });
});

app.delete('/api/pms/reservations/:id', authenticate, (req, res) => {
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  db.prepare('UPDATE reservations SET active = 0 WHERE id = ?').run(req.params.id);
  addLog('pms', 'Reservation cancelled', { room: existing?.room, user: req.user.username });
  // Immediately notify any connected guest for this room so their portal locks out without
  // waiting for the next poll cycle.
  if (existing?.room) sseBroadcast('lockout', { room: existing.room });
  res.json({ success: true });
});

// Force-lockdown a room: cancel ALL active reservations regardless of date, broadcast lockout SSE.
// This is what PD (Power Down) uses so overstaying guests are correctly evicted.
app.post('/api/rooms/:room/lockdown', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const { room } = req.params;
  db.prepare('UPDATE reservations SET active = 0 WHERE room = ? AND active = 1').run(room);
  addLog('system', `Room ${room} forced lockdown`, { room, user: req.user.username });
  sseBroadcast('lockout', { room });
  res.json({ success: true });
});

// Checkout: cancel reservations, set room to MUR, broadcast lockout
app.post('/api/rooms/:room/checkout', authenticate, requireRole('owner', 'admin', 'user'), async (req, res) => {
  const { room } = req.params;
  db.prepare('UPDATE reservations SET active = 0 WHERE room = ? AND active = 1').run(room);
  const devId = deviceRoomMap[room];
  if (devId) {
    try { await sendControl(devId, 'setRoomStatus', { roomStatus: 2 }, req.user.username); } catch {}
  }
  sseBroadcast('lockout', { room });
  addLog('pms', `Room ${room} checked out → MUR`, { room, user: req.user.username });
  res.json({ success: true });
});

app.get('/api/pms/reservations/:id/link', authenticate, (req, res) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  // Provide room-based stable URL for QR codes
  res.json({ url: `${req.protocol}://${req.get('host')}/guest?room=${encodeURIComponent(r.room)}`, password: r.password });
});

// ═══ GUEST API ═══
app.post('/api/guest/login', guestLimiter, (req, res) => {
  // Accept either a reservation token OR a room param (stable QR). Room-based login will find
  // the active reservation for that room covering today's date. For quick testing, a static
  // test password can be used to allow access to any room: set GUEST_TEST_PASSWORD env var
  // (default: '000000').
  const { token, room, lastName, password } = req.body;
  if ((!token && !room) || !password) {
    return res.status(400).json({ error: 'Name and password required' });
  }

  const providedPassword = String(password || '').trim();
  const TEST_PW = process.env.GUEST_TEST_PASSWORD || '000000';

  let r = null;
  if (token) {
    r = db.prepare('SELECT * FROM reservations WHERE token = ? AND active = 1').get(token);
  } else if (room) {
    // find active reservation for this room where today's date falls between check_in and check_out
    const today = new Date().toISOString().split('T')[0];
    r = db.prepare('SELECT * FROM reservations WHERE room = ? AND active = 1 AND check_in <= ? AND check_out >= ?').get(room, today, today);
  }

  // Static test override: allow room-based login with TEST_PW regardless of reservation
  if (room && providedPassword === TEST_PW) {
    const guestToken = generateAccessToken({ id: 0, username: `guest:test`, role: 'guest', room });
    addLog('auth', 'Guest test login', { source: `guest:test`, room });
    return res.json({ accessToken: guestToken, room, guestName: lastName || `TestGuest` });
  }

  if (!r) return res.status(401).json({ error: 'Invalid or expired link' });

  const now = new Date().toISOString().split('T')[0];
  if (now < r.check_in || now > r.check_out) {
    return res.status(401).json({ error: 'Outside reservation dates' });
  }

  // ═══ FIX: Accept FULL name, LAST name, or FIRST name (case-insensitive) ═══
  const inputName = (lastName || '').trim().toLowerCase();
  const storedFull = r.guest_name.trim().toLowerCase();
  const storedParts = r.guest_name.trim().split(/\s+/).map(p => p.toLowerCase());

  // Match if: input equals full name, OR any single part of the name
  const nameMatch = (inputName === storedFull) || storedParts.includes(inputName);

  // Normalize password types (DB may return numbers or strings) and trim whitespace
  const storedPassword = String(r.password).trim();

  if (!nameMatch || storedPassword !== providedPassword) {
    addLog('auth', 'Guest login failed', { source: `guest:${lastName}`, room: r.room });
    return res.status(401).json({ error: 'Invalid name or password. Use the name given at check-in.' });
  }

  const guestToken = generateAccessToken({ id: 0, username: `guest:${r.guest_name}`, role: 'guest', room: r.room });
  addLog('auth', 'Guest login', { source: `guest:${r.guest_name}`, room: r.room });
  res.json({ accessToken: guestToken, room: r.room, guestName: r.guest_name });
});

app.get('/api/guest/room', authenticate, (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  // Prefer a room claim in the token (issued at login). Fallback to guest_name lookup.
  const today = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare('SELECT * FROM reservations WHERE room = ? AND active = 1 AND check_in <= ? AND check_out >= ?').get(req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE guest_name = ? AND active = 1').get(name);
  }
  if (!r) {
    return res.status(403).json({
      error: 'session_expired',
      lockout: true,
      title: 'Room Access Suspended',
      message: 'Dear Guest, your room access has been suspended. Please visit the reception desk to renew your stay or arrange checkout. We apologize for any inconvenience and are happy to assist you.'
    });
  }
  const roomData = lastOverviewRooms[r.room];
  res.json({ room: r.room, telemetry: roomData || {} });
});

// Live room data for the guest portal (fetches directly from ThingsBoard if cache is cold)
app.get('/api/guest/room/data', authenticate, async (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  const today = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare('SELECT * FROM reservations WHERE room = ? AND active = 1 AND check_in <= ? AND check_out >= ?').get(req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE guest_name = ? AND active = 1').get(name);
  }
  if (!r) {
    return res.status(403).json({
      error: 'session_expired', lockout: true, title: 'Room Access Suspended',
      message: 'Dear Guest, your room access has been suspended. Please visit the reception desk.'
    });
  }
  const roomNum = r.room;

  // Serve from cache if available (staff dashboard has already fetched it)
  if (lastOverviewRooms[roomNum]) return res.json(lastOverviewRooms[roomNum]);

  // Cold start — fetch live from ThingsBoard for this one room
  try {
    let devId = deviceRoomMap[roomNum];
    if (!devId) {
      const devices = await tb.getDevices();
      const dev = devices.find(d => extractRoom(d.name) === roomNum);
      if (!dev) return res.status(404).json({ error: 'Room device not found in ThingsBoard' });
      devId = dev.id.id;
      deviceRoomMap[roomNum] = devId;
    }
    const rawT = await tb.getAllTelemetry([devId], TELEMETRY_KEYS);
    const t = parseTelemetry(rawT[devId] || {});
    const attrsArr = await tb.getSharedAttributes(devId, RELAY_KEYS);
    const relays = {};
    if (Array.isArray(attrsArr)) attrsArr.forEach(a => { relays[a.key] = a.value; });
    const floor = parseInt(roomNum.length <= 3 ? roomNum[0] : roomNum.slice(0, -2));
    const ar = db.prepare('SELECT * FROM reservations WHERE room = ? AND active = 1 AND check_in <= date(\'now\') AND check_out >= date(\'now\')').get(roomNum);
    const roomData = {
      room: roomNum, floor, type: ROOM_TYPES[FLOOR_TYPE[floor] ?? 0],
      typeId: FLOOR_TYPE[floor] ?? 0, deviceId: devId, deviceName: `gateway-room-${roomNum}`,
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
      reservation: ar ? { id: ar.id, guestName: ar.guest_name, checkIn: ar.check_in, checkOut: ar.check_out } : null
    };
    lastOverviewRooms[roomNum] = roomData;
    res.json(roomData);
  } catch (e) { res.status(502).json({ error: 'Failed to fetch room data: ' + e.message }); }
});

app.post('/api/guest/rpc', authenticate, (req, res) => {
  if (req.user.role !== 'guest') return res.status(403).json({ error: 'Guest access only' });
  // Prefer a room claim in token; otherwise fall back to guest_name
  const today = new Date().toISOString().split('T')[0];
  let r = null;
  if (req.user.room) {
    r = db.prepare('SELECT * FROM reservations WHERE room = ? AND active = 1 AND check_in <= ? AND check_out >= ?').get(req.user.room, today, today);
  } else {
    const name = req.user.username.replace('guest:', '');
    r = db.prepare('SELECT * FROM reservations WHERE guest_name = ? AND active = 1').get(name);
  }
  if (!r) {
    return res.status(403).json({
      error: 'session_expired',
      lockout: true,
      title: 'Room Access Suspended',
      message: 'Dear Guest, your room access has been suspended. Please visit the reception desk to renew your stay or arrange checkout. We apologize for any inconvenience and are happy to assist you.'
    });
  }
  const devId = deviceRoomMap[r.room];
  if (!devId) return res.status(404).json({ error: 'Device not found' });
  // Block all controls when hotel management has enabled Power Down mode
  if (roomPDState[r.room]) {
    return res.status(403).json({
      error: 'room_pd',
      message: 'Room power has been restricted by hotel management. Please contact reception.'
    });
  }
  const { method, params } = req.body;
  const allowed = ['setLines', 'setAC', 'setCurtainsBlinds', 'setService', 'resetServices', 'setDoorUnlock', 'setDoorLock'];
  if (!allowed.includes(method)) return res.status(403).json({ error: 'Not allowed' });
  sendControl(devId, method, params || {}, req.user.username).then(d => res.json(d)).catch(e => res.status(400).json({ error: e.message }));
});


// ═══ USER MANAGEMENT (owner only) ═══
app.get('/api/users', authenticate, requireRole('owner'), (req, res) => {
  res.json(db.prepare('SELECT id, username, role, full_name, active, last_login FROM users').all());
});

app.post('/api/users', authenticate, requireRole('owner'), (req, res) => {
  const { username, password, role, fullName } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Required: username, password, role' });
  if (!['owner', 'admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role, full_name) VALUES (?,?,?,?)').run(username, hash, role, fullName || null);
    addLog('system', `User created: ${username} (${role})`, { user: req.user.username });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══ CATCH-ALL for SPA ═══
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

// ═══ WEBSOCKET ═══
const wss = new WebSocket.Server({ server, path: '/ws/telemetry' });
wss.on('connection', async (cws) => {
  try {
    await tb.ensureAuth();
    const tws = new WebSocket(`${TB_HOST.replace('http', 'ws')}/api/ws/plugins/telemetry?token=${tb.getWsToken()}`);
    tws.on('message', d => { if (cws.readyState === 1) cws.send(d.toString()); });
    cws.on('message', d => { if (tws.readyState === 1) tws.send(d.toString()); });
    cws.on('close', () => tws.close());
    tws.on('close', () => { if (cws.readyState === 1) cws.close(); });
  } catch { cws.close(); }
});

// ═══ BACKGROUND TELEMETRY POLLER ═══
// Runs independently of client requests so simulator / gateway events always appear
// in the audit log and trigger SSE alerts — even when no staff browser is open.
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 15000; // default 15 s

async function pollTelemetry() {
  try {
    const devices = await tb.getDevices();
    if (!devices.length) return;
    const deviceIds = devices.map(d => d.id.id);
    const allT = await tb.getAllTelemetry(deviceIds, WATCHABLE_KEYS);
    devices.forEach(d => {
      const rn = extractRoom(d.name);
      if (!rn) return;
      deviceRoomMap[rn] = d.id.id;
      const t = parseTelemetry(allT[d.id.id] || {});
      detectAndLogChanges(rn, t);
    });
  } catch (e) {
    console.error('Background poll error:', e.message);
  }
}

// ═══ START ═══
server.listen(PORT, () => {
  console.log('═'.repeat(55));
  console.log('  HILTON GRAND HOTEL IoT Platform v2.0');
  console.log('  JWT Auth · SQLite · Helmet · Rate Limit');
  console.log('═'.repeat(55));
  console.log(`  Server:    http://localhost:${PORT}`);
  console.log(`  Frontend:  ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log('═'.repeat(55));
  addLog('system', 'Server started v2.0');
  tb.ensureAuth().then(async () => {
    const devs = await tb.getDevices();
    console.log(`✓ ${devs.length} ThingsBoard devices`);
    // Seed lastKnownTelemetry on boot so the first real poll only logs genuine changes
    setTimeout(pollTelemetry, 2000);
  }).catch(e => console.log('⚠ TB:', e.message));

  setInterval(pollTelemetry, POLL_INTERVAL_MS);
  console.log(`  Telemetry poll: every ${POLL_INTERVAL_MS / 1000}s`);
});
