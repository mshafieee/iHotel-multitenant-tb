/**
 * iHotel — IoT Platform Adapter Interface
 *
 * Abstract base class that defines the contract every IoT platform must implement.
 * Business logic talks ONLY to this interface — never to ThingsBoard, Greentech, or
 * AWS IoT directly.
 *
 * Concrete implementations:
 *   - tb-adapter.js      (ThingsBoard CE/Cloud)
 *   - greentech-adapter.js (Greentech GRMS — future)
 *   - aws-adapter.js     (AWS IoT Core — future)
 */

class PlatformAdapter {
  /**
   * @param {object} config  Platform-specific credentials/config
   *   For TB:       { host, username, password }
   *   For Greentech: { host, username, password }
   *   For AWS:      { region, iotEndpoint, credentials }
   */
  constructor(config) {
    if (new.target === PlatformAdapter) {
      throw new Error('PlatformAdapter is abstract — use a concrete implementation');
    }
    this.config = config;
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  /** Obtain / refresh auth token. Called automatically by other methods. */
  async authenticate() { throw new Error('Not implemented: authenticate()'); }

  /** Returns true if the adapter has valid, unexpired credentials. */
  isAuthenticated() { throw new Error('Not implemented: isAuthenticated()'); }

  // ── Device discovery ────────────────────────────────────────────────────────

  /**
   * List all room devices managed by this platform instance.
   * @returns {Promise<Array<{ id: string, name: string, roomNumber: string }>>}
   *   Each entry has a platform-native device ID, display name, and extracted room number.
   */
  async listDevices() { throw new Error('Not implemented: listDevices()'); }

  // ── Telemetry / state reads ─────────────────────────────────────────────────

  /**
   * Read current state for a single device.
   * @param {string} deviceId  Platform-native device ID
   * @param {string[]} keys    Telemetry/attribute keys to read
   * @returns {Promise<object>}  { key: value, ... }
   */
  async getDeviceState(deviceId, keys) { throw new Error('Not implemented: getDeviceState()'); }

  /**
   * Batch-read current state for multiple devices.
   * @param {string[]} deviceIds
   * @param {string[]} keys
   * @returns {Promise<object>}  { [deviceId]: { key: value, ... }, ... }
   */
  async getAllDeviceStates(deviceIds, keys) { throw new Error('Not implemented: getAllDeviceStates()'); }

  /**
   * Read shared/server-side attributes for a device.
   * @param {string} deviceId
   * @param {string[]} keys
   * @returns {Promise<object>}  { key: value, ... }
   */
  async getDeviceAttributes(deviceId, keys) { throw new Error('Not implemented: getDeviceAttributes()'); }

  // ── Control / writes ────────────────────────────────────────────────────────

  /**
   * Send a control command to a device (lights, AC, curtains, etc).
   * The adapter translates from iHotel's canonical data model to the platform's
   * native command format.
   *
   * @param {string} deviceId   Platform-native device ID
   * @param {object} telemetry  iHotel telemetry keys to set (e.g. { line1: true, acMode: 2 })
   * @returns {Promise<void>}
   */
  async sendTelemetry(deviceId, telemetry) { throw new Error('Not implemented: sendTelemetry()'); }

  /**
   * Persist shared/server-side attributes on a device.
   * Used for relay states, scene payloads, firmware config.
   *
   * @param {string} deviceId
   * @param {object} attributes  { key: value, ... }
   * @returns {Promise<void>}
   */
  async sendAttributes(deviceId, attributes) { throw new Error('Not implemented: sendAttributes()'); }

  // ── Real-time subscription ──────────────────────────────────────────────────

  /**
   * Subscribe to real-time device state changes.
   * The adapter is responsible for reconnection on failure.
   *
   * @param {object} deviceIdToRoom  { [deviceId]: roomNumber, ... }
   * @param {Function} onUpdate      (roomNumber, deviceId, data) => void
   * @returns {Promise<{ close: Function }>}  Handle with a close() method to unsubscribe.
   *   Returns null if the platform doesn't support real-time push.
   */
  async subscribe(deviceIdToRoom, onUpdate) { return null; }

  // ── Command verification ────────────────────────────────────────────────────

  /**
   * Verify that a device has applied a command by reading back its state.
   * Returns true if all expected keys match.
   *
   * @param {string} deviceId
   * @param {object} expected  { key: expectedValue, ... }
   * @returns {Promise<boolean>}
   */
  async verifyCommand(deviceId, expected) {
    try {
      const attrs = await this.getDeviceAttributes(deviceId, Object.keys(expected));
      for (const [key, val] of Object.entries(expected)) {
        if (attrs[key] !== undefined && String(attrs[key]) !== String(val)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Capabilities ────────────────────────────────────────────────────────────

  /**
   * Declare what this platform supports. Business logic uses this to gracefully
   * degrade features that aren't available on every platform.
   *
   * @returns {object}
   *   {
   *     realtime:        boolean,  // supports WebSocket / push subscription
   *     sensors:         string[], // available sensor types: temperature, humidity, co2, pir, door, etc.
   *     meters:          boolean,  // electricity + water consumption
   *     commandVerify:   boolean,  // can read back attributes to verify commands
   *     offlineScenes:   boolean,  // can push scene configs to device firmware
   *     relayAttributes: boolean,  // supports relay1-8 shared attributes
   *     doorLock:        boolean,  // can control door lock
   *   }
   */
  getCapabilities() {
    return {
      realtime:        false,
      sensors:         [],
      meters:          false,
      commandVerify:   false,
      offlineScenes:   false,
      relayAttributes: false,
      doorLock:        false,
    };
  }

  // ── WebSocket token (platform-specific, used by WS proxy) ──────────────────

  /** Return the raw auth token for WS proxy connections. Null if not applicable. */
  getWsToken() { return null; }

  /** Return the WS URL for direct client connections. Null if not applicable. */
  getWsUrl() { return null; }
}


// ── Adapter Pool ──────────────────────────────────────────────────────────────
// Manages one adapter instance per hotel. Creates on first use, caches until
// credentials change (invalidate).

class AdapterPool {
  /**
   * @param {object} adapterRegistry  Map of platform type → adapter class.
   *   e.g. { thingsboard: TBAdapter, greentech: GreentechAdapter }
   *   Each hotel row's platform_type column selects which class to instantiate.
   */
  constructor(adapterRegistry) {
    this._registry = adapterRegistry;
    this._pool = new Map(); // Map<hotelId, PlatformAdapter>
  }

  /**
   * Get (or create) an adapter for a hotel.
   * Reads platform_type from the hotels table to select the right adapter class.
   * @param {string} hotelId
   * @param {object} db  better-sqlite3 database instance
   * @returns {PlatformAdapter|null}
   */
  getAdapter(hotelId, db) {
    if (this._pool.has(hotelId)) return this._pool.get(hotelId);

    const hotel = db.prepare(
      'SELECT iot_host, iot_user, iot_pass, tb_host, tb_user, tb_pass, platform_type FROM hotels WHERE id = ? AND active = 1'
    ).get(hotelId);

    if (!hotel) return null;

    const host = hotel.iot_host || hotel.tb_host;
    const user = hotel.iot_user || hotel.tb_user;
    const pass = hotel.iot_pass || hotel.tb_pass;
    if (!host || !user || !pass) return null;

    const platformType = hotel.platform_type || 'thingsboard';
    const AdapterClass = this._registry[platformType];
    if (!AdapterClass) {
      throw new Error(`Unknown platform_type "${platformType}" for hotel ${hotelId}. Available: ${Object.keys(this._registry).join(', ')}`);
    }

    const adapter = new AdapterClass({ host, username: user, password: pass });
    this._pool.set(hotelId, adapter);
    return adapter;
  }

  /** Invalidate a hotel's cached adapter (call after credentials or platform_type update). */
  invalidate(hotelId) {
    this._pool.delete(hotelId);
  }

  /** Check whether a hotel has IoT platform credentials configured. */
  hasCredentials(hotelId, db) {
    const hotel = db.prepare(
      'SELECT iot_host, iot_user, iot_pass, tb_host, tb_user, tb_pass FROM hotels WHERE id = ? AND active = 1'
    ).get(hotelId);
    if (!hotel) return false;
    const host = hotel.iot_host || hotel.tb_host;
    const user = hotel.iot_user || hotel.tb_user;
    const pass = hotel.iot_pass || hotel.tb_pass;
    return !!(host && user && pass);
  }
}


module.exports = { PlatformAdapter, AdapterPool };
