/**
 * iHotel SaaS Platform — ThingsBoard Client
 * REST API wrapper for device management, telemetry, and attributes
 * Includes per-hotel client pool for multi-tenant deployments
 */
const axios = require('axios');

class ThingsBoardClient {
  constructor(host, username, password) {
    this.host     = host;
    this.username = username;
    this.password = password;
    this.token    = null;
    this.tokenExp = 0;
  }

  async ensureAuth() {
    if (this.token && Date.now() < this.tokenExp) return;
    const r = await axios.post(`${this.host}/api/auth/login`,
      { username: this.username, password: this.password }, { timeout: 10000 });
    this.token    = r.data.token;
    this.tokenExp = Date.now() + 3500000; // ~58 min
    console.log(`✓ ThingsBoard authenticated (${this.host})`);
  }

  headers() {
    return { 'X-Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async getDevices() {
    await this.ensureAuth();
    const all = [];
    let page = 0, hasNext = true;
    while (hasNext) {
      const r = await axios.get(`${this.host}/api/tenant/devices`, {
        headers: this.headers(),
        params: { pageSize: 100, page, sortProperty: 'name', sortOrder: 'ASC' },
        timeout: 15000
      });
      all.push(...r.data.data);
      hasNext = r.data.hasNext;
      page++;
    }
    return all.filter(d => d.name.startsWith('gateway-room-'));
  }

  async getAllTelemetry(deviceIds, keys) {
    await this.ensureAuth();
    const results = {};
    for (let i = 0; i < deviceIds.length; i += 20) {
      const batch = deviceIds.slice(i, i + 20);
      await Promise.all(batch.map(async id => {
        try {
          const r = await axios.get(
            `${this.host}/api/plugins/telemetry/DEVICE/${id}/values/timeseries`,
            { headers: this.headers(), params: { keys: keys.join(',') }, timeout: 10000 }
          );
          results[id] = r.data;
        } catch { results[id] = {}; }
      }));
    }
    return results;
  }

  async saveTelemetry(deviceId, data) {
    await this.ensureAuth();
    return axios.post(
      `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/ANY`,
      data, { headers: this.headers(), timeout: 5000 }
    );
  }

  async saveAttributes(deviceId, data) {
    await this.ensureAuth();
    return axios.post(
      `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/attributes/SHARED_SCOPE`,
      data, { headers: this.headers(), timeout: 5000 }
    );
  }

  async getSharedAttributes(deviceId, keys) {
    await this.ensureAuth();
    return (await axios.get(
      `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/SHARED_SCOPE`,
      { headers: this.headers(), params: { keys: keys.join(',') }, timeout: 10000 }
    )).data;
  }

  getWsToken() { return this.token; }
}

// ── Per-hotel client pool ─────────────────────────────────────────────────────
// Stores one authenticated TB client per hotel (keyed by hotelId).
// Clients are created on first use and cached until credentials change.
class ThingsBoardClientPool {
  constructor() {
    this._pool = new Map(); // Map<hotelId, ThingsBoardClient>
  }

  // Get (or create) TB client for a hotel. Reads credentials from DB.
  getClient(hotelId, db) {
    if (this._pool.has(hotelId)) return this._pool.get(hotelId);

    const hotel = db.prepare('SELECT tb_host, tb_user, tb_pass FROM hotels WHERE id = ? AND active = 1').get(hotelId);
    if (!hotel || !hotel.tb_host || !hotel.tb_user || !hotel.tb_pass) return null;

    const client = new ThingsBoardClient(hotel.tb_host, hotel.tb_user, hotel.tb_pass);
    this._pool.set(hotelId, client);
    return client;
  }

  // Invalidate a hotel's cached client (call after credentials update)
  invalidate(hotelId) {
    this._pool.delete(hotelId);
  }

  // Check whether a hotel has TB credentials configured
  hasCredentials(hotelId, db) {
    const hotel = db.prepare('SELECT tb_host, tb_user, tb_pass FROM hotels WHERE id = ? AND active = 1').get(hotelId);
    return !!(hotel && hotel.tb_host && hotel.tb_user && hotel.tb_pass);
  }
}

module.exports = { ThingsBoardClient, ThingsBoardClientPool };
