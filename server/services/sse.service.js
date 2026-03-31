/**
 * iHotel — SSE Broadcast Service
 *
 * Manages Server-Sent Event client connections and provides broadcast methods
 * with a batching layer that accumulates telemetry and log updates, then flushes
 * them as single SSE events every BATCH_INTERVAL_MS.
 */

const SSE_BATCH_INTERVAL_MS = 500;

// ── Client registry ───────────────────────────────────────────────────────────
const sseClients = new Map(); // Map<res, { userId, username, role, hotelId, room }>

// ── Batching state ────────────────────────────────────────────────────────────
const _sseTelemetryBatch = {}; // { [hotelId]: { [roomNum]: { deviceId, data } } }
const _sseLogBatch       = {}; // { [hotelId]: [ entry, ... ] }
const _sseBatchTimers    = {}; // { [hotelId]: timer }

// ── Service alert deduplication ───────────────────────────────────────────────
const _serviceAlertCooldown = {}; // key: `${hotelId}:${type}:${room}` → lastFiredMs

// ── Connect an SSE client ─────────────────────────────────────────────────────
function sseConnect(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(':\n\n');
  sseClients.set(res, {
    userId: req.user?.id,
    username: req.user?.username,
    role: req.user?.role,
    hotelId: req.user?.hotelId,
    room: req.user?.room || null
  });
  req.on('close', () => sseClients.delete(res));
}

// ── Broadcast to all hotel staff (guests get filtered to their room) ──────────
function sseBroadcast(hotelId, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    // Guests receive telemetry ONLY for their own room
    if (meta.role === 'guest') {
      if (event === 'telemetry' && data.room === meta.room) {
        try { c.write(msg); } catch {}
      } else if (event === 'batch-telemetry' && meta.room && data.rooms?.[meta.room]) {
        const roomData = data.rooms[meta.room];
        const guestMsg = `event: telemetry\ndata: ${JSON.stringify({ room: meta.room, deviceId: roomData.deviceId, data: roomData.data })}\n\n`;
        try { c.write(guestMsg); } catch {}
      }
      continue;
    }
    try { c.write(msg); } catch {}
  }
}

// ── Broadcast alert (skips owners) ────────────────────────────────────────────
function sseBroadcastAlert(hotelId, data) {
  const msg = `event: alert\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    if (meta.role === 'owner') continue;
    try { c.write(msg); } catch {}
  }
}

// ── Broadcast to specific roles ───────────────────────────────────────────────
function sseBroadcastRoles(hotelId, event, data, roles) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    if (!roles.includes(meta.role)) continue;
    try { c.write(msg); } catch {}
  }
}

// ── Broadcast to one specific user ────────────────────────────────────────────
function sseBroadcastUser(hotelId, username, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [c, meta] of sseClients) {
    if (meta.hotelId !== hotelId) continue;
    if (meta.username !== username) continue;
    try { c.write(msg); } catch {}
  }
}

// ── Batched telemetry ─────────────────────────────────────────────────────────
function sseBatchTelemetry(hotelId, roomNum, deviceId, data) {
  if (!_sseTelemetryBatch[hotelId]) _sseTelemetryBatch[hotelId] = {};
  const batch = _sseTelemetryBatch[hotelId];
  if (!batch[roomNum]) {
    batch[roomNum] = { deviceId, data: { ...data } };
  } else {
    Object.assign(batch[roomNum].data, data);
  }
  scheduleBatchFlush(hotelId);
}

// ── Batched log ───────────────────────────────────────────────────────────────
function sseBatchLog(hotelId, entry) {
  if (!_sseLogBatch[hotelId]) _sseLogBatch[hotelId] = [];
  _sseLogBatch[hotelId].push(entry);
  scheduleBatchFlush(hotelId);
}

// ── Flush timer ───────────────────────────────────────────────────────────────
function scheduleBatchFlush(hotelId) {
  if (_sseBatchTimers[hotelId]) return;
  _sseBatchTimers[hotelId] = setTimeout(() => {
    delete _sseBatchTimers[hotelId];
    flushBatch(hotelId);
  }, SSE_BATCH_INTERVAL_MS);
}

function flushBatch(hotelId) {
  const telBatch = _sseTelemetryBatch[hotelId];
  if (telBatch && Object.keys(telBatch).length) {
    delete _sseTelemetryBatch[hotelId];
    sseBroadcast(hotelId, 'batch-telemetry', { rooms: telBatch });
  }

  const logBatch = _sseLogBatch[hotelId];
  if (logBatch && logBatch.length) {
    delete _sseLogBatch[hotelId];
    sseBroadcast(hotelId, 'batch-log', { entries: logBatch });
  }
}

// ── Service alert with deduplication ──────────────────────────────────────────
function fireServiceAlert(hotelId, type, room, message) {
  const key = `${hotelId}:${type}:${room}`;
  const now = Date.now();
  if (_serviceAlertCooldown[key] && now - _serviceAlertCooldown[key] < 15000) return;
  _serviceAlertCooldown[key] = now;
  sseBroadcastAlert(hotelId, { type, room, message, ts: now });
}


module.exports = {
  sseConnect,
  sseBroadcast,
  sseBroadcastAlert,
  sseBroadcastRoles,
  sseBroadcastUser,
  sseBatchTelemetry,
  sseBatchLog,
  fireServiceAlert,
};
