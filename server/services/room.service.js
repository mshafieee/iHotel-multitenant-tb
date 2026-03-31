/**
 * iHotel — Room Service
 *
 * Owns the room data lifecycle:
 *   1. fetchAndBroadcast()  — pull full state from IoT platform, build overview, push via SSE
 *   2. processTelemetry()   — single entry point for ALL incoming device data (real-time or polled)
 *   3. detectAndLogChanges() — compare prev vs. new telemetry, fire alerts, trigger automation
 *   4. startPlatformSubscription() — open real-time link to IoT platform
 *
 * Depends on: adapters, state, sse, audit, control (for sendControl in automation)
 */
const state = require('./state.service');
const { sseBroadcast, sseBatchTelemetry, sseBroadcastRoles, fireServiceAlert } = require('./sse.service');
const { addLog } = require('./audit.service');

let _db = null;
let _adapterPool = null;
let _controlService = null;
let _checkEventScenes = null;

// ── Constants (mirrored from index.js) ────────────────────────────────────────
const ROOM_TYPES    = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];
const FLOOR_TYPE    = { 1:1, 2:0, 3:0, 4:1, 5:2, 6:0, 7:1, 8:0, 9:2, 10:0, 11:1, 12:0, 13:2, 14:3, 15:3 };

const TELEMETRY_KEYS = [
  'roomStatus','pirMotionStatus','doorStatus','doorLockBattery','doorContactsBattery',
  'co2','temperature','humidity','airQualityBattery','elecConsumption','waterConsumption',
  'waterMeterBattery','line1','line2','line3','dimmer1','dimmer2','acTemperatureSet',
  'acMode','fanSpeed','curtainsPosition','blindsPosition','dndService','murService',
  'sosService','lastCleanedTime','lastTelemetryTime','firmwareVersion','gatewayVersion','deviceStatus',
  'pdMode','doorUnlock'
];
const RELAY_KEYS = ['relay1','relay2','relay3','relay4','relay5','relay6','relay7','relay8','doorUnlock','defaultUnlockDuration'];
const SHARED_CONTROL_KEYS = ['line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','roomStatus','dndService','murService','sosService','pdMode'];
const WATCHABLE_KEYS = ['roomStatus','pirMotionStatus','doorStatus','line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','dndService','murService','sosService','deviceStatus','pdMode'];

function init(db, adapterPool, controlService) {
  _db = db;
  _adapterPool = adapterPool;
  _controlService = controlService;
}

function setSceneEngine(fn) { _checkEventScenes = fn; }

function getAdapter(hotelId) {
  const adapter = _adapterPool.getAdapter(hotelId, _db);
  if (!adapter) throw new Error('Smart room control is not configured for this hotel.');
  return adapter;
}

function extractRoom(name) {
  const m = name.match(/gateway-room-(.+)/);
  return m ? m[1] : null;
}

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

// ── Core telemetry pipeline ───────────────────────────────────────────────────

function processTelemetry(hotelId, roomNum, deviceId, data) {
  const lastOverview = state.getLastOverviewRooms(hotelId);
  detectAndLogChanges(hotelId, roomNum, data);

  if (!lastOverview[roomNum]) {
    const dbRoom = _db.prepare('SELECT elec_meter_baseline, water_meter_baseline FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotelId, roomNum);
    lastOverview[roomNum] = {
      elecMeterBaseline:  dbRoom?.elec_meter_baseline  ?? 0,
      waterMeterBaseline: dbRoom?.water_meter_baseline ?? 0,
    };
  }

  const prevState = {};
  if (lastOverview[roomNum]) {
    for (const key of Object.keys(data)) prevState[key] = lastOverview[roomNum][key];
    let broadcastData = data;
    if (state.getRoomStateSnapshots(hotelId)[roomNum] && 'roomStatus' in data && data.roomStatus !== 4) {
      broadcastData = { ...data };
      delete broadcastData.roomStatus;
    }
    Object.assign(lastOverview[roomNum], broadcastData);
    sseBatchTelemetry(hotelId, roomNum, deviceId, broadcastData);
  }
  if (_checkEventScenes) _checkEventScenes(hotelId, roomNum, data, prevState);
}

// ── Change detection ──────────────────────────────────────────────────────────

function detectAndLogChanges(hotelId, roomNum, t) {
  const lastTelemetry = state.getLastKnownTelemetry(hotelId);
  const prev          = lastTelemetry[roomNum];
  if (!prev) { lastTelemetry[roomNum] = { ...t }; return; }

  if ((state.getRoomStateSnapshots(hotelId)[roomNum] || prev.roomStatus === 4) && 'roomStatus' in t && t.roomStatus !== 4) {
    t = { ...t };
    delete t.roomStatus;
  }

  const pdState       = state.getRoomPDState(hotelId);
  const deviceRoomMap = state.getDeviceRoomMap(hotelId);

  for (const key of WATCHABLE_KEYS) {
    if (!(key in t) || prev[key] === t[key]) continue;
    const to = t[key];
    let msg, cat = 'telemetry';

    if (key === 'roomStatus') {
      if (to !== 4) delete state.getRoomStateSnapshots(hotelId)[roomNum];
    }
    else if (key === 'doorStatus') {
      if (to === true) { msg = 'Door OPENED'; cat = 'sensor'; }
      const curStatus = t.roomStatus ?? prev.roomStatus ?? 0;
      const roomOverview = state.getLastOverviewRooms(hotelId)[roomNum];
      if (to === true) {
        const isReserved = (curStatus === 0 || (roomOverview?.reservation && curStatus !== 1)) && curStatus !== 3;
        if (isReserved) {
          const devId = deviceRoomMap[roomNum];
          if (devId) setImmediate(async () => {
            await _controlService.sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, 'auto').catch(() => {});
            if (_checkEventScenes) _checkEventScenes(hotelId, roomNum, { roomStatus: 1 }, { roomStatus: 0 });
          });
        }
        if (curStatus === 1) _controlService.startNotOccupiedTimer(hotelId, roomNum);
      } else {
        if (t.pirMotionStatus || prev.pirMotionStatus) {
          const timers = state.getDoorOpenTimers(hotelId);
          clearTimeout(timers[roomNum]);
          delete timers[roomNum];
        }
      }
    }
    else if (key === 'pirMotionStatus') {
      if (to === true) {
        const timers = state.getDoorOpenTimers(hotelId);
        clearTimeout(timers[roomNum]);
        delete timers[roomNum];
      }
    }
    else if (key === 'dndService') { /* not logged */ }
    else if (key === 'murService') {
      if (to) { msg = 'MUR — Housekeeping requested'; cat = 'service'; }
      if (to) fireServiceAlert(hotelId, 'MUR', roomNum, `Room ${roomNum}: Housekeeping`);
    } else if (key === 'sosService') {
      if (to) { msg = 'SOS EMERGENCY'; cat = 'service'; }
      if (to) fireServiceAlert(hotelId, 'SOS', roomNum, `EMERGENCY Room ${roomNum}`);
    } else if (key === 'pdMode') {
      pdState[roomNum] = !!to;
    }

    // Auto-restore OCCUPIED on activity while NOT_OCCUPIED
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
      if (isActivity) setImmediate(() => _controlService.restoreOccupied(hotelId, roomNum));
    }

    // Auto-set OCCUPIED on physical activity in a RESERVED room
    const roomOverview2 = state.getLastOverviewRooms(hotelId)[roomNum];
    if (curStatus !== 1 && curStatus !== 3 && roomOverview2?.reservation) {
      const isGuestActivity =
        (key === 'pirMotionStatus' && to === true) ||
        (key === 'line1' && to === true) ||
        (key === 'line2' && to === true) ||
        (key === 'line3' && to === true) ||
        (key === 'acMode' && to > 0)    ||
        (key === 'curtainsPosition' && to > 0) ||
        (key === 'blindsPosition'   && to > 0);
      if (isGuestActivity) {
        const devId = deviceRoomMap[roomNum];
        if (devId) setImmediate(() => _controlService.sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, 'auto').catch(() => {}));
      }
    }

    if (msg) addLog(hotelId, cat, msg, { room: roomNum, source: 'gateway' });
  }
  lastTelemetry[roomNum] = { ...prev, ...t };
}

// ── Real-time subscription ────────────────────────────────────────────────────

async function startPlatformSubscription(hotelId, deviceIdToRoom) {
  if (!Object.keys(deviceIdToRoom).length) return;

  const existing = state.getPlatformSub(hotelId);
  const WebSocket = require('ws');
  if (existing && existing._ws && existing._ws.readyState <= WebSocket.OPEN) return;
  if (existing) { try { existing.close(); } catch {} }

  try {
    const adapter = getAdapter(hotelId);
    const sub = await adapter.subscribe(deviceIdToRoom, (roomNum, deviceId, data) => {
      processTelemetry(hotelId, roomNum, deviceId, data);
    });

    if (!sub) return; // Platform doesn't support real-time

    if (sub._ws) {
      sub._ws.on('error', e => console.error(`[${hotelId}] Platform sub WS error:`, e.message));
      sub._ws.on('close', () => {
        state.deletePlatformSub(hotelId);
        setTimeout(() => {
          if (state.getPlatformSub(hotelId)) return;
          startPlatformSubscription(hotelId, deviceIdToRoom)
            .catch(e => console.error(`[${hotelId}] Platform sub reconnect failed:`, e.message));
        }, 15000);
      });
    }

    state.setPlatformSub(hotelId, sub);
    console.log(`✓ [${hotelId}] Platform real-time subscription active (${Object.keys(deviceIdToRoom).length} devices)`);
  } catch (e) {
    console.error(`[${hotelId}] Failed to start platform subscription:`, e.message);
  }
}

// ── Full overview fetch ───────────────────────────────────────────────────────

async function fetchAndBroadcast(hotelId) {
  const deviceRoomMap = state.getDeviceRoomMap(hotelId);
  const lastOverview  = state.getLastOverviewRooms(hotelId);

  state.setOverviewFetchTs(hotelId);

  const adapter = getAdapter(hotelId);
  const devices = await adapter.listDevices();
  if (!devices.length) return;

  const deviceIds     = devices.map(d => d.id);
  const allT          = await adapter.getAllDeviceStates(deviceIds, TELEMETRY_KEYS);
  const allRelays     = {};
  const ALL_ATTR_KEYS = [...RELAY_KEYS, ...SHARED_CONTROL_KEYS];
  for (let i = 0; i < devices.length; i += 20) {
    const batch = devices.slice(i, i + 20);
    await Promise.all(batch.map(async d => {
      try {
        allRelays[d.id] = await adapter.getDeviceAttributes(d.id, ALL_ATTR_KEYS);
      } catch { allRelays[d.id] = {}; }
    }));
  }

  const today = new Date().toISOString().split('T')[0];
  const activeResRows = _db.prepare(
    "SELECT * FROM reservations WHERE hotel_id=? AND active=1 AND check_in<=date('now') AND check_out>=date('now')"
  ).all(hotelId);
  const reservationMap = {};
  activeResRows.forEach(ar => { reservationMap[ar.room] = ar; });

  const hotelRoomRows = _db.prepare('SELECT room_number, room_type, elec_meter_baseline, water_meter_baseline FROM hotel_rooms WHERE hotel_id=?').all(hotelId);
  const hotelRoomMap  = {};
  hotelRoomRows.forEach(r => { hotelRoomMap[r.room_number] = r; });

  const rooms = {};
  devices.forEach(d => {
    const rn = d.roomNumber || extractRoom(d.name);
    if (!rn) return;
    deviceRoomMap[rn] = d.id;
    const floor  = parseInt(rn.length <= 3 ? rn[0] : rn.slice(0, -2));
    const t      = parseTelemetry(allT[d.id]);
    const relays = allRelays[d.id] || {};
    const ar     = reservationMap[rn] || null;
    detectAndLogChanges(hotelId, rn, t);

    const hotelRoom = hotelRoomMap[rn];
    const roomType  = hotelRoom?.room_type;
    const typeId    = roomType ? ROOM_TYPES.indexOf(roomType) : (FLOOR_TYPE[floor] ?? 0);

    rooms[rn] = {
      room: rn, floor, type: ROOM_TYPES[typeId] || 'STANDARD', typeId, deviceId: d.id, deviceName: d.name,
      online: Object.keys(t).length > 0,
      temperature: t.temperature ?? null, humidity: t.humidity ?? null, co2: t.co2 ?? null,
      pirMotionStatus: t.pirMotionStatus ?? false, doorStatus: t.doorStatus ?? false,
      doorLockBattery: t.doorLockBattery ?? null, doorContactsBattery: t.doorContactsBattery ?? null,
      airQualityBattery: t.airQualityBattery ?? null,
      elecConsumption: t.elecConsumption ?? 0, waterConsumption: t.waterConsumption ?? 0,
      elecMeterBaseline: hotelRoom?.elec_meter_baseline ?? 0, waterMeterBaseline: hotelRoom?.water_meter_baseline ?? 0,
      waterMeterBattery: t.waterMeterBattery ?? null,
      line1: t.line1 ?? relays.line1 ?? false, line2: t.line2 ?? relays.line2 ?? false, line3: t.line3 ?? relays.line3 ?? false,
      dimmer1: t.dimmer1 ?? relays.dimmer1 ?? 0, dimmer2: t.dimmer2 ?? relays.dimmer2 ?? 0,
      acTemperatureSet: t.acTemperatureSet ?? relays.acTemperatureSet ?? 22, acMode: t.acMode ?? relays.acMode ?? 0, fanSpeed: t.fanSpeed ?? relays.fanSpeed ?? 3,
      curtainsPosition: t.curtainsPosition ?? relays.curtainsPosition ?? 0, blindsPosition: t.blindsPosition ?? relays.blindsPosition ?? 0,
      dndService: t.dndService ?? relays.dndService ?? false, murService: t.murService ?? relays.murService ?? false, sosService: t.sosService ?? relays.sosService ?? false,
      roomStatus: state.getRoomStateSnapshots(hotelId)[rn] ? 4 : (t.roomStatus ?? relays.roomStatus ?? 0),
      lastCleanedTime: t.lastCleanedTime ?? null, firmwareVersion: t.firmwareVersion ?? null,
      gatewayVersion: t.gatewayVersion ?? null, deviceStatus: t.deviceStatus ?? 0,
      pdMode: t.pdMode ?? relays.pdMode ?? false,
      relay1: relays.relay1 ?? false, relay2: relays.relay2 ?? false,
      relay3: relays.relay3 ?? false, relay4: relays.relay4 ?? false,
      relay5: relays.relay5 ?? false, relay6: relays.relay6 ?? false,
      relay7: relays.relay7 ?? false, relay8: relays.relay8 ?? false,
      doorUnlock: t.doorUnlock ?? relays.doorUnlock ?? false,
      reservation: ar ? { id: ar.id, guestName: ar.guest_name, checkIn: ar.check_in, checkOut: ar.check_out, paymentMethod: ar.payment_method } : null
    };
  });

  Object.assign(lastOverview, rooms);
  sseBroadcast(hotelId, 'snapshot', { rooms, deviceCount: devices.length, timestamp: Date.now() });

  const todayCheckouts = _db.prepare('SELECT room, guest_name, check_out FROM reservations WHERE hotel_id=? AND check_out=? AND active=1').all(hotelId, today);
  if (todayCheckouts.length) {
    sseBroadcastRoles(hotelId, 'checkout_alert', { rooms: todayCheckouts, ts: Date.now() }, ['admin', 'frontdesk']);
  }

  // Start real-time subscription if not already active
  const WebSocket = require('ws');
  const sub = state.getPlatformSub(hotelId);
  if (!sub || (sub._ws && sub._ws.readyState > WebSocket.OPEN)) {
    const deviceIdToRoom = Object.fromEntries(
      Object.entries(deviceRoomMap).map(([rn, did]) => [did, rn])
    );
    startPlatformSubscription(hotelId, deviceIdToRoom)
      .catch(e => console.error(`[${hotelId}] Platform sub start error:`, e.message));
  }
}

module.exports = {
  init,
  setSceneEngine,
  processTelemetry,
  detectAndLogChanges,
  fetchAndBroadcast,
  startPlatformSubscription,
  extractRoom,
  parseTelemetry,
  TELEMETRY_KEYS,
  RELAY_KEYS,
  SHARED_CONTROL_KEYS,
  ROOM_TYPES,
  FLOOR_TYPE,
};
