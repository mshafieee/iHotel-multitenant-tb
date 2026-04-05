/**
 * iHotel — Service Layer Initialization
 *
 * Wires all services together with proper dependency injection order.
 * Call initServices(db, adapterPool) once at startup.
 *
 * Handles the circular dependency between control ↔ scene-engine by using
 * late binding (setSceneEngine).
 */
const auditService   = require('./audit.service');
const controlService = require('./control.service');
const roomService    = require('./room.service');
const sceneEngine    = require('./scene-engine');
const sseService     = require('./sse.service');
const stateService   = require('./state.service');

/**
 * Initialize all services. Call once at server startup.
 * @param {object} db          better-sqlite3 database instance
 * @param {object} adapterPool AdapterPool instance from adapters/
 */
function initServices(db, adapterPool) {
  // 1. Audit (needs db only)
  auditService.init(db);

  // 2. Control (needs db + adapterPool; audit is already ready via require)
  controlService.init(db, adapterPool);

  // 3. Room (needs db + adapterPool + controlService)
  roomService.init(db, adapterPool, controlService);

  // 4. Scene engine (needs db + controlService + adapterPool for platform scene activation)
  sceneEngine.init(db, controlService, adapterPool);

  // 5. Wire circular deps: control and room both need checkEventScenes
  controlService.setSceneEngine(sceneEngine.checkEventScenes);
  roomService.setSceneEngine(sceneEngine.checkEventScenes);

  // 6. Start time-based scene scheduler
  sceneEngine.startTimeScheduler();

  console.log('✓ All services initialized');
}

module.exports = {
  initServices,
  // Re-export all services for convenient access
  audit:   auditService,
  control: controlService,
  room:    roomService,
  scene:   sceneEngine,
  sse:     sseService,
  state:   stateService,
};
