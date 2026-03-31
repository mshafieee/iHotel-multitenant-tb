/**
 * iHotel — Scene Engine
 *
 * Handles automation scenes: event-triggered and time-scheduled.
 *   - executeScene()       — run a scene's action list sequentially with delays
 *   - checkEventScenes()   — match incoming telemetry against event-based triggers
 *   - startTimeScheduler() — 60s interval for time-based triggers
 *
 * Depends on: control.service (sendControl), state.service (deviceRoomMap)
 */
const state = require('./state.service');

let _db = null;
let _controlService = null;

function init(db, controlService) {
  _db = db;
  _controlService = controlService;
}

// ── Scene execution ───────────────────────────────────────────────────────────

async function executeScene(hotelId, scene, triggeredBy = 'auto', roomOverride = null) {
  const targetRoom = roomOverride || scene.room_number;
  const deviceRoomMap = state.getDeviceRoomMap(hotelId);
  const devId = deviceRoomMap[targetRoom];
  if (!devId) {
    console.warn(`[scene] "${scene.name}": no device for room ${targetRoom}`);
    return;
  }
  try {
    _db.prepare("UPDATE scenes SET last_run = datetime('now') WHERE id = ?").run(scene.id);

    for (const action of scene.actions) {
      if ((action.delay || 0) > 0) {
        await new Promise(r => setTimeout(r, action.delay * 1000));
      }
      if (action.type === 'delay') continue;
      await _controlService.sendControl(hotelId, devId, action.type, action.params || {}, `scene:${scene.name}`);
    }
  } catch (e) {
    console.error(`[scene] "${scene.name}" exec error:`, e.message);
  }
}

// ── Value normalization ───────────────────────────────────────────────────────

function normalizeSensorVal(v) {
  if (v === true  || v === 'true'  || v === 'True')  return 1;
  if (v === false || v === 'false' || v === 'False') return 0;
  const n = Number(v);
  return isNaN(n) ? String(v) : n;
}

// ── Event-based trigger check ─────────────────────────────────────────────────

function checkEventScenes(hotelId, roomNum, updates, prevState = {}) {
  try {
    const sceneRows = _db.prepare(
      "SELECT * FROM scenes WHERE hotel_id=? AND (room_number=? OR is_shared=1) AND enabled=1 AND trigger_type='event'"
    ).all(hotelId, roomNum);

    for (const sceneRow of sceneRows) {
      try {
        const cfg = JSON.parse(sceneRow.trigger_config);
        const { event: eventKey, operator = 'eq', value: eventValue, fromValues } = cfg;
        if (!eventKey || !(eventKey in updates)) continue;

        const actual   = normalizeSensorVal(updates[eventKey]);
        const expected = normalizeSensorVal(eventValue);
        let matches = false;
        if      (operator === 'eq')     matches = actual === expected;
        else if (operator === 'neq')    matches = actual !== expected;
        else if (operator === 'change') matches = true;

        if (matches && Array.isArray(fromValues) && fromValues.length > 0) {
          if (eventKey in prevState) {
            const prev = normalizeSensorVal(prevState[eventKey]);
            matches = fromValues.some(fv => normalizeSensorVal(fv) === prev);
          } else {
            matches = false;
          }
        }

        if (matches) {
          const scene = { ...sceneRow, actions: JSON.parse(sceneRow.actions) };
          const roomOverride = sceneRow.is_shared ? roomNum : null;
          executeScene(hotelId, scene, `event:${eventKey}=${updates[eventKey]}`, roomOverride).catch(() => {});
        }
      } catch {}
    }
  } catch {}
}

// ── Time-based scheduler ──────────────────────────────────────────────────────

let _timeInterval = null;

function startTimeScheduler() {
  if (_timeInterval) return;
  _timeInterval = setInterval(() => {
    const now     = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const DAY     = ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];

    try {
      const rows = _db.prepare("SELECT * FROM scenes WHERE enabled=1 AND trigger_type='time'").all();
      for (const row of rows) {
        try {
          const cfg = JSON.parse(row.trigger_config);
          if (cfg.time !== timeStr) continue;
          if (cfg.days && cfg.days.length && !cfg.days.includes(DAY)) continue;
          const scene = { ...row, actions: JSON.parse(row.actions) };
          if (row.is_shared) {
            const deviceRoomMap = state.getDeviceRoomMap(row.hotel_id);
            for (const roomNum of Object.keys(deviceRoomMap)) {
              executeScene(row.hotel_id, scene, `time:${timeStr}`, roomNum).catch(() => {});
            }
          } else {
            executeScene(row.hotel_id, scene, `time:${timeStr}`).catch(() => {});
          }
        } catch {}
      }
    } catch {}
  }, 60_000);
}

function stopTimeScheduler() {
  if (_timeInterval) { clearInterval(_timeInterval); _timeInterval = null; }
}

module.exports = {
  init,
  executeScene,
  checkEventScenes,
  startTimeScheduler,
  stopTimeScheduler,
};
