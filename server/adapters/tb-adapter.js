/**
 * iHotel — ThingsBoard Platform Adapter
 *
 * Wraps the ThingsBoard CE/Cloud REST + WebSocket API behind the standard
 * PlatformAdapter interface.  This is the default adapter — it supports all
 * iHotel features including real-time WebSocket, sensors, meters, relay
 * attributes, command verification, and offline scene push.
 */
const axios = require('axios');
const { PlatformAdapter } = require('./platform-adapter');

class TBAdapter extends PlatformAdapter {
  constructor(config) {
    super(config);
    this.host     = config.host.replace(/\/+$/, '');
    this.username = config.username;
    this.password = config.password;
    this.token    = null;
    this.tokenExp = 0;
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  async authenticate() {
    if (this.token && Date.now() < this.tokenExp) return;
    const r = await axios.post(`${this.host}/api/auth/login`,
      { username: this.username, password: this.password }, { timeout: 10000 });
    this.token    = r.data.token;
    this.tokenExp = Date.now() + 3500000; // ~58 min
    console.log(`✓ TB authenticated (${this.host})`);
  }

  isAuthenticated() {
    return !!(this.token && Date.now() < this.tokenExp);
  }

  _headers() {
    return { 'X-Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  // ── Device discovery ────────────────────────────────────────────────────────

  async listDevices() {
    await this.authenticate();
    const all = [];
    let page = 0, hasNext = true;
    while (hasNext) {
      const r = await axios.get(`${this.host}/api/tenant/devices`, {
        headers: this._headers(),
        params: { pageSize: 100, page, sortProperty: 'name', sortOrder: 'ASC' },
        timeout: 15000
      });
      all.push(...r.data.data);
      hasNext = r.data.hasNext;
      page++;
    }
    // Filter to gateway-room-* devices and normalize to adapter interface
    return all
      .filter(d => d.name.startsWith('gateway-room-'))
      .map(d => {
        const match = d.name.match(/^gateway-room-(.+)$/);
        return {
          id: d.id.id,           // TB uses { id: { id: 'uuid', entityType: 'DEVICE' } }
          name: d.name,
          roomNumber: match ? match[1] : null,
          _raw: d                // preserve original for backward compat
        };
      });
  }

  // ── Telemetry / state reads ─────────────────────────────────────────────────

  async getDeviceState(deviceId, keys) {
    await this.authenticate();
    try {
      const r = await axios.get(
        `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries`,
        { headers: this._headers(), params: { keys: keys.join(',') }, timeout: 10000 }
      );
      return this._parseTelemetryResponse(r.data);
    } catch {
      return {};
    }
  }

  async getAllDeviceStates(deviceIds, keys) {
    await this.authenticate();
    const results = {};
    // Process in batches of 20 for performance
    for (let i = 0; i < deviceIds.length; i += 20) {
      const batch = deviceIds.slice(i, i + 20);
      await Promise.all(batch.map(async id => {
        try {
          const r = await axios.get(
            `${this.host}/api/plugins/telemetry/DEVICE/${id}/values/timeseries`,
            { headers: this._headers(), params: { keys: keys.join(',') }, timeout: 10000 }
          );
          results[id] = r.data; // Return raw TB format for backward compat
        } catch { results[id] = {}; }
      }));
    }
    return results;
  }

  async getDeviceAttributes(deviceId, keys) {
    await this.authenticate();
    try {
      const r = await axios.get(
        `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/SHARED_SCOPE`,
        { headers: this._headers(), params: { keys: keys.join(',') }, timeout: 10000 }
      );
      // TB returns array of { key, value } — convert to flat object
      const result = {};
      if (Array.isArray(r.data)) {
        r.data.forEach(a => {
          let v = a.value;
          if (v === 'true') v = true;
          else if (v === 'false') v = false;
          else if (v !== null && v !== '' && !isNaN(v)) v = parseFloat(v);
          result[a.key] = v;
        });
      }
      return result;
    } catch {
      return {};
    }
  }

  // ── Control / writes ────────────────────────────────────────────────────────

  async sendTelemetry(deviceId, telemetry) {
    await this.authenticate();
    return axios.post(
      `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/ANY`,
      telemetry, { headers: this._headers(), timeout: 5000 }
    );
  }

  async sendAttributes(deviceId, attributes) {
    await this.authenticate();
    return axios.post(
      `${this.host}/api/plugins/telemetry/DEVICE/${deviceId}/attributes/SHARED_SCOPE`,
      attributes, { headers: this._headers(), timeout: 5000 }
    );
  }

  // ── Real-time subscription ──────────────────────────────────────────────────

  async subscribe(deviceIdToRoom, onUpdate) {
    if (!Object.keys(deviceIdToRoom).length) return null;

    await this.authenticate();
    const WebSocket = require('ws');

    // Build cmdId ↔ device mapping
    const cmdMap = new Map();
    let cmdId = 1;
    const allSubCmds = [];
    for (const [deviceId, roomNum] of Object.entries(deviceIdToRoom)) {
      cmdMap.set(cmdId, { deviceId, roomNum });
      allSubCmds.push({ entityType: 'DEVICE', entityId: deviceId, scope: 'LATEST_TELEMETRY', cmdId });
      cmdId++;
    }

    const wsUrl = this.host.replace(/^https?/, m => m === 'https' ? 'wss' : 'ws') +
                  `/api/ws/plugins/telemetry?token=${this.token}`;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      const BATCH = 100;
      for (let i = 0; i < allSubCmds.length; i += BATCH) {
        ws.send(JSON.stringify({ tsSubCmds: allSubCmds.slice(i, i + BATCH) }));
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg.subscriptionId || !msg.data) return;
        const info = cmdMap.get(msg.subscriptionId);
        if (!info) return;

        const parsed = {};
        for (const [key, arr] of Object.entries(msg.data)) {
          if (!Array.isArray(arr) || !arr.length) continue;
          let val = arr[0][1];
          if (val === 'true')       val = true;
          else if (val === 'false') val = false;
          else if (val !== null && val !== '' && !isNaN(val)) val = parseFloat(val);
          parsed[key] = val;
        }

        if (Object.keys(parsed).length) {
          onUpdate(info.roomNum, info.deviceId, parsed);
        }
      } catch {}
    });

    // Return a handle with close() for cleanup
    return {
      close: () => { try { ws.terminate(); } catch {} },
      _ws: ws  // expose for event binding (error, close) by the caller
    };
  }

  // ── Command verification ────────────────────────────────────────────────────

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

  getCapabilities() {
    return {
      realtime:        true,
      sensors:         ['temperature', 'humidity', 'co2', 'pir', 'door', 'doorLockBattery', 'doorContactsBattery', 'airQualityBattery', 'waterMeterBattery'],
      meters:          true,
      commandVerify:   true,
      offlineScenes:   true,
      relayAttributes: true,
      doorLock:        true,
    };
  }

  // ── WebSocket proxy support ─────────────────────────────────────────────────

  getWsToken() { return this.token; }

  // ── Device config (used for dynamic UI rendering) ───────────────────────────
  // TB doesn't expose per-room device topology, so we return standard defaults.
  async getDeviceConfig() {
    return {
      lamps: 3, dimmers: 2, ac: 1, curtains: 1, blinds: 1,
      lampNames:   ['Line 1 (Main)', 'Line 2 (Bedside)', 'Line 3 (Bath)'],
      dimmerNames: ['Dimmer 1', 'Dimmer 2'],
    };
  }

  getWsUrl() {
    return this.host.replace(/^https?/, m => m === 'https' ? 'wss' : 'ws') +
           `/api/ws/plugins/telemetry?token=${this.token}`;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _parseTelemetryResponse(raw) {
    const r = {};
    if (!raw) return r;
    for (const [key, arr] of Object.entries(raw)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      let val = arr[0].value !== undefined ? arr[0].value : arr[0];
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (!isNaN(val) && val !== '' && val !== null) val = parseFloat(val);
      r[key] = val;
    }
    return r;
  }
}


module.exports = { TBAdapter };
