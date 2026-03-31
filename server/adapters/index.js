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
const { AdapterPool } = require('./platform-adapter');
const { TBAdapter }   = require('./tb-adapter');

// Registry of available adapters
const ADAPTERS = {
  thingsboard: TBAdapter,
  // greentech: GreentechAdapter,  // future
  // aws:       AWSAdapter,        // future
};

/**
 * Create an AdapterPool for the specified platform type.
 * @param {string} platformType  Key from ADAPTERS registry (default: 'thingsboard')
 * @returns {AdapterPool}
 */
function createPool(platformType = 'thingsboard') {
  const AdapterClass = ADAPTERS[platformType];
  if (!AdapterClass) {
    throw new Error(`Unknown IoT platform: "${platformType}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return new AdapterPool(AdapterClass);
}

module.exports = { createPool, ADAPTERS, AdapterPool, TBAdapter };
