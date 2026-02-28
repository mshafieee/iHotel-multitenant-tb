/**
 * ╔═════════════════════════════════════════════════════════════╗
 * ║  iHotel SaaS Platform — Server v3.0 (Multi-Tenant + TB)    ║
 * ║  JWT Auth · SQLite · ThingsBoard · SSE · Helmet · Rate Lim ║
 * ╚═════════════════════════════════════════════════════════════╝
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
const { ThingsBoardClientPool }   = require('./thingsboard');
const { authenticate, requireRole, generateAccessToken, generateRefreshToken, JWT_SECRET } = require('./auth');

// ═══ INIT ═══
const db     = initDB();
const tbPool = new ThingsBoardClientPool();

// ═══ PLATFORM ROUTER ═══
const platformModule = require('./platform');
platformModule.init(db, tbPool);

// ═══ CONSTANTS ═══
const PORT          = process.env.PORT || 3000;
const ROOM_TYPES    = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];
const ROOM_STATUS   = ['VACANT', 'OCCUPIED', 'SERVICE', 'MAINTENANCE', 'NOT_OCCUPIED'];
const AC_MODES      = ['OFF', 'COOL', 'HEAT', 'FAN', 'AUTO'];
const FAN_SPEEDS    = ['LOW', 'MED', 'HIGH', 'AUTO'];
const DEVICE_STATUSES = ['normal', 'boot', 'fault'];
const RACK_RATES    = { STANDARD: 600, DELUXE: 950, SUITE: 1500, VIP: 2500 };
const FLOOR_TYPE    = { 1:1, 2:0, 3:0, 4:1, 5:2, 6:0, 7:1, 8:0, 9:2, 10:0, 11:1, 12:0, 13:2, 14:3, 15:3 };

const TELEMETRY_KEYS = [
  'roomStatus','pirMotionStatus','doorStatus','doorLockBattery','doorContactsBattery',
  'co2','temperature','humidity','airQualityBattery','elecConsumption','waterConsumption',
  'waterMeterBattery','line1','line2','line3','dimmer1','dimmer2','acTemperatureSet',
  'acMode','fanSpeed','curtainsPosition','blindsPosition','dndService','murService',
  'sosService','lastCleanedTime','lastTelemetryTime','firmwareVersion','gatewayVersion','deviceStatus',
  'pdMode'
];
const RELAY_KEYS = ['relay1','relay2','relay3','relay4','relay5','relay6','relay7','relay8','doorUnlock','defaultUnlockDuration'];
const SHARED_CONTROL_KEYS = ['line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','roomStatus','dndService','murService','sosService','pdMode'];
const WATCHABLE_KEYS = ['roomStatus','pirMotionStatus','doorStatus','line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','dndService','murService','sosService','deviceStatus','pdMode'];

// ═══ EXPRESS APP ═══
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({
  windowMs: (parseInt(process.env.LOGIN_RATE_WINDOW_MIN) || 15) * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT) || 10,
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

const server = http.createServer(app);

// ═══ PLATFORM ROUTES ═══
app.use('/api/platform', platformModule.router);

// ═══ TB CLIENT HELPER ═══
function getHotelTB(hotelId) {
  const client = tbPool.getClient(hotelId, db);
  if (!client) throw new Error('ThingsBoard is not configured for this hotel. Contact the platform admin.');
  return client;
}

// ═══ PER-HOTEL IN-MEMORY STATE ═══
// Each of these is a plain object keyed by hotelId.
const _deviceRoomMaps     = {}; // { [hotelId]: { [roomNum]: deviceId } }
const _lastOverviewRooms  = {}; // { [hotelId]: { [roomNum]: roomData } }
const _lastKnownTelemetry = {}; // { [hotelId]: { [roomNum]: telemetryObj } }
const _roomPDState        = {}; // { [hotelId]: { [roomNum]: bool } }
const _doorOpenTimers     = {}; // { [hotelId]: { [roomNum]: timerHandle } }
const _overviewFetchTs    = {}; // { [hotelId]: timestamp } — last full TB fetch time
const _fetchingOverview   = new Set(); // hotelIds currently fetching TB (prevent concurrent fetches)

const OVERVIEW_CACHE_TTL  = 30_000; // ms — re-fetch from TB if data is older than this

function getDeviceRoomMap(hotelId)     { return (_deviceRoomMaps[hotelId]     ??= {}); }
function getLastOverviewRooms(hotelId) { return (_lastOverviewRooms[hotelId]  ??= {}); }
function getLastKnownTelemetry(hotelId){ return (_lastKnownTelemetry[hotelId] ??= {}); }
function getRoomPDState(hotelId)       { return (_roomPDState[hotelId]        ??= {}); }
function getDoorOpenTimers(hotelId)    { return (_doorOpenTimers[hotelId]     ??= {}); }

// ═══ SSE (hotel-scoped) ═══
const sseClients = new Map(); // Map<res, {userId, role, hotelId}>

function sseConnect(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':\n\n');
  sseClients.set(res, { userId: req.user?.id, role: req.user?.role, hotelId: req.user?.hotelId });
  req.on('close', () => sseClients.delete(res));
}

function sseBroadcast(hotelId, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    try { c.write(msg); } catch {}
  }
}

function sseBroadcastAlert(hotelId, data) {
  const msg = `event: alert\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    if (meta.role === 'owner') continue;
    try { c.write(msg); } catch {}
  }
}

function sseBroadcastRoles(hotelId, event, data, roles) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    if (!roles.includes(meta.role)) continue;
    try { c.write(msg); } catch {}
  }
}

// ═══ AUDIT LOG ═══
function addLog(hotelId, category, message, details = {}) {
  const ts    = Date.now();
  const entry = { ts, cat: category, msg: message, ...details };
  try {
    db.prepare('INSERT INTO audit_log (hotel_id, ts, category, message, room, source, user, details) VALUES (?,?,?,?,?,?,?,?)')
      .run(hotelId, ts, category, message, details.room || null, details.source || null, details.user || null, JSON.stringify(details));
  } catch (e) { console.error('Log DB error:', e.message); }
  sseBroadcast(hotelId, 'log', entry);
}

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
  res.json({
    accessToken, refreshToken,
    user: { id: user.id, username: user.username, role: user.role, fullName: user.full_name, hotelId: hotel.id }
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
  addLog(req.user.hotelId, 'auth', 'Logout', { user: req.user.username });
  res.json({ success: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, username, role, full_name, last_login FROM hotel_users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, role: user.role, fullName: user.full_name, lastLogin: user.last_login, hotelId: req.user.hotelId });
});

// ═══ SSE (authenticated via query token or header) ═══
app.get('/api/events', (req, res, next) => {
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
  const m = name.match(/gateway-room-(.+)/);
  return m ? m[1] : null;
}

// ═══ CHANGE DETECTION (per hotel) ═══
function detectAndLogChanges(hotelId, roomNum, t) {
  const lastTelemetry = getLastKnownTelemetry(hotelId);
  const prev          = lastTelemetry[roomNum];
  if (!prev) { lastTelemetry[roomNum] = { ...t }; return; }

  const pdState        = getRoomPDState(hotelId);
  const deviceRoomMap  = getDeviceRoomMap(hotelId);

  for (const key of WATCHABLE_KEYS) {
    if (!(key in t) || prev[key] === t[key]) continue;
    const to = t[key];
    let msg, cat = 'telemetry';

    if (key === 'roomStatus') { msg = `Room status → ${ROOM_STATUS[to] ?? to}`; cat = 'system'; }
    else if (key === 'doorStatus') {
      msg = to ? 'Door OPENED' : 'Door CLOSED'; cat = 'sensor';
      const curStatus = t.roomStatus ?? prev.roomStatus ?? 0;
      if (to === true) {
        if (curStatus === 0) {
          const devId = deviceRoomMap[roomNum];
          if (devId) setImmediate(() => sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, 'auto').catch(() => {}));
        }
        if (curStatus === 1) startNotOccupiedTimer(hotelId, roomNum);
      } else {
        if (t.pirMotionStatus || prev.pirMotionStatus) {
          const timers = getDoorOpenTimers(hotelId);
          clearTimeout(timers[roomNum]);
          delete timers[roomNum];
        }
      }
    }
    else if (key === 'pirMotionStatus') {
      msg = to ? 'Motion detected' : 'No motion'; cat = 'sensor';
      if (to === true) {
        const timers = getDoorOpenTimers(hotelId);
        clearTimeout(timers[roomNum]);
        delete timers[roomNum];
      }
    }
    else if (key === 'dndService') { msg = to ? 'DND activated' : 'DND cleared'; cat = 'service'; }
    else if (key === 'murService') {
      msg = to ? 'Housekeeping requested' : 'MUR cleared'; cat = 'service';
      if (to) sseBroadcastAlert(hotelId, { type: 'MUR', room: roomNum, message: `Room ${roomNum}: Housekeeping`, ts: Date.now() });
    } else if (key === 'sosService') {
      msg = to ? 'SOS EMERGENCY' : 'SOS cleared'; cat = 'service';
      if (to) sseBroadcastAlert(hotelId, { type: 'SOS', room: roomNum, message: `EMERGENCY Room ${roomNum}`, ts: Date.now() });
    } else if (key === 'pdMode') {
      pdState[roomNum] = !!to;
      msg = to ? 'Power Down mode activated' : 'Power Down mode cleared'; cat = 'system';
    } else if (key === 'acMode') { msg = `AC → ${AC_MODES[to] || to}`; }
    else if (key === 'fanSpeed') { msg = `Fan → ${FAN_SPEEDS[to] || to}`; }
    else { msg = `${key} → ${to}`; }

    // Auto-restore OCCUPIED on ANY physical activity while room is NOT_OCCUPIED
    const curStatus = t.roomStatus ?? prev.roomStatus ?? 0;
    if (curStatus === 4) {
      const isActivity =
        (key === 'pirMotionStatus'  && to === true) ||
        (key === 'doorStatus'       && to === true) ||
        (key === 'doorUnlock'       && to === true) ||
        (key === 'line1'            && to === true) ||
        (key === 'line2'            && to === true) ||
        (key === 'line3'            && to === true) ||
        (key === 'acMode'           && to > 0)      ||
        (key === 'curtainsPosition' && to > 0)      ||
        (key === 'blindsPosition'   && to > 0);
      if (isActivity) setImmediate(() => restoreOccupied(hotelId, roomNum));
    }

    if (msg) addLog(hotelId, cat, msg, { room: roomNum, source: 'gateway' });
  }
  lastTelemetry[roomNum] = { ...prev, ...t };
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
  } else if (method === 'resetMeters') {
    data.elecConsumption = 0; data.waterConsumption = 0;
  } else if (method === 'setPDMode') {
    data.pdMode = !!params.pdMode;
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

// ── NOT_OCCUPIED automation ─────────────────────────────────────────────────
function startNotOccupiedTimer(hotelId, roomNum) {
  const timers        = getDoorOpenTimers(hotelId);
  const lastTelemetry = getLastKnownTelemetry(hotelId);
  const deviceRoomMap = getDeviceRoomMap(hotelId);

  clearTimeout(timers[roomNum]);
  timers[roomNum] = setTimeout(async () => {
    delete timers[roomNum];
    const t = lastTelemetry[roomNum];
    if (!t || t.roomStatus !== 1) return;
    if (t.pirMotionStatus) return;
    const devId = deviceRoomMap[roomNum];
    if (!devId) return;
    try {
      await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 4 }, 'auto');
      addLog(hotelId, 'system', 'Room auto → NOT_OCCUPIED (no motion 5 min)', { room: roomNum, source: 'gateway' });
      sseBroadcastRoles(hotelId, 'checkout_alert', { type: 'NOT_OCCUPIED', room: roomNum, ts: Date.now() }, ['owner', 'admin', 'frontdesk']);
    } catch (e) { console.error('NOT_OCCUPIED set failed:', e.message); }
  }, 5 * 60 * 1000);
}

async function restoreOccupied(hotelId, roomNum) {
  const timers        = getDoorOpenTimers(hotelId);
  const lastTelemetry = getLastKnownTelemetry(hotelId);
  const deviceRoomMap = getDeviceRoomMap(hotelId);

  clearTimeout(timers[roomNum]);
  delete timers[roomNum];
  const devId     = deviceRoomMap[roomNum];
  if (!devId) return;
  const curStatus = lastTelemetry[roomNum]?.roomStatus;
  if (curStatus !== 4) return;
  try {
    await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, 'auto');
    addLog(hotelId, 'system', 'Room auto → OCCUPIED (activity detected)', { room: roomNum, source: 'gateway' });
  } catch (e) { console.error(`restoreOccupied ${roomNum} failed:`, e.message); }
}

function impliesActivity(method, params) {
  if (method === 'setDoorUnlock') return true;
  if (method === 'setService')    return true;
  if (method === 'setLines')      return !!(params.line1 || params.line2 || params.line3 || (params.dimmer1 || 0) > 0 || (params.dimmer2 || 0) > 0);
  if (method === 'setAC')         return (params.acMode || 0) > 0;
  if (method === 'setCurtainsBlinds') return (params.curtainsPosition || 0) > 0 || (params.blindsPosition || 0) > 0;
  return false;
}

async function sendControl(hotelId, deviceId, method, params, username = 'system') {
  const telemetry = controlToTelemetry(method, params);
  if (!Object.keys(telemetry).length) throw new Error('Unknown method: ' + method);

  const tb = getHotelTB(hotelId);
  await tb.saveTelemetry(deviceId, telemetry);

  const relayAttrs  = controlToRelayAttributes(telemetry);
  const sharedAttrs = { ...relayAttrs };
  const FORWARD = ['line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','dndService','murService','sosService','roomStatus','doorUnlock'];
  for (const k of FORWARD) { if (k in telemetry) sharedAttrs[k] = telemetry[k]; }

  if (Object.keys(sharedAttrs).length) {
    try { await tb.saveAttributes(deviceId, sharedAttrs); } catch (e) { console.error('Attr write failed:', e.message); }
  }

  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const lastTelemetry = getLastKnownTelemetry(hotelId);
  const pdState       = getRoomPDState(hotelId);
  const roomNum       = Object.keys(deviceRoomMap).find(k => deviceRoomMap[k] === deviceId) || '?';

  if (impliesActivity(method, params) && lastTelemetry[roomNum]?.roomStatus === 4) {
    setImmediate(() => restoreOccupied(hotelId, roomNum));
  }

  if ('pdMode' in telemetry) pdState[roomNum] = !!telemetry.pdMode;
  addLog(hotelId, 'control', method, { room: roomNum, source: 'dashboard', user: username, params: JSON.stringify(telemetry) });

  if (telemetry.murService) sseBroadcastAlert(hotelId, { type: 'MUR', room: roomNum, message: `Room ${roomNum}: Housekeeping`, ts: Date.now() });
  if (telemetry.sosService) sseBroadcastAlert(hotelId, { type: 'SOS', room: roomNum, message: `EMERGENCY Room ${roomNum}`, ts: Date.now() });

  sseBroadcast(hotelId, 'telemetry', { room: roomNum, deviceId, data: { ...telemetry, ...sharedAttrs } });
  return { success: true, written: telemetry };
}

// ═══ PROTECTED API ROUTES ═══

// Room control (owner, admin)
app.post('/api/devices/:id/rpc', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const hotelId = req.user.hotelId;
    const { method, params } = req.body;
    res.json(await sendControl(hotelId, req.params.id, method, params || {}, req.user.username));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Background TB fetch — builds snapshot, stores in _lastOverviewRooms, broadcasts via SSE.
// Never called while another fetch is in progress (_fetchingOverview set guards this).
async function fetchAndBroadcast(hotelId) {
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const lastOverview  = getLastOverviewRooms(hotelId);

  const tb      = getHotelTB(hotelId);
  const devices = await tb.getDevices();
  if (!devices.length) return;

  _overviewFetchTs[hotelId] = Date.now();

  const deviceIds     = devices.map(d => d.id.id);
  const allT          = await tb.getAllTelemetry(deviceIds, TELEMETRY_KEYS);
  const allRelays     = {};
  const ALL_ATTR_KEYS = [...RELAY_KEYS, ...SHARED_CONTROL_KEYS];
  for (let i = 0; i < devices.length; i += 20) {
    const batch = devices.slice(i, i + 20);
    await Promise.all(batch.map(async d => {
      try {
        const attrs  = await tb.getSharedAttributes(d.id.id, ALL_ATTR_KEYS);
        const parsed = {};
        if (Array.isArray(attrs)) {
          attrs.forEach(a => {
            let v = a.value;
            if (v === 'true') v = true;
            else if (v === 'false') v = false;
            else if (v !== null && v !== '' && !isNaN(v)) v = parseFloat(v);
            parsed[a.key] = v;
          });
        }
        allRelays[d.id.id] = parsed;
      } catch { allRelays[d.id.id] = {}; }
    }));
  }

  const today = new Date().toISOString().split('T')[0];
  const activeResRows = db.prepare(
    "SELECT * FROM reservations WHERE hotel_id=? AND active=1 AND check_in<=date('now') AND check_out>=date('now')"
  ).all(hotelId);
  const reservationMap = {};
  activeResRows.forEach(ar => { reservationMap[ar.room] = ar; });

  const hotelRoomRows = db.prepare('SELECT room_number, room_type FROM hotel_rooms WHERE hotel_id=?').all(hotelId);
  const hotelRoomMap  = {};
  hotelRoomRows.forEach(r => { hotelRoomMap[r.room_number] = r.room_type; });

  const rooms = {};
  devices.forEach(d => {
    const rn = extractRoom(d.name);
    if (!rn) return;
    deviceRoomMap[rn] = d.id.id;
    const floor  = parseInt(rn.length <= 3 ? rn[0] : rn.slice(0, -2));
    const t      = parseTelemetry(allT[d.id.id]);
    const relays = allRelays[d.id.id] || {};
    const ar     = reservationMap[rn] || null;
    detectAndLogChanges(hotelId, rn, t);

    const roomType = hotelRoomMap[rn];
    const typeId   = roomType ? ROOM_TYPES.indexOf(roomType) : (FLOOR_TYPE[floor] ?? 0);

    rooms[rn] = {
      room: rn, floor, type: ROOM_TYPES[typeId] || 'STANDARD', typeId, deviceId: d.id.id, deviceName: d.name,
      online: Object.keys(t).length > 0,
      temperature: t.temperature ?? null, humidity: t.humidity ?? null, co2: t.co2 ?? null,
      pirMotionStatus: t.pirMotionStatus ?? false, doorStatus: t.doorStatus ?? false,
      doorLockBattery: t.doorLockBattery ?? null, doorContactsBattery: t.doorContactsBattery ?? null,
      airQualityBattery: t.airQualityBattery ?? null,
      elecConsumption: t.elecConsumption ?? 0, waterConsumption: t.waterConsumption ?? 0,
      waterMeterBattery: t.waterMeterBattery ?? null,
      line1: relays.line1 ?? t.line1 ?? false, line2: relays.line2 ?? t.line2 ?? false, line3: relays.line3 ?? t.line3 ?? false,
      dimmer1: relays.dimmer1 ?? t.dimmer1 ?? 0, dimmer2: relays.dimmer2 ?? t.dimmer2 ?? 0,
      acTemperatureSet: relays.acTemperatureSet ?? t.acTemperatureSet ?? 22, acMode: relays.acMode ?? t.acMode ?? 0, fanSpeed: relays.fanSpeed ?? t.fanSpeed ?? 3,
      curtainsPosition: relays.curtainsPosition ?? t.curtainsPosition ?? 0, blindsPosition: relays.blindsPosition ?? t.blindsPosition ?? 0,
      dndService: relays.dndService ?? t.dndService ?? false, murService: relays.murService ?? t.murService ?? false, sosService: relays.sosService ?? t.sosService ?? false,
      roomStatus: relays.roomStatus ?? t.roomStatus ?? 0,
      lastCleanedTime: t.lastCleanedTime ?? null, firmwareVersion: t.firmwareVersion ?? null,
      gatewayVersion: t.gatewayVersion ?? null, deviceStatus: t.deviceStatus ?? 0,
      pdMode: relays.pdMode ?? t.pdMode ?? false,
      relay1: relays.relay1 ?? false, relay2: relays.relay2 ?? false,
      relay3: relays.relay3 ?? false, relay4: relays.relay4 ?? false,
      relay5: relays.relay5 ?? false, relay6: relays.relay6 ?? false,
      relay7: relays.relay7 ?? false, relay8: relays.relay8 ?? false,
      doorUnlock: relays.doorUnlock ?? false,
      reservation: ar ? { id: ar.id, guestName: ar.guest_name, checkIn: ar.check_in, checkOut: ar.check_out } : null
    };
  });

  Object.assign(lastOverview, rooms);
  sseBroadcast(hotelId, 'snapshot', { rooms, deviceCount: devices.length, timestamp: Date.now() });

  const todayCheckouts = db.prepare('SELECT room, guest_name, check_out FROM reservations WHERE hotel_id=? AND check_out=? AND active=1').all(hotelId, today);
  if (todayCheckouts.length) {
    sseBroadcastRoles(hotelId, 'checkout_alert', { rooms: todayCheckouts, ts: Date.now() }, ['admin', 'frontdesk']);
  }
}

// Hotel overview — always responds instantly with cached snapshot.
// If data is stale (> OVERVIEW_CACHE_TTL), kicks off background TB fetch;
// fresh data is pushed to the client via SSE 'snapshot' event when ready.
app.get('/api/hotel/overview', authenticate, async (req, res) => {
  const hotelId      = req.user.hotelId;
  const lastOverview = getLastOverviewRooms(hotelId);
  const isStale      = Date.now() - (_overviewFetchTs[hotelId] || 0) >= OVERVIEW_CACHE_TTL;

  // Respond immediately — never block the HTTP connection waiting for TB
  res.json({ rooms: lastOverview, deviceCount: Object.keys(lastOverview).length, cached: true });

  // Kick off background refresh if stale and not already in progress
  if (!isStale || _fetchingOverview.has(hotelId)) return;
  _fetchingOverview.add(hotelId);
  fetchAndBroadcast(hotelId)
    .catch(e => console.error(`[${hotelId}] Overview fetch error:`, e.message))
    .finally(() => _fetchingOverview.delete(hotelId));
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
  addLog(hotelId, 'system', 'Audit log cleared', { user: req.user.username });
  res.json({ success: true });
});

// ═══ PMS ROUTES ═══
app.get('/api/pms/reservations', authenticate, (req, res) => {
  const hotelId = req.user.hotelId;
  const rows    = db.prepare('SELECT * FROM reservations WHERE hotel_id=? ORDER BY created_at DESC LIMIT 100').all(hotelId);
  res.json(rows.map(r => ({
    id: r.id, room: r.room, guestName: r.guest_name,
    checkIn: r.check_in, checkOut: r.check_out,
    password: r.password, active: !!r.active, token: r.token
  })));
});

app.post('/api/pms/reservations', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { room, guestName, checkIn, checkOut, paymentMethod, ratePerNight } = req.body;
  if (!room || !guestName || !checkIn || !checkOut) return res.status(400).json({ error: 'All fields required' });

  const id       = crypto.randomUUID();
  const password = crypto.randomInt(100000, 999999).toString();
  const token    = crypto.randomBytes(16).toString('hex');

  // Determine room type: check hotel_rooms first, then fall back to floor-based
  const hotelRoom = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, room);
  const roomType  = hotelRoom?.room_type || ROOM_TYPES[FLOOR_TYPE[parseInt(room.length <= 3 ? room[0] : room.slice(0, -2))] ?? 0];
  const rateRow   = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(hotelId, roomType);
  const resolvedRate = ratePerNight ? parseFloat(ratePerNight) : (rateRow ? rateRow.rate_per_night : null);

  const lastOverview = getLastOverviewRooms(hotelId);
  const roomData     = lastOverview[room] || {};
  const elecAtCheckin  = roomData.elecConsumption ?? null;
  const waterAtCheckin = roomData.waterConsumption ?? null;

  const ci = new Date(checkIn); const co = new Date(checkOut);
  const nights      = Math.max(1, Math.round((co - ci) / 86400000));
  const totalAmount = resolvedRate ? nights * resolvedRate : null;

  db.prepare(`INSERT INTO reservations
    (id,hotel_id,room,guest_name,check_in,check_out,password,token,created_by,payment_method,rate_per_night,elec_at_checkin,water_at_checkin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, hotelId, room, guestName, checkIn, checkOut, password, token, req.user.username,
      paymentMethod || 'pending', resolvedRate, elecAtCheckin, waterAtCheckin);

  if (resolvedRate) {
    try {
      db.prepare(`INSERT INTO income_log
        (id,hotel_id,reservation_id,room,guest_name,check_in,check_out,nights,room_type,rate_per_night,total_amount,payment_method,elec_at_checkin,water_at_checkin,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), hotelId, id, room, guestName, checkIn, checkOut,
          nights, roomType, resolvedRate, totalAmount, paymentMethod || 'pending',
          elecAtCheckin, waterAtCheckin, req.user.username);
    } catch (e) { console.error('Income log write at reservation failed:', e.message); }
  }

  addLog(hotelId, 'pms', `Reservation created Rm${room} (${nights}n × ${resolvedRate} SAR = ${totalAmount} SAR)`, { room, user: req.user.username });
  const guestUrl = `${req.protocol}://${req.get('host')}/guest?room=${encodeURIComponent(room)}&hotel=${encodeURIComponent(db.prepare('SELECT slug FROM hotels WHERE id=?').get(hotelId)?.slug || '')}`;
  res.json({
    reservation: { id, room, guestName, checkIn, checkOut, active: true, token, paymentMethod: paymentMethod || 'pending', ratePerNight: resolvedRate, nights, totalAmount },
    password, guestUrl
  });
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
  addLog(hotelId, 'pms', `PMS history cleared (${result.changes} records)`, { user: req.user.username });
  res.json({ success: true, deleted: result.changes });
});

app.delete('/api/pms/reservations/:id', authenticate, (req, res) => {
  const hotelId  = req.user.hotelId;
  const existing = db.prepare('SELECT * FROM reservations WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE reservations SET active=0 WHERE id=? AND hotel_id=?').run(req.params.id, hotelId);
  addLog(hotelId, 'pms', 'Reservation cancelled', { room: existing.room, user: req.user.username });
  if (existing.room) sseBroadcast(hotelId, 'lockout', { room: existing.room });
  res.json({ success: true });
});

app.post('/api/pms/reservations/:id/extend', authenticate, requireRole('owner', 'admin', 'frontdesk'), (req, res) => {
  const hotelId        = req.user.hotelId;
  const { newCheckOut, paymentMethod } = req.body;
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

  db.prepare('UPDATE reservations SET check_out=?, payment_method=? WHERE id=?').run(newCheckOut, pm, ar.id);
  db.prepare('UPDATE income_log SET check_out=?, nights=?, total_amount=?, payment_method=? WHERE reservation_id=?')
    .run(newCheckOut, nights, totalAmount, pm, ar.id);

  addLog(hotelId, 'pms', `Stay extended Rm${ar.room}: ${ar.check_out} → ${newCheckOut} (${nights}n, ${totalAmount} SAR)`, { room: ar.room, user: req.user.username });
  res.json({ success: true, newCheckOut, nights, totalAmount, ratePerNight, paymentMethod: pm });
});

app.post('/api/rooms/:room/lockdown', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { room } = req.params;
  db.prepare('UPDATE reservations SET active=0 WHERE hotel_id=? AND room=? AND active=1').run(hotelId, room);
  addLog(hotelId, 'system', `Room ${room} forced lockdown`, { room, user: req.user.username });
  sseBroadcast(hotelId, 'lockout', { room });
  res.json({ success: true });
});

app.post('/api/rooms/:room/checkout', authenticate, requireRole('owner', 'admin', 'frontdesk'), async (req, res) => {
  const hotelId  = req.user.hotelId;
  const { room } = req.params;
  const ar       = db.prepare('SELECT * FROM reservations WHERE hotel_id=? AND room=? AND active=1').get(hotelId, room);
  db.prepare('UPDATE reservations SET active=0 WHERE hotel_id=? AND room=? AND active=1').run(hotelId, room);

  if (ar) {
    try {
      const lastOverview = getLastOverviewRooms(hotelId);
      const roomData     = lastOverview[room] || {};
      const elecOut  = roomData.elecConsumption ?? null;
      const waterOut = roomData.waterConsumption ?? null;

      const existing = db.prepare('SELECT id FROM income_log WHERE reservation_id=?').get(ar.id);
      if (existing) {
        db.prepare('UPDATE income_log SET elec_at_checkout=?, water_at_checkout=? WHERE reservation_id=?')
          .run(elecOut, waterOut, ar.id);
      } else {
        const hotelRoom = db.prepare('SELECT room_type FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, room);
        const roomType  = hotelRoom?.room_type || ROOM_TYPES[FLOOR_TYPE[parseInt(room.length <= 3 ? room[0] : room.slice(0, -2))] ?? 0];
        const rateRow   = db.prepare('SELECT rate_per_night FROM night_rates WHERE hotel_id=? AND room_type=?').get(hotelId, roomType);
        const ratePerNight = ar.rate_per_night || (rateRow ? rateRow.rate_per_night : 0);
        const ci = new Date(ar.check_in); const co = new Date(ar.check_out);
        const nights = Math.max(1, Math.round((co - ci) / 86400000));
        db.prepare(`INSERT INTO income_log
          (id,hotel_id,reservation_id,room,guest_name,check_in,check_out,nights,room_type,rate_per_night,total_amount,payment_method,elec_at_checkin,water_at_checkin,elec_at_checkout,water_at_checkout,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(crypto.randomUUID(), hotelId, ar.id, room, ar.guest_name, ar.check_in, ar.check_out,
            nights, roomType, ratePerNight, nights * ratePerNight, ar.payment_method || 'pending',
            ar.elec_at_checkin ?? null, ar.water_at_checkin ?? null, elecOut, waterOut, req.user.username);
      }
    } catch (e) { console.error('Income log update at checkout failed:', e.message); }
  }

  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId = deviceRoomMap[room];
  if (devId) {
    try { await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 2 }, req.user.username); } catch {}
  }
  sseBroadcast(hotelId, 'lockout', { room });
  addLog(hotelId, 'pms', `Room ${room} checked out → SERVICE`, { room, user: req.user.username });
  res.json({ success: true });
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
  const hotelSlug = db.prepare('SELECT slug FROM hotels WHERE id=?').get(hotelId)?.slug || '';
  res.json({ url: `${req.protocol}://${req.get('host')}/guest?room=${encodeURIComponent(r.room)}&hotel=${encodeURIComponent(hotelSlug)}`, password: r.password });
});

// ═══ GUEST API ═══
app.post('/api/guest/login', guestLimiter, (req, res) => {
  const { token, room, hotelSlug, lastName, password } = req.body;
  if ((!token && !room) || !password) {
    return res.status(400).json({ error: 'Name and password required' });
  }

  const providedPassword = String(password || '').trim();
  const TEST_PW          = process.env.GUEST_TEST_PASSWORD || '000000';

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

  // Static test override
  if (room && hotelSlug && providedPassword === TEST_PW) {
    const hotel = db.prepare('SELECT id FROM hotels WHERE slug=? AND active=1').get(hotelSlug.toLowerCase());
    if (hotel) {
      const guestToken = generateAccessToken({ id: 0, username: `guest:test`, role: 'guest', room, hotelId: hotel.id });
      addLog(hotel.id, 'auth', 'Guest test login', { source: `guest:test`, room });
      return res.json({ accessToken: guestToken, room, guestName: lastName || `TestGuest` });
    }
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
  const storedPassword = String(r.password).trim();

  if (!nameMatch || storedPassword !== providedPassword) {
    addLog(hotelId, 'auth', 'Guest login failed', { source: `guest:${lastName}`, room: r.room });
    return res.status(401).json({ error: 'Invalid name or password. Use the name given at check-in.' });
  }

  const guestToken = generateAccessToken({ id: 0, username: `guest:${r.guest_name}`, role: 'guest', room: r.room, hotelId });
  addLog(hotelId, 'auth', 'Guest login', { source: `guest:${r.guest_name}`, room: r.room });
  res.json({ accessToken: guestToken, room: r.room, guestName: r.guest_name });
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
  res.json({ room: r.room, telemetry: lastOverview[r.room] || {} });
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
    const tb          = getHotelTB(hotelId);
    const deviceRoomMap = getDeviceRoomMap(hotelId);
    let devId = deviceRoomMap[roomNum];
    if (!devId) {
      const devices = await tb.getDevices();
      const dev     = devices.find(d => extractRoom(d.name) === roomNum);
      if (!dev) return res.status(404).json({ error: 'Room device not found in ThingsBoard' });
      devId = dev.id.id;
      deviceRoomMap[roomNum] = devId;
    }
    const rawT      = await tb.getAllTelemetry([devId], TELEMETRY_KEYS);
    const t         = parseTelemetry(rawT[devId] || {});
    const attrsArr  = await tb.getSharedAttributes(devId, RELAY_KEYS);
    const relays    = {};
    if (Array.isArray(attrsArr)) attrsArr.forEach(a => { relays[a.key] = a.value; });

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
      reservation: ar ? { id: ar.id, guestName: ar.guest_name, checkIn: ar.check_in, checkOut: ar.check_out } : null
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
    try { await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, `guest:${r.guest_name}`); } catch {}
  }
  sendControl(hotelId, devId, method, params || {}, req.user.username)
    .then(d => res.json(d))
    .catch(e => res.status(400).json({ error: e.message }));
});

// ═══ RESET ROOM ═══
app.post('/api/rooms/reset-all', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId       = req.user.hotelId;
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const rooms         = Object.keys(deviceRoomMap);
  const username      = req.user.username;
  addLog(hotelId, 'system', `All rooms reset to default by ${username}`, { user: username });
  res.json({ success: true, total: rooms.length, message: 'Reset started in background' });

  (async () => {
    const BATCH = 10;
    for (let i = 0; i < rooms.length; i += BATCH) {
      const batch = rooms.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async room => {
        const devId = deviceRoomMap[room];
        if (!devId) return;
        try {
          await sendControl(hotelId, devId, 'setPDMode', { pdMode: false }, username);
          await sendControl(hotelId, devId, 'setLines', { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 }, username);
          await sendControl(hotelId, devId, 'setAC', { acMode: 0, fanSpeed: 0, acTemperatureSet: 22 }, username);
          await sendControl(hotelId, devId, 'setCurtainsBlinds', { curtainsPosition: 0, blindsPosition: 0 }, username);
          await sendControl(hotelId, devId, 'resetServices', { services: ['dndService', 'murService', 'sosService'] }, username);
          await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 0 }, username);
          await sendControl(hotelId, devId, 'resetMeters', {}, username);
        } catch (e) { console.error(`Reset room ${room} failed:`, e.message); }
      }));
    }
    addLog(hotelId, 'system', `All rooms reset complete`, { user: username });
  })();
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
    await sendControl(hotelId, devId, 'setAC', { acMode: 0, fanSpeed: 0, acTemperatureSet: 22 }, req.user.username);
    await sendControl(hotelId, devId, 'setCurtainsBlinds', { curtainsPosition: 0, blindsPosition: 0 }, req.user.username);
    await sendControl(hotelId, devId, 'resetServices', { services: ['dndService', 'murService', 'sosService'] }, req.user.username);
    await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 0 }, req.user.username);
    await sendControl(hotelId, devId, 'resetMeters', {}, req.user.username);
    addLog(hotelId, 'system', `Room ${room} reset to default (meters zeroed)`, { room, user: req.user.username });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ SIMULATOR INJECT ═══
app.post('/api/simulator/inject', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const hotelId = req.user.hotelId;
  const { room, telemetry } = req.body;
  if (!room || !telemetry || typeof telemetry !== 'object') {
    return res.status(400).json({ error: 'room and telemetry object required' });
  }
  const deviceRoomMap = getDeviceRoomMap(hotelId);
  const devId         = deviceRoomMap[room];
  if (!devId) return res.status(404).json({ error: `Room ${room} not mapped to a device` });

  const coerced = {};
  for (const [k, v] of Object.entries(telemetry)) {
    if (v === '' || v === null || v === undefined) continue;
    if (typeof v === 'boolean') coerced[k] = v;
    else if (['roomStatus','acMode','fanSpeed','dimmer1','dimmer2','curtainsPosition','blindsPosition'].includes(k)) coerced[k] = parseInt(v);
    else if (['temperature','humidity','co2','acTemperatureSet','elecConsumption','waterConsumption'].includes(k)) coerced[k] = parseFloat(v);
    else if (['pirMotionStatus','doorStatus','line1','line2','line3','dndService','murService','sosService','pdMode'].includes(k)) coerced[k] = Boolean(v);
    else coerced[k] = v;
  }
  if (!Object.keys(coerced).length) return res.status(400).json({ error: 'No valid telemetry keys provided' });

  try {
    const tb = getHotelTB(hotelId);
    await tb.saveTelemetry(devId, coerced);
    detectAndLogChanges(hotelId, room, coerced);
    sseBroadcast(hotelId, 'telemetry', { room, deviceId: devId, data: coerced });
    res.json({ success: true, injected: coerced });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  addLog(hotelId, 'finance', 'Night rates updated', { user: req.user.username });
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
  const header  = 'Room,Guest,Check-In,Check-Out,Nights,Type,Rate/Night,Total,Payment,Elec-In,Elec-Out,Water-In,Water-Out,Date,Staff';
  const csv     = rows.map(r => [
    r.room, `"${(r.guest_name||'').replace(/"/g,'""')}"`,
    r.check_in, r.check_out, r.nights, r.room_type,
    r.rate_per_night, r.total_amount, r.payment_method,
    r.elec_at_checkin ?? '', r.elec_at_checkout ?? '',
    r.water_at_checkin ?? '', r.water_at_checkout ?? '',
    r.created_at, r.created_by || ''
  ].join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="income-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send([header, ...csv].join('\n'));
});

app.delete('/api/finance/income', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const result  = db.prepare('DELETE FROM income_log WHERE hotel_id=?').run(hotelId);
  addLog(hotelId, 'finance', `Income log cleared (${result.changes} records)`, { user: req.user.username });
  res.json({ success: true, deleted: result.changes });
});

app.get('/api/finance/summary', authenticate, requireRole('owner', 'admin'), (req, res) => {
  const hotelId  = req.user.hotelId;
  const byType   = db.prepare('SELECT room_type, COUNT(*) as stays, SUM(nights) as nights, SUM(total_amount) as revenue FROM income_log WHERE hotel_id=? GROUP BY room_type').all(hotelId);
  const byPayment = db.prepare('SELECT payment_method, COUNT(*) as count, SUM(total_amount) as amount FROM income_log WHERE hotel_id=? GROUP BY payment_method').all(hotelId);
  const total    = db.prepare('SELECT SUM(total_amount) as total FROM income_log WHERE hotel_id=?').get(hotelId);
  res.json({ byType, byPayment, total: total.total || 0 });
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
  res.json(db.prepare('SELECT id, username, role, full_name, active, last_login, created_at FROM hotel_users WHERE hotel_id=? ORDER BY created_at').all(req.user.hotelId));
});

app.post('/api/users', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const { username, password, role, fullName } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Required: username, password, role' });
  if (!['owner', 'admin', 'frontdesk'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO hotel_users (hotel_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)').run(hotelId, username, hash, role, fullName || null);
    addLog(hotelId, 'system', `User created: ${username} (${role})`, { user: req.user.username });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/users/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId      = req.user.hotelId;
  const { fullName, role, active } = req.body;
  const user         = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (role && !['owner', 'admin', 'frontdesk'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE hotel_users SET full_name=COALESCE(?,full_name), role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=? AND hotel_id=?')
    .run(fullName ?? null, role ?? null, active != null ? (active ? 1 : 0) : null, req.params.id, hotelId);
  addLog(hotelId, 'system', `User updated: ${user.username}`, { user: req.user.username });
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
  addLog(hotelId, 'system', `Password changed: ${targetUser?.username}`, { user: req.user.username });
  res.json({ success: true });
});

app.delete('/api/users/:id', authenticate, requireRole('owner'), (req, res) => {
  const hotelId = req.user.hotelId;
  const user    = db.prepare('SELECT * FROM hotel_users WHERE id=? AND hotel_id=?').get(req.params.id, hotelId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account' });
  db.prepare('UPDATE hotel_users SET active=0 WHERE id=? AND hotel_id=?').run(req.params.id, hotelId);
  addLog(hotelId, 'system', `User deactivated: ${user.username}`, { user: req.user.username });
  res.json({ success: true });
});

// ═══ CATCH-ALL for SPA ═══
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
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

    const tb    = getHotelTB(hotelId);
    await tb.ensureAuth();
    const tws = new WebSocket(`${tb.host.replace('http', 'ws')}/api/ws/plugins/telemetry?token=${tb.getWsToken()}`);
    tws.on('message', d => { if (cws.readyState === 1) cws.send(d.toString()); });
    cws.on('message', d => { if (tws.readyState === 1) tws.send(d.toString()); });
    tws.on('close', () => cws.close());
    cws.on('close', () => tws.close());
    tws.on('error', e => { console.error('TB WS error:', e.message); cws.close(); });
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

module.exports = { app, server };
