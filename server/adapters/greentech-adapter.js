/**
 * iHotel — Greentech GRMS Platform Adapter
 *
 * Implements the PlatformAdapter interface for the Greentech GRMS system.
 * Greentech uses a REST API with per-room device lists and a single PUT endpoint
 * for control. No WebSocket push is available — state is obtained by polling.
 *
 * Key design decisions:
 *  - Greentech "room" (hostId) = iHotel "device".  Each room contains typed
 *    sub-devices (lamps, dimmers, AC, curtains, service buttons).
 *  - getAllDeviceStates() wraps data in TB-array format so room.service.js's
 *    parseTelemetry() works unchanged.
 *  - subscribe() returns a polling handle — no _ws property, so the WS
 *    event-binding in room.service.js is silently skipped.
 *  - Device IDs (Greentech's internal `id` field) are cached per room so that
 *    sendAttributes() can issue control commands without extra fetches.
 *
 * Greentech API base: https://www.lvhuarcu.com:4430
 */

const axios = require('axios');
const { PlatformAdapter } = require('./platform-adapter');

// ── Mapping tables ────────────────────────────────────────────────────────────

// iHotel acMode → Greentech modern string (acMode 0 means "off", handled via turn)
const AC_MODE_TO_GT   = { 1: 'Heating', 2: 'Cooling', 3: 'Ventilation' };

// Greentech modern string → iHotel acMode
const AC_MODE_FROM_GT = { Heating: 1, Cooling: 2, Ventilation: 3, Stroke: 0 };

// iHotel fanSpeed → Greentech fatSpeed string
const FAN_SPEED_TO_GT   = { 0: 'Stroke', 1: 'Low', 2: 'Medium', 3: 'High' };

// Greentech fatSpeed string → iHotel fanSpeed
const FAN_SPEED_FROM_GT = { Stroke: 0, Auto: 0, Low: 1, Medium: 2, High: 3 };

// Service device keyword matching
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

    this._greentechHotelId = null;          // Greentech's internal hotel ID
    this._deviceCache   = new Map();        // hostId → device groups { d, tgd, wk, cl, cj, fw }
    this._roomListCache = null;             // cached /mqtt/room/list2 rows
    this._roomListCacheExp = 0;
    this._lastPollState = new Map();        // hostId → flat state (for change detection)
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
    return { 'Authorization': this.token, 'Content-Type': 'application/json' };
  }

  // ── Hotel / room list helpers ────────────────────────────────────────────────

  async _ensureHotelId() {
    if (this._greentechHotelId) return this._greentechHotelId;
    const r = await axios.get(`${this.host}/system/dept/open/list`,
      { headers: this._headers(), timeout: 15000 });
    const depts = Array.isArray(r.data) ? r.data : (r.data?.data || []);
    this._greentechHotelId = depts[0]?.hotelId ?? null;
    return this._greentechHotelId;
  }

  async _fetchRoomList(force = false) {
    const TTL = 60000; // 60 s cache
    if (!force && this._roomListCache && Date.now() < this._roomListCacheExp) {
      return this._roomListCache;
    }
    await this.authenticate();
    const hotelId = await this._ensureHotelId();
    const r = await axios.get(`${this.host}/mqtt/room/list2`,
      { headers: this._headers(), params: { hotelId }, timeout: 15000 });
    this._roomListCache    = r.data?.rows || [];
    this._roomListCacheExp = Date.now() + TTL;
    return this._roomListCache;
  }

  _findRoomRow(hostId) {
    return (this._roomListCache || []).find(
      r => String(r.hostId ?? r.id) === String(hostId)
    ) || null;
  }

  // ── Device discovery ────────────────────────────────────────────────────────

  async listDevices() {
    await this.authenticate();
    const rows = await this._fetchRoomList(true); // force refresh on list

    return rows.map(r => {
      const id = String(r.hostId ?? r.id);
      return {
        id,
        name:       `gateway-room-${r.roomNum}`,
        roomNumber: String(r.roomNum),
        _raw: r,
      };
    });
  }

  // ── Device cache (for sendAttributes control) ────────────────────────────────

  async _getDeviceGroups(hostId) {
    if (this._deviceCache.has(hostId)) return this._deviceCache.get(hostId);
    await this.authenticate();
    const r = await axios.get(`${this.host}/mqtt/room/device/list2`,
      { headers: this._headers(), params: { roomId: hostId }, timeout: 10000 });
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
    await this._fetchRoomList(); // refresh room list once for the whole batch

    const results = {};
    // Batch 10 at a time to avoid overwhelming Greentech
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
    // Greentech has no separate "attributes" concept — delegate to getDeviceState
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

  // Translate iHotel canonical telemetry keys → Greentech PUT command objects
  _translateToGreentechCommands(telemetry, groups) {
    const cmds = [];

    // ── Lamps (line1/2/3) ──────────────────────────────────────────────────
    ['line1', 'line2', 'line3'].forEach((key, i) => {
      if (key in telemetry && groups.d?.[i]) {
        cmds.push({ Id: groups.d[i].id, turn: telemetry[key] ? 'ON' : 'OFF' });
      }
    });

    // ── Dimmers (dimmer1/2) ────────────────────────────────────────────────
    ['dimmer1', 'dimmer2'].forEach((key, i) => {
      if (key in telemetry && groups.tgd?.[i]) {
        const val = Number(telemetry[key]);
        cmds.push({ Id: groups.tgd[i].id, turn: val > 0 ? 'ON' : 'OFF', brightness: val });
      }
    });

    // ── AC (acMode / acTemperatureSet / fanSpeed) ──────────────────────────
    // All AC keys share one Greentech device (wk[0]) — batch into one command
    const acDev  = groups.wk?.[0];
    const acKeys = ['acMode', 'acTemperatureSet', 'fanSpeed'];
    if (acDev && acKeys.some(k => k in telemetry)) {
      const cmd = { Id: acDev.id };
      if ('acMode' in telemetry) {
        const mode = Number(telemetry.acMode);
        if (mode === 0) {
          cmd.turn = 'OFF';
        } else {
          cmd.turn   = 'ON';
          cmd.modern = AC_MODE_TO_GT[mode] || 'Cooling';
        }
      }
      if ('acTemperatureSet' in telemetry) {
        cmd.temperature = `${telemetry.acTemperatureSet}°C`;
      }
      if ('fanSpeed' in telemetry) {
        cmd.fatSpeed = FAN_SPEED_TO_GT[Number(telemetry.fanSpeed)] || 'Stroke';
      }
      cmds.push(cmd);
    }

    // ── Curtains / blinds (cl[0]/cl[1]) ───────────────────────────────────
    if ('curtainsPosition' in telemetry && groups.cl?.[0]) {
      cmds.push({ Id: groups.cl[0].id, certain: Number(telemetry.curtainsPosition) > 0 ? 'open' : 'close' });
    }
    if ('blindsPosition' in telemetry && groups.cl?.[1]) {
      cmds.push({ Id: groups.cl[1].id, certain: Number(telemetry.blindsPosition) > 0 ? 'open' : 'close' });
    }

    // ── Service flags (dndService / murService / sosService) ───────────────
    for (const [iHotelKey, keywords] of Object.entries(SERVICE_KEYWORDS)) {
      if (iHotelKey in telemetry) {
        const dev = (groups.fw || []).find(d =>
          keywords.some(kw => (d.deviceName || '').toLowerCase().includes(kw))
        );
        if (dev) {
          cmds.push({ Id: dev.id, turn: telemetry[iHotelKey] ? 'ON' : 'OFF' });
        }
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
        await this.authenticate(); // refresh token if near expiry
        await this._fetchRoomList(true); // force fresh room list each cycle

        const hostIds = Object.keys(deviceIdToRoom);
        const states  = await this.getAllDeviceStates(hostIds, []);

        for (const [hostId, tbFmt] of Object.entries(states)) {
          if (!_active) break;
          const roomNum = deviceIdToRoom[hostId];
          if (!roomNum) continue;

          const flat = this._flattenTBFormat(tbFmt);
          // Only call onUpdate for keys that actually changed
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

    setTimeout(poll, POLL_INTERVAL); // first poll after one interval

    // Note: intentionally NO _ws property — room.service.js checks for _ws
    // before binding WS error/close handlers; absence means polling is used.
    return {
      _polling: true,
      _active:  () => _active, // callable so callers can check liveness
      close:    () => { _active = false; },
    };
  }

  // ── Capabilities ────────────────────────────────────────────────────────────

  getCapabilities() {
    return {
      realtime:        false,   // polling only, no WebSocket push
      sensors:         ['temperature'],  // AC curTemp is the only sensor
      meters:          false,
      commandVerify:   false,   // no reliable immediate read-back after write
      offlineScenes:   false,
      relayAttributes: false,
      doorLock:        false,   // Greentech API doesn't expose a direct lock control
    };
  }

  getWsToken() { return null; }
  getWsUrl()   { return null; }

  // ── Private translation helpers ──────────────────────────────────────────────

  /**
   * Build a ThingsBoard-style array-wrapped telemetry object from Greentech data.
   * Shape: { key: [{ value: v }], ... }
   * This is what room.service.js::parseTelemetry() expects.
   */
  _buildTBFormat(roomRow, groups) {
    const tb   = {};
    const wrap = v => [{ value: v }];

    // ── Room-level status (from /mqtt/room/list2) ──────────────────────────
    if (roomRow.checkStatus !== undefined) {
      tb.roomStatus  = wrap(roomRow.checkStatus === 'Check-in' ? 1 : 0);
    }
    if (roomRow.lockStatus !== undefined) {
      // "Open" means unlocked (door is open / can be entered)
      tb.doorUnlock  = wrap(roomRow.lockStatus.toLowerCase() === 'open');
    }
    if (roomRow.outStatus !== undefined) {
      // "Open" means DND is active (guest placed out-of-service card)
      tb.dndService  = wrap(roomRow.outStatus.toLowerCase() === 'open');
    }
    if (roomRow.hoststatus !== undefined) {
      tb.deviceStatus = wrap(String(roomRow.hoststatus) === '1' ? 1 : 0);
    }

    // ── Lamps (d[]) → line1 / line2 / line3 ───────────────────────────────
    (groups.d || []).forEach((dev, i) => {
      const key = `line${i + 1}`;
      if (key === 'line1' || key === 'line2' || key === 'line3') {
        tb[key] = wrap(dev.turn === 'ON' || dev.turn === true || dev.turn === 1);
      }
    });

    // ── Dimming lamps (tgd[]) → dimmer1 / dimmer2 ─────────────────────────
    (groups.tgd || []).forEach((dev, i) => {
      const key = `dimmer${i + 1}`;
      if (key === 'dimmer1' || key === 'dimmer2') {
        const on  = dev.turn === 'ON' || dev.turn === true || dev.turn === 1;
        tb[key]   = wrap(on ? (dev.brightness ?? 100) : 0);
      }
    });

    // ── AC (wk[0]) → acMode / acTemperatureSet / fanSpeed / temperature ───
    const ac = (groups.wk || [])[0];
    if (ac) {
      const isOn = ac.turn === 'ON' || ac.turn === true || ac.turn === 1;
      tb.acMode   = wrap(isOn ? (AC_MODE_FROM_GT[ac.modern] ?? 1) : 0);
      if (ac.temperature != null) {
        // Greentech returns "30°C" — strip the unit
        const setTemp = parseFloat(String(ac.temperature).replace('°C', ''));
        if (!isNaN(setTemp)) tb.acTemperatureSet = wrap(setTemp);
      }
      tb.fanSpeed = wrap(FAN_SPEED_FROM_GT[ac.fatSpeed] ?? 0);
      if (ac.curTemp != null) {
        const cur = parseFloat(String(ac.curTemp));
        if (!isNaN(cur)) tb.temperature = wrap(cur);
      }
    }

    // ── Curtains (cl[]) → curtainsPosition / blindsPosition ───────────────
    const curtains = groups.cl || [];
    if (curtains[0]) {
      const pos = this._curtainPositionFromCertain(curtains[0].certain);
      tb.curtainsPosition = wrap(pos);
    }
    if (curtains[1]) {
      const pos = this._curtainPositionFromCertain(curtains[1].certain);
      tb.blindsPosition = wrap(pos);
    }

    // ── Service flags (fw[]) → dndService / murService / sosService ───────
    (groups.fw || []).forEach(dev => {
      const name = (dev.deviceName || '').toLowerCase();
      const on   = dev.turn === 'ON' || dev.turn === true || dev.turn === 1;
      for (const [iHotelKey, keywords] of Object.entries(SERVICE_KEYWORDS)) {
        if (keywords.some(kw => name.includes(kw))) {
          tb[iHotelKey] = wrap(on);
        }
      }
    });

    return tb;
  }

  /** Convert TB-array format to flat { key: value } object. */
  _flattenTBFormat(tbFmt) {
    const flat = {};
    for (const [key, arr] of Object.entries(tbFmt)) {
      if (Array.isArray(arr) && arr.length > 0) flat[key] = arr[0].value;
    }
    return flat;
  }

  /** Map Greentech curtain `certain` string to iHotel 0-100 position. */
  _curtainPositionFromCertain(certain) {
    if (!certain) return 0;
    const s = String(certain).toLowerCase();
    if (s === 'open')  return 100;
    if (s === 'close') return 0;
    if (s === 'stop')  return 50; // unknown position, use midpoint
    return 0;
  }
}


module.exports = { GreentechAdapter };
