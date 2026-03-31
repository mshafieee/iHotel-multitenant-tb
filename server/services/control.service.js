/**
 * iHotel — Device Control Service
 *
 * Central entry point for all room device commands. Translates high-level
 * methods (setLines, setAC, setCurtainsBlinds, etc.) into telemetry + relay
 * attributes, applies optimistic local updates, broadcasts via SSE, and
 * persists to the IoT platform in the background.
 *
 * Depends on:
 *   - adapters (via adapterPool)
 *   - state.service (in-memory caches)
 *   - sse.service (broadcast)
 *   - audit.service (logging)
 */
const state = require('./state.service');
const { sseBroadcast, sseBatchTelemetry, sseBroadcastRoles, fireServiceAlert } = require('./sse.service');
const { addLog } = require('./audit.service');

let _db = null;
let _adapterPool = null;
let _checkEventScenes = null; // injected to break circular dep with scene-engine

function init(db, adapterPool) {
  _db = db;
  _adapterPool = adapterPool;
}

function setSceneEngine(checkEventScenesFn) {
  _checkEventScenes = checkEventScenesFn;
}

function getAdapter(hotelId) {
  const adapter = _adapterPool.getAdapter(hotelId, _db);
  if (!adapter) throw new Error('Smart room control is not configured for this hotel. Contact the platform admin.');
  return adapter;
}

// ── Telemetry translation ─────────────────────────────────────────────────────

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
    if (data.dndService === true) data.murService = false;
    else if (data.murService === true) data.dndService = false;
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

// ── Activity detection ────────────────────────────────────────────────────────

function impliesActivity(method, params) {
  if (method === 'setDoorUnlock') return true;
  if (method === 'setService')    return true;
  if (method === 'setLines')      return !!(params.line1 || params.line2 || params.line3 || (params.dimmer1 || 0) > 0 || (params.dimmer2 || 0) > 0);
  if (method === 'setAC')         return (params.acMode || 0) > 0;
  if (method === 'setCurtainsBlinds') return (params.curtainsPosition || 0) > 0 || (params.blindsPosition || 0) > 0;
  return false;
}

// ── NOT_OCCUPIED automation ───────────────────────────────────────────────────

function startNotOccupiedTimer(hotelId, roomNum) {
  const timers        = state.getDoorOpenTimers(hotelId);
  const lastTelemetry = state.getLastKnownTelemetry(hotelId);
  const deviceRoomMap = state.getDeviceRoomMap(hotelId);

  clearTimeout(timers[roomNum]);
  timers[roomNum] = setTimeout(async () => {
    delete timers[roomNum];
    const t = lastTelemetry[roomNum];
    if (!t || t.roomStatus !== 1) return;
    if (t.pirMotionStatus) return;
    const devId = deviceRoomMap[roomNum];
    if (!devId) return;
    try {
      const snapshots = state.getRoomStateSnapshots(hotelId);
      snapshots[roomNum] = {
        line1:            t.line1            ?? false,
        line2:            t.line2            ?? false,
        line3:            t.line3            ?? false,
        dimmer1:          t.dimmer1          ?? 0,
        dimmer2:          t.dimmer2          ?? 0,
        acMode:           t.acMode           ?? 0,
        acTemperatureSet: t.acTemperatureSet ?? 22,
        fanSpeed:         t.fanSpeed         ?? 0,
        curtainsPosition: t.curtainsPosition ?? 0,
        blindsPosition:   t.blindsPosition   ?? 0,
      };
      await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 4 }, 'auto');
      sseBroadcastRoles(hotelId, 'checkout_alert', { type: 'NOT_OCCUPIED', room: roomNum, ts: Date.now() }, ['owner', 'admin', 'frontdesk']);
    } catch (e) { console.error('NOT_OCCUPIED set failed:', e.message); }
  }, 5 * 60 * 1000);
}

async function restoreOccupied(hotelId, roomNum) {
  const timers        = state.getDoorOpenTimers(hotelId);
  const lastTelemetry = state.getLastKnownTelemetry(hotelId);
  const deviceRoomMap = state.getDeviceRoomMap(hotelId);

  clearTimeout(timers[roomNum]);
  delete timers[roomNum];
  const devId     = deviceRoomMap[roomNum];
  if (!devId) return;
  const curStatus = lastTelemetry[roomNum]?.roomStatus;
  if (curStatus !== 4) return;
  try {
    const snapshots = state.getRoomStateSnapshots(hotelId);
    const snap      = snapshots[roomNum];
    if (snap) delete snapshots[roomNum];

    await sendControl(hotelId, devId, 'setRoomStatus', { roomStatus: 1 }, 'auto');

    if (snap) {
      await sendControl(hotelId, devId, 'setLines',
        { line1: snap.line1, line2: snap.line2, line3: snap.line3,
          dimmer1: snap.dimmer1, dimmer2: snap.dimmer2 }, 'auto');
      await sendControl(hotelId, devId, 'setAC',
        { acMode: snap.acMode, acTemperatureSet: snap.acTemperatureSet,
          fanSpeed: snap.fanSpeed }, 'auto');
      await sendControl(hotelId, devId, 'setCurtainsBlinds',
        { curtainsPosition: snap.curtainsPosition,
          blindsPosition: snap.blindsPosition }, 'auto');
    } else {
      if (_checkEventScenes) _checkEventScenes(hotelId, roomNum, { roomStatus: 1 }, { roomStatus: 4 });
    }
  } catch (e) { console.error(`restoreOccupied ${roomNum} failed:`, e.message); }
}

async function vacateRoom(hotelId, devId, roomNum, targetStatus, username) {
  await sendControl(hotelId, devId, 'setLines',          { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 }, username);
  await sendControl(hotelId, devId, 'setAC',             { acMode: 1, acTemperatureSet: 26, fanSpeed: 0 }, username);
  await sendControl(hotelId, devId, 'setCurtainsBlinds', { curtainsPosition: 0, blindsPosition: 0 }, username);
  await sendControl(hotelId, devId, 'setRoomStatus',     { roomStatus: targetStatus }, username);
}

// ── Core sendControl ──────────────────────────────────────────────────────────

async function sendControl(hotelId, deviceId, method, params, username = 'system') {
  const telemetry = controlToTelemetry(method, params);
  if (!Object.keys(telemetry).length) throw new Error('Unknown method: ' + method);

  const relayAttrs  = controlToRelayAttributes(telemetry);
  const sharedAttrs = { ...relayAttrs };
  const FORWARD = ['line1','line2','line3','dimmer1','dimmer2','acMode','acTemperatureSet','fanSpeed','curtainsPosition','blindsPosition','dndService','murService','sosService','roomStatus','doorUnlock'];
  for (const k of FORWARD) { if (k in telemetry) sharedAttrs[k] = telemetry[k]; }

  const deviceRoomMap = state.getDeviceRoomMap(hotelId);
  const lastTelemetry = state.getLastKnownTelemetry(hotelId);
  const pdState       = state.getRoomPDState(hotelId);
  const roomNum       = Object.keys(deviceRoomMap).find(k => deviceRoomMap[k] === deviceId) || '?';

  // Check activity against PREVIOUS status
  const isSystemCmd = username === 'auto' || username === 'system'
    || username.startsWith('scene:') || username.startsWith('event:');
  if (!isSystemCmd && impliesActivity(method, params) && lastTelemetry[roomNum]?.roomStatus === 4) {
    setImmediate(() => restoreOccupied(hotelId, roomNum));
  }

  // ── Optimistic update ───────────────────────────────────────────────────────
  lastTelemetry[roomNum] = { ...(lastTelemetry[roomNum] || {}), ...telemetry };
  if ('pdMode' in telemetry) pdState[roomNum] = !!telemetry.pdMode;
  if ('roomStatus' in telemetry && telemetry.roomStatus !== 4) {
    delete state.getRoomStateSnapshots(hotelId)[roomNum];
  }
  const lastOverview = state.getLastOverviewRooms(hotelId);
  if (lastOverview[roomNum]) Object.assign(lastOverview[roomNum], telemetry);
  if (telemetry.murService) fireServiceAlert(hotelId, 'MUR', roomNum, `Room ${roomNum}: Housekeeping`);
  if (telemetry.sosService) fireServiceAlert(hotelId, 'SOS', roomNum, `EMERGENCY Room ${roomNum}`);
  sseBroadcast(hotelId, 'telemetry', { room: roomNum, deviceId, data: { ...telemetry, ...sharedAttrs } });

  // ── Persist to IoT platform (background, non-blocking) ─────────────────────
  const adapter = getAdapter(hotelId);
  adapter.sendTelemetry(deviceId, telemetry).catch(e => console.error('Platform telemetry write failed:', e.message));
  if (Object.keys(sharedAttrs).length) {
    adapter.sendAttributes(deviceId, sharedAttrs).catch(e => console.error('Platform attr write failed:', e.message));
  }

  // ── NOT_OCCUPIED power save ─────────────────────────────────────────────────
  if (telemetry.roomStatus === 4) {
    const BOOKED_POWER_SAVE = {
      line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0,
      acMode: 1, acTemperatureSet: 26, fanSpeed: 0
    };
    lastTelemetry[roomNum] = { ...(lastTelemetry[roomNum] || {}), ...BOOKED_POWER_SAVE };
    if (lastOverview[roomNum]) Object.assign(lastOverview[roomNum], BOOKED_POWER_SAVE);
    sseBatchTelemetry(hotelId, roomNum, deviceId, BOOKED_POWER_SAVE);
    adapter.sendTelemetry(deviceId, BOOKED_POWER_SAVE).catch(e => console.error('Power-save telemetry write failed:', e.message));
    adapter.sendAttributes(deviceId, BOOKED_POWER_SAVE).catch(e => console.error('Power-save attr write failed:', e.message));
  }

  // ── Command verification (if platform supports it) ──────────────────────────
  const caps = adapter.getCapabilities();
  const verifyKeys = Object.keys(sharedAttrs);
  if (caps.commandVerify && verifyKeys.length > 0) {
    setTimeout(async () => {
      try {
        const allOk = await adapter.verifyCommand(deviceId, sharedAttrs);
        sseBroadcast(hotelId, 'command-ack', {
          room: roomNum, deviceId, method, success: allOk,
          message: allOk ? 'confirmed' : 'mismatch'
        });
      } catch (e) {
        sseBroadcast(hotelId, 'command-ack', {
          room: roomNum, deviceId, method, success: false,
          message: `verify failed: ${e.message}`
        });
      }
    }, 2000);
  }

  return { success: true, written: telemetry };
}

// ── Telemetry coercion (used by simulator) ────────────────────────────────────

function coerceTelemetry(telemetry) {
  const out = {};
  for (const [k, v] of Object.entries(telemetry)) {
    if (v === '' || v === null || v === undefined) continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (['roomStatus','acMode','fanSpeed','dimmer1','dimmer2','curtainsPosition','blindsPosition'].includes(k)) out[k] = parseInt(v);
    else if (['temperature','humidity','co2','acTemperatureSet','elecConsumption','waterConsumption'].includes(k)) out[k] = parseFloat(v);
    else if (['pirMotionStatus','doorStatus','line1','line2','line3','dndService','murService','sosService','pdMode'].includes(k)) out[k] = Boolean(v);
    else out[k] = v;
  }
  return out;
}


module.exports = {
  init,
  setSceneEngine,
  sendControl,
  controlToTelemetry,
  controlToRelayAttributes,
  impliesActivity,
  startNotOccupiedTimer,
  restoreOccupied,
  vacateRoom,
  coerceTelemetry,
};
