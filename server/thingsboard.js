/**
 * Hilton Grand Hotel — ThingsBoard Client
 * REST API wrapper for device management, telemetry, and attributes
 */
const axios = require('axios');

class ThingsBoardClient {
  constructor(host, username, password) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.token = null;
    this.tokenExp = 0;
  }

  async ensureAuth() {
    if (this.token && Date.now() < this.tokenExp) return;
    const r = await axios.post(`${this.host}/api/auth/login`,
      { username: this.username, password: this.password }, { timeout: 10000 });
    this.token = r.data.token;
    this.tokenExp = Date.now() + 3500000; // ~58 min
    console.log('✓ ThingsBoard authenticated');
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

module.exports = { ThingsBoardClient };
