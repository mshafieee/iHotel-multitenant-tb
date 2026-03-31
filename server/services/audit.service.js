/**
 * iHotel — Audit Log Service
 *
 * Centralized logging: writes to SQLite + pushes to SSE batch layer.
 * All modules import addLog() from here instead of defining it locally.
 */
const { sseBatchLog } = require('./sse.service');

let _db = null;

function init(db) { _db = db; }

/**
 * @param {string} hotelId
 * @param {string} category   'auth' | 'telemetry' | 'sensor' | 'service' | 'pms' | 'shift' | 'scene'
 * @param {string} message
 * @param {object} details    { room?, source?, user?, ...extra }
 */
function addLog(hotelId, category, message, details = {}) {
  const ts    = Date.now();
  const entry = { ts, cat: category, msg: message, ...details };
  try {
    _db.prepare(
      'INSERT INTO audit_log (hotel_id, ts, category, message, room, source, user, details) VALUES (?,?,?,?,?,?,?,?)'
    ).run(hotelId, ts, category, message, details.room || null, details.source || null, details.user || null, JSON.stringify(details));
  } catch (e) { console.error('Log DB error:', e.message); }
  sseBatchLog(hotelId, entry);
}

module.exports = { init, addLog };
