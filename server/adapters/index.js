/**
 * iHotel — Adapter Registry
 *
 * Central module for selecting and instantiating the correct IoT platform adapter.
 * Import this instead of individual adapter files.
 *
 * Usage:
 *   const { createPool } = require('./adapters');
 *   const pool = createPool('thingsboard');  // or 'greentech', 'aws'
 *   const adapter = pool.getAdapter(hotelId, db);
 */
const { AdapterPool }       = require('./platform-adapter');
const { TBAdapter }         = require('./tb-adapter');
const { GreentechAdapter }  = require('./greentech-adapter');

// Registry of all supported IoT platforms.
// The hotels.platform_type column selects which class to use per hotel.
const ADAPTERS = {
  thingsboard: TBAdapter,
  greentech:   GreentechAdapter,
};

/**
 * Create a multi-platform AdapterPool.
 * Each hotel's platform_type DB column determines which adapter class is used.
 * @returns {AdapterPool}
 */
function createPool() {
  return new AdapterPool(ADAPTERS);
}

module.exports = { createPool, ADAPTERS, AdapterPool, TBAdapter, GreentechAdapter };
