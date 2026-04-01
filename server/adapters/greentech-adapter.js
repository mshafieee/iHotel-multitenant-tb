/**
 * iHotel — Greentech GRMS Platform Adapter
 *
 * Verified against live API (2026-04-01):
 *  - Auth:        POST /loginByRemote  → { token }
 *  - Hotel list:  GET  /system/dept/open/list  (no body)
 *  - Room list:   GET  /mqtt/room/list2        body: { hotelId: <int> }
 *  - Device list: GET  /mqtt/room/device/list2 body: { roomId: "<hostId>" }
 *  - Control:     PUT  /mqtt/room/device       body: { Id, turn, ... }
 *
 * IMPORTANT: room/list2 and device/list2 are GET requests that require a
 * JSON request body (not query params). axios `data:` is used for this.
 *
 * Status field values are Chinese characters:
 *  checkStatus: "入住" = occupied, "未入住" = vacant
 *  lockStatus:  "开"   = unlocked, "关"    = locked
 *  outStatus:   "开"   = DND on,   "关"    = DND off
 *  powerStatus: "开"   = power on, "关"    = power off
 *  hoststatus:  "1"    = online,   "0"     = offline
 *
 * AC field values are Chinese:
 *  modern:   "制热" = Heating, "制冷" = Cooling, "通风" = Ventilation
 *  fatSpeed: "自动" = Auto, "低风" = Low, "中风" = Medium, "高风" = High
 *  temperature: plain number string e.g. "25" (no °C suffix in real responses)
 */

const axios = require('axios');
const { PlatformAdapter } = require('./platform-adapter');

// ── Mapping tables (verified against live API) ────────────────────────────────

// iHotel acMode → Greentech modern (Chinese)
const AC_MODE_TO_GT = { 1: '制热', 2: '制冷', 3: '通风' };

// Greentech modern (Chinese) → iHotel acMode
const AC_MODE_FROM_GT = { '制热': 1, '制冷': 2, '通风': 3 };

// iHotel fanSpeed → Greentech fatSpeed (Chinese)
const FAN_SPEED_TO_GT = { 0: '自动', 1: '低风', 2: '中风', 3: '高风' };

// Greentech fatSpeed (Chinese) → iHotel fanSpeed
const FAN_SPEED_FROM_GT = { '自动': 0, '低风': 1, '中风': 2, '高风': 3,
                             'Auto': 0, 'Low': 1, 'Medium': 2, 'High': 3 }; // English fallback

// Service device keyword matching (deviceName is English in this hotel)
const SERVICE_KEYWORDS = {
  dndService: ['dnd', 'do not disturb'],
  murService: ['mur', 'housekeep', 'clean'],
  sosService: ['sos', 'emergency'],
};

// ── Adapter ───────────────────────────────────────────────────────────────────

class GreentechAdapter extends PlatformAdapter {
  constructor(config) {
    super(config);
    this.host      = config.host.replace(/\/+$/, '');
    this.username  = config.username;
    this.password  = config.password;
    this.token     = null;
    this.tokenExp  = 0;

    this._greentechHotelId = null;      // numeric hotel ID from dept list
    this._deviceCache   = new Map();    // hostId → device groups { d, tgd, wk, cl, cj, fw }
    this._roomListCache = null;
    this._roomListCacheExp = 0;
    this._lastPollState = new Map();    // hostId → flat state for change detection
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  async authenticate() {
    if (this.token && Date.now() < this.tokenExp) return;
    const r = await axios.post(`${this.host}/loginByRemote`,
      { username: this.username, password: this.password },
      { timeout: 10000 });
    if (!r.data?.token) throw new Error('Greentech auth: no token in response');
    this.token    = r.data.token;
    this.tokenExp = Date.now() + 3500000; // ~58 min
    console.log(`✓ Greentech authenticated (${this.host})`);
  }

  isAuthenticated() {
    return !!(this.token && Date.now() < this.tokenExp);
  }

  _headers() {
    // Greentech uses Authorization header (token value only, no "Bearer" prefix)
    return { 'Authorization': this.token, 'Content-Type': 'application/json' };
  }

  // ── Hotel / room list helpers ────────────────────────────────────────────────

  async _ensureHotelId() {
    if (this._greentechHotelId) return this._greentechHotelId;
    const r = await axios.get(`${this.host}/system/dept/open/list`,
      { headers: this._headers(), timeout: 15000 });
    const depts = Array.isArray(r.data) ? r.data : (r.data?.data || []);
    const dept  = depts[0] || {};
    // hotelId comes back as a number (e.g. 340)
    const id = dept.hotelId || dept.id || dept.deptId || null;
    this._greentechHotelId = id ?? null;
    console.log(`[Greentech] resolved hotelId: ${this._greentechHotelId}`);
    return this._greentechHotelId;
  }

  async _fetchRoomList(force = false) {
    const TTL = 60000; // 60 s cache
    if (!force && this._roomListCache && Date.now() < this._roomListCacheExp) {
      return this._roomListCache;
    }
    await this.authenticate();
    const hotelId = await this._ensureHotelId();
    if (!hotelId) throw new Error('Greentech: could not resolve hotel ID from dept list');

    // IMPORTANT: GET request with JSON body (not query params)
    const r = await axios.get(`${this.host}/mqtt/room/list2`,
      { headers: this._headers(), data: { hotelId }, timeout: 15000 });

    const rows = r.data?.data || r.data?.rows || [];
    console.log(`[Greentech] room list: ${rows.length} rooms`);
    this._roomListCache    = rows;
    this._roomListCacheExp = Date.now() + TTL;
    return rows;
  }

  _findRoomRow(hostId) {
    return (this._roomListCache || []).find(
      r => String(r.hostId ?? r.id) === String(hostId)
    ) || null;
  }

  // ── Device discovery ────────────────────────────────────────────────────────

  async listDevices() {
    await this.authenticate();
    const rows = await this._fetchRoomList(true);

    return rows.map(r => ({
      id:         String(r.hostId ?? r.id),
      name:       `gateway-room-${r.roomNum}`,
      roomNumber: String(r.roomNum),
      _raw: r,
    }));
  }

  // ── Device cache ────────────────────────────────────────────────────────────

  async _getDeviceGroups(hostId) {
    if (this._deviceCache.has(hostId)) return this._deviceCache.get(hostId);
    await this.authenticate();

    // IMPORTANT: GET request with JSON body
    const r = await axios.get(`${this.host}/mqtt/room/device/list2`,
      { headers: this._headers(), data: { roomId: hostId }, timeout: 10000 });

    const groups = r.data?.data || { d: [], tgd: [], wk: [], cl: [], cj: [], fw: [] };
    this._deviceCache.set(hostId, groups);
    return groups;
  }

  // ── Telemetry / state reads ─────────────────────────────────────────────────

  async getDeviceState(hostId, keys) {
    await this.authenticate();
    const roomRow = this._findRoomRow(hostId) || {};
    const groups  = await this._getDeviceGroups(hostId);
    return this._flattenTBFormat(this._buildTBFormat(roomRow, groups));
  }

  async getAllDeviceStates(deviceIds, keys) {
    await this.authenticate();
    await this._fetchRoomList(); // refresh room list once for the batch

    const results = {};
    for (let i = 0; i < deviceIds.length; i += 10) {
      const batch = deviceIds.slice(i, i + 10);
      await Promise.all(batch.map(async hostId => {
        try {
          const roomRow = this._findRoomRow(hostId) || {};
          const groups  = await this._getDeviceGroups(hostId);
          results[hostId] = this._buildTBFormat(roomRow, groups);
        } catch {
          results[hostId] = {};
        }
      }));
    }
    return results;
  }

  async getDeviceAttributes(hostId, keys) {
    return this.getDeviceState(hostId, keys);
  }

  // ── Control / writes ────────────────────────────────────────────────────────

  async sendTelemetry(hostId, telemetry) {
    await this.authenticate();
    await this._sendControl(hostId, telemetry);
  }

  async sendAttributes(hostId, attributes) {
    await this.authenticate();
    await this._sendControl(hostId, attributes);
  }

  async _sendControl(hostId, payload) {
    const groups   = await this._getDeviceGroups(hostId);
    const commands = this._translateToGreentechCommands(payload, groups);
    if (!commands.length) return;

    await Promise.all(commands.map(cmd =>
      axios.put(`${this.host}/mqtt/room/device`, cmd,
        { headers: this._headers(), timeout: 5000 })
        .catch(e => {
          if (e.response?.status === 404) this._deviceCache.delete(hostId);
          console.error(`[Greentech] Control failed (room ${hostId}):`, e.message);
        })
    ));
  }

  _translateToGreentechCommands(telemetry, groups) {
    const cmds = [];

    // Lamps (line1..lineN → d[0]..d[N-1])
    // Support any number of lamps dynamically
    const lampKeys = Object.keys(telemetry).filter(k => /^line\d+$/.test(k));
    lampKeys.forEach(key => {
      const i = parseInt(key.replace('line', '')) - 1;
      if (groups.d?.[i]) {
        cmds.push({ id: groups.d[i].id, turn: telemetry[key] ? 'ON' : 'OFF' });
      }
    });

    // Dimmers (dimmer1..dimmerN → tgd[0]..tgd[N-1])
    const dimmerKeys = Object.keys(telemetry).filter(k => /^dimmer\d+$/.test(k));
    dimmerKeys.forEach(key => {
      const i = parseInt(key.replace('dimmer', '')) - 1;
      if (groups.tgd?.[i]) {
        const val = Number(telemetry[key]);
        cmds.push({ id: groups.tgd[i].id, turn: val > 0 ? 'ON' : 'OFF', brightness: val });
      }
    });

    // AC — batch all AC keys into one command for wk[0]
    const acDev  = groups.wk?.[0];
    const acKeys = ['acMode', 'acTemperatureSet', 'fanSpeed'];
    if (acDev && acKeys.some(k => k in telemetry)) {
      const cmd = { id: acDev.id };
      if ('acMode' in telemetry) {
        const mode = Number(telemetry.acMode);
        if (mode === 0) {
          cmd.turn = 'OFF';
        } else {
          cmd.turn   = 'ON';
          cmd.modern = AC_MODE_TO_GT[mode] || '制冷';
        }
      }
      if ('acTemperatureSet' in telemetry) {
        // Send as plain number string (no °C — verified from live API)
        cmd.temperature = String(telemetry.acTemperatureSet);
      }
      if ('fanSpeed' in telemetry) {
        cmd.fatSpeed = FAN_SPEED_TO_GT[Number(telemetry.fanSpeed)] || '自动';
      }
      cmds.push(cmd);
    }

    // Curtains (curtainsPosition → cl[0], blindsPosition → cl[1])
    if ('curtainsPosition' in telemetry && groups.cl?.[0]) {
      cmds.push({ id: groups.cl[0].id, certain: Number(telemetry.curtainsPosition) > 0 ? 'open' : 'close' });
    }
    if ('blindsPosition' in telemetry && groups.cl?.[1]) {
      cmds.push({ id: groups.cl[1].id, certain: Number(telemetry.blindsPosition) > 0 ? 'open' : 'close' });
    }

    // Service flags (fw devices matched by deviceName keyword)
    for (const [iHotelKey, keywords] of Object.entries(SERVICE_KEYWORDS)) {
      if (iHotelKey in telemetry) {
        const dev = (groups.fw || []).find(d =>
          keywords.some(kw => (d.deviceName || '').toLowerCase().includes(kw))
        );
        if (dev) cmds.push({ id: dev.id, turn: telemetry[iHotelKey] ? 'ON' : 'OFF' });
      }
    }

    return cmds;
  }

  // ── Real-time subscription (polling) ────────────────────────────────────────

  async subscribe(deviceIdToRoom, onUpdate) {
    if (!Object.keys(deviceIdToRoom).length) return null;
    await this.authenticate();

    let _active = true;
    const POLL_INTERVAL = 30000; // 30 s

    const poll = async () => {
      if (!_active) return;
      try {
        await this.authenticate();
        await this._fetchRoomList(true);

        const hostIds = Object.keys(deviceIdToRoom);
        const states  = await this.getAllDeviceStates(hostIds, []);

        for (const [hostId, tbFmt] of Object.entries(states)) {
          if (!_active) break;
          const roomNum = deviceIdToRoom[hostId];
          if (!roomNum) continue;

          const flat    = this._flattenTBFormat(tbFmt);
          const prev    = this._lastPollState.get(hostId) || {};
          const changed = {};
          for (const [k, v] of Object.entries(flat)) {
            if (prev[k] !== v) changed[k] = v;
          }
          if (Object.keys(changed).length) {
            this._lastPollState.set(hostId, { ...prev, ...changed });
            onUpdate(roomNum, hostId, changed);
          }
        }
      } catch (e) {
        console.error('[Greentech] Poll error:', e.message);
      }
      if (_active) setTimeout(poll, POLL_INTERVAL);
    };

    setTimeout(poll, POLL_INTERVAL);

    return {
      _polling: true,
      _active:  () => _active,
      close:    () => { _active = false; },
    };
  }

  // ── Capabilities ────────────────────────────────────────────────────────────

  getCapabilities() {
    return {
      realtime:        false,
      sensors:         ['temperature'],  // curTemp from AC device
      meters:          false,
      commandVerify:   false,
      offlineScenes:   false,
      relayAttributes: false,
      doorLock:        false,
    };
  }

  getWsToken() { return null; }
  getWsUrl()   { return null; }

  // ── Device config (used for dynamic UI rendering) ───────────────────────────
  // Fetches device groups for the first available room to determine topology.
  async getDeviceConfig(firstRoomId) {
    try {
      await this.authenticate();
      const groups = await this._getDeviceGroups(firstRoomId);
      return {
        lamps:      (groups.d   || []).length,
        dimmers:    (groups.tgd || []).length,
        ac:         (groups.wk  || []).length > 0 ? 1 : 0,
        curtains:   (groups.cl  || []).length > 0 ? 1 : 0,
        blinds:     (groups.cl  || []).length > 1 ? 1 : 0,
        lampNames:  (groups.d   || []).map(d => d.deviceName || ''),
        dimmerNames:(groups.tgd || []).map(d => d.deviceName || ''),
      };
    } catch {
      return { lamps: 2, dimmers: 1, ac: 1, curtains: 1, blinds: 0, lampNames: [], dimmerNames: [] };
    }
  }

  // ── Debug (used by /discover/debug endpoint) ─────────────────────────────────

  async debugDiscovery() {
    await this.authenticate();
    const results = {};

    try {
      const r = await axios.get(`${this.host}/system/dept/open/list`,
        { headers: this._headers(), timeout: 15000 });
      results.deptList = r.data;
    } catch (e) { results.deptListError = e.message; }

    const hotelId = await this._ensureHotelId();
    results.resolvedHotelId = hotelId;

    try {
      const r = await axios.get(`${this.host}/mqtt/room/list2`,
        { headers: this._headers(), data: { hotelId }, timeout: 15000 });
      results.roomList = r.data;
    } catch (e) { results.roomListError = e.message; }

    // Fetch device list for the first room found
    const rows = results.roomList?.data || results.roomList?.rows || [];
    if (rows[0]) {
      const firstHostId = String(rows[0].hostId ?? rows[0].id);
      try {
        const r = await axios.get(`${this.host}/mqtt/room/device/list2`,
          { headers: this._headers(), data: { roomId: firstHostId }, timeout: 10000 });
        results.deviceListSample = { roomId: firstHostId, roomNum: rows[0].roomNum, data: r.data };
      } catch (e) { results.deviceListError = e.message; }
    }

    return results;
  }

  // ── Private translation helpers ──────────────────────────────────────────────

  /**
   * Build TB-array-format state from Greentech room + device data.
   * Shape: { key: [{ value: v }] } — compatible with parseTelemetry() in room.service.js
   */
  _buildTBFormat(roomRow, groups) {
    const tb   = {};
    const wrap = v => [{ value: v }];

    // ── Room-level status fields (Chinese values from live API) ────────────
    if (roomRow.checkStatus !== undefined) {
      // "入住" = checked-in (occupied), anything else = vacant
      tb.roomStatus = wrap(roomRow.checkStatus === '入住' ? 1 : 0);
    }
    if (roomRow.lockStatus !== undefined) {
      // "开" = unlocked/open, "关" = locked/closed
      tb.doorUnlock = wrap(roomRow.lockStatus === '开');
    }
    if (roomRow.outStatus !== undefined) {
      // "开" = DND active
      tb.dndService = wrap(roomRow.outStatus === '开');
    }
    if (roomRow.hoststatus !== undefined) {
      tb.deviceStatus = wrap(String(roomRow.hoststatus) === '1' ? 1 : 0);
    }
    if (roomRow.powerStatus !== undefined) {
      // "开" = main power/card power on
      tb.pdMode = wrap(roomRow.powerStatus !== '开'); // powerdown when card removed
    }
    if (roomRow.airStatus !== undefined) {
      // "开" = AC unit is running (actual running state, separate from setpoint)
      tb.acRunning = wrap(roomRow.airStatus === '开');
    }

    // ── Lamps (d[]) → line1 / line2 / ... (dynamic count) ────────────────
    (groups.d || []).forEach((dev, i) => {
      tb[`line${i + 1}`] = wrap(dev.turn === 'ON');
    });

    // ── Dimming lamps (tgd[]) → dimmer1 / dimmer2 / ... (dynamic) ────────
    (groups.tgd || []).forEach((dev, i) => {
      tb[`dimmer${i + 1}`] = wrap(dev.turn === 'ON' ? (dev.brightness ?? 100) : 0);
    });

    // ── AC (wk[0]) → acMode / acTemperatureSet / fanSpeed / temperature ───
    const ac = (groups.wk || [])[0];
    if (ac) {
      const isOn = ac.turn === 'ON';
      tb.acMode  = wrap(isOn ? (AC_MODE_FROM_GT[ac.modern] ?? 1) : 0);

      // temperature is a plain number string in real responses (e.g. "25")
      if (ac.temperature != null && ac.temperature !== '') {
        const setTemp = parseFloat(String(ac.temperature).replace('°C', '').trim());
        if (!isNaN(setTemp)) tb.acTemperatureSet = wrap(setTemp);
      }

      tb.fanSpeed = wrap(FAN_SPEED_FROM_GT[ac.fatSpeed] ?? 0);

      if (ac.curTemp != null && ac.curTemp !== '') {
        const cur = parseFloat(String(ac.curTemp));
        if (!isNaN(cur)) tb.temperature = wrap(cur);
      }
    }

    // ── Curtains (cl[]) → curtainsPosition / blindsPosition ───────────────
    const curtains = groups.cl || [];
    if (curtains[0]) tb.curtainsPosition = wrap(this._curtainPos(curtains[0].certain));
    if (curtains[1]) tb.blindsPosition   = wrap(this._curtainPos(curtains[1].certain));

    // ── Service flags (fw[]) ───────────────────────────────────────────────
    (groups.fw || []).forEach(dev => {
      const name = (dev.deviceName || '').toLowerCase();
      const on   = dev.turn === 'ON';
      for (const [iHotelKey, keywords] of Object.entries(SERVICE_KEYWORDS)) {
        if (keywords.some(kw => name.includes(kw))) tb[iHotelKey] = wrap(on);
      }
    });

    return tb;
  }

  _flattenTBFormat(tbFmt) {
    const flat = {};
    for (const [key, arr] of Object.entries(tbFmt)) {
      if (Array.isArray(arr) && arr.length > 0) flat[key] = arr[0].value;
    }
    return flat;
  }

  _curtainPos(certain) {
    if (!certain) return 0;
    const s = String(certain).toLowerCase();
    if (s === 'open')  return 100;
    if (s === 'close') return 0;
    if (s === 'stop')  return 50;
    return 0;
  }
}


module.exports = { GreentechAdapter };
