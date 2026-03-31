/**
 * iHotel — In-Memory State Service
 *
 * Manages per-hotel runtime state that lives in server memory between
 * IoT platform fetches. All state is keyed by hotelId and lazily initialized.
 *
 * This module owns NO business logic — it's pure storage with typed getters.
 */

// ── Per-hotel state maps ──────────────────────────────────────────────────────
const _deviceRoomMaps     = {}; // { [hotelId]: { [roomNum]: deviceId } }
const _lastOverviewRooms  = {}; // { [hotelId]: { [roomNum]: roomData } }
const _lastKnownTelemetry = {}; // { [hotelId]: { [roomNum]: telemetryObj } }
const _roomPDState        = {}; // { [hotelId]: { [roomNum]: bool } }
const _doorOpenTimers     = {}; // { [hotelId]: { [roomNum]: timerHandle } }
const _sleepTimers        = {}; // { [hotelId]: { [roomNum]: timerHandle } }
const _roomStateSnapshots = {}; // { [hotelId]: { [roomNum]: stateSnapshot } }
const _overviewFetchTs    = {}; // { [hotelId]: timestamp }
const _fetchingOverview   = new Set(); // hotelIds currently fetching
const _platformSubs       = {}; // { [hotelId]: subscription handle }

const OVERVIEW_CACHE_TTL  = 30_000; // ms

// ── Lazy getters ──────────────────────────────────────────────────────────────
function getDeviceRoomMap(hotelId)      { return (_deviceRoomMaps[hotelId]      ??= {}); }
function getLastOverviewRooms(hotelId)  { return (_lastOverviewRooms[hotelId]   ??= {}); }
function getLastKnownTelemetry(hotelId) { return (_lastKnownTelemetry[hotelId]  ??= {}); }
function getRoomPDState(hotelId)        { return (_roomPDState[hotelId]         ??= {}); }
function getDoorOpenTimers(hotelId)     { return (_doorOpenTimers[hotelId]      ??= {}); }
function getSleepTimers(hotelId)        { return (_sleepTimers[hotelId]         ??= {}); }
function getRoomStateSnapshots(hotelId) { return (_roomStateSnapshots[hotelId]  ??= {}); }

// ── Overview fetch tracking ───────────────────────────────────────────────────
function getOverviewFetchTs(hotelId)    { return _overviewFetchTs[hotelId] || 0; }
function setOverviewFetchTs(hotelId)    { _overviewFetchTs[hotelId] = Date.now(); }
function isOverviewStale(hotelId)       { return Date.now() - getOverviewFetchTs(hotelId) >= OVERVIEW_CACHE_TTL; }
function isFetchingOverview(hotelId)    { return _fetchingOverview.has(hotelId); }
function setFetchingOverview(hotelId)   { _fetchingOverview.add(hotelId); }
function clearFetchingOverview(hotelId) { _fetchingOverview.delete(hotelId); }

// ── Platform subscription tracking ────────────────────────────────────────────
function getPlatformSub(hotelId)        { return _platformSubs[hotelId] || null; }
function setPlatformSub(hotelId, sub)   { _platformSubs[hotelId] = sub; }
function deletePlatformSub(hotelId)     { delete _platformSubs[hotelId]; }


module.exports = {
  OVERVIEW_CACHE_TTL,
  getDeviceRoomMap,
  getLastOverviewRooms,
  getLastKnownTelemetry,
  getRoomPDState,
  getDoorOpenTimers,
  getSleepTimers,
  getRoomStateSnapshots,
  getOverviewFetchTs,
  setOverviewFetchTs,
  isOverviewStale,
  isFetchingOverview,
  setFetchingOverview,
  clearFetchingOverview,
  getPlatformSub,
  setPlatformSub,
  deletePlatformSub,
};
