import { create } from 'zustand';
import { api, getAccessToken } from '../utils/api';

const useHotelStore = create((set, get) => ({
  rooms: {},
  deviceCount: 0,
  source: 'loading',
  reservations: [],
  logs: [],
  alerts: [],
  todayCheckouts: [],
  scenes: [],
  sse: null,
  pollTimer: null,

  // Fetch overview — server always responds instantly with cached snapshot.
  // If data was stale, a background TB fetch runs on the server and delivers
  // fresh data via SSE 'snapshot'. So we always update from HTTP here, and
  // the SSE listener will update again when fresh data arrives.
  fetchOverview: async () => {
    try {
      const d = await api('/api/hotel/overview');
      if (d.rooms && Object.keys(d.rooms).length) {
        set({ rooms: d.rooms, deviceCount: d.deviceCount, source: 'live' });
      }
    } catch (e) { console.error('Overview fetch:', e.message); }
  },

  fetchReservations: async () => {
    try {
      const data = await api('/api/pms/reservations');
      set({ reservations: data });
    } catch {}
  },

  fetchLogs: async () => {
    try {
      const { logs } = get();
      const since = logs.length ? logs[0].ts : 0;
      const data = await api(`/api/logs?since=${since}`);
      if (data.length) set({ logs: [...data, ...logs].slice(0, 300) });
    } catch {}
  },

  // Start polling + SSE
  startPolling: () => {
    const { fetchOverview, fetchReservations, fetchLogs, fetchTodayCheckouts } = get();
    fetchOverview();
    fetchReservations();
    fetchLogs();
    fetchTodayCheckouts();
    const timer = setInterval(fetchOverview, 60000);
    set({ pollTimer: timer });
    setInterval(fetchReservations, 30000);
    setInterval(fetchLogs, 15000);
    setInterval(fetchTodayCheckouts, 5 * 60 * 1000); // refresh every 5 min
  },

  stopPolling: () => {
    const { pollTimer, sse } = get();
    if (pollTimer) clearInterval(pollTimer);
    if (sse) sse.close();
    set({ pollTimer: null, sse: null });
  },

  connectSSE: () => {
    const token = getAccessToken();
    if (!token) return;
    const prev = get().sse;
    if (prev) prev.close();

    const es2 = new EventSource(`/api/events?token=${token}`);

    es2.addEventListener('snapshot', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.rooms) set({ rooms: d.rooms, source: 'live' });
      } catch {}
    });

    es2.addEventListener('telemetry', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const rooms = { ...get().rooms };
        if (rooms[d.room]) {
          rooms[d.room] = { ...rooms[d.room], ...d.data };
          set({ rooms });
        }
      } catch {}
    });

    es2.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        const logs = get().logs;
        if (!logs.some(l => l.ts === entry.ts)) {
          set({ logs: [entry, ...logs].slice(0, 300) });
        }
      } catch {}
    });

    es2.addEventListener('alert', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        set({ alerts: [d, ...get().alerts].slice(0, 50) });
      } catch {}
    });

    es2.addEventListener('checkout_alert', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.rooms) set({ todayCheckouts: d.rooms });
      } catch {}
    });

    es2.onerror = () => {
      setTimeout(() => get().connectSSE(), 5000);
    };

    set({ sse: es2 });
  },

  // Send control command to a room (roomId = room number string, e.g. "101")
  rpc: async (roomId, method, params) => {
    // Optimistic local update — rooms are keyed by room number
    const rooms = { ...get().rooms };
    const room = rooms[roomId];
    if (room) {
      applyLocal(room, method, params);
      set({ rooms: { ...rooms } });
    }
    // The server /api/devices/:id/rpc expects the ThingsBoard device UUID
    const tbDeviceId = room?.deviceId || roomId;
    try {
      await api(`/api/devices/${tbDeviceId}/rpc`, {
        method: 'POST',
        body: JSON.stringify({ method, params })
      });
    } catch (e) { console.error('RPC error:', e.message); }
  },

  // Check out a room: cancel reservation, set status to SERVICE, notify guest
  checkout: async (room) => {
    await api(`/api/rooms/${room}/checkout`, { method: 'POST' });
    // Optimistic: update room status to SERVICE (2) in local store
    const rooms = { ...get().rooms };
    if (rooms[room]) {
      rooms[room] = { ...rooms[room], roomStatus: 2, reservation: null };
      set({ rooms });
    }
    get().fetchReservations();
  },

  // Reset room to default state
  resetRoom: async (room) => {
    await api(`/api/rooms/${room}/reset`, { method: 'POST' });
    const rooms = { ...get().rooms };
    if (rooms[room]) {
      rooms[room] = { ...rooms[room], roomStatus: 0, line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0, acMode: 0, fanSpeed: 0, curtainsPosition: 0, blindsPosition: 0, dndService: false, murService: false, sosService: false, pdMode: false };
      set({ rooms });
    }
  },

  // Fetch today's checkouts for the alert banner
  fetchTodayCheckouts: async () => {
    try {
      const data = await api('/api/pms/today-checkouts');
      set({ todayCheckouts: data });
    } catch {}
  },

  // Clear logs from local store (called after server DELETE /api/logs)
  clearLogs: () => set({ logs: [] }),

  dismissAlert: (idx) => {
    const alerts = [...get().alerts];
    alerts.splice(idx, 1);
    set({ alerts });
  },

  fetchScenes: async (roomNumber) => {
    try {
      const qs = roomNumber ? `?room=${encodeURIComponent(roomNumber)}` : '';
      const data = await api(`/api/scenes${qs}`);
      set({ scenes: data });
    } catch {}
  },

  createScene: async (sceneData) => {
    const result = await api('/api/scenes', {
      method: 'POST',
      body: JSON.stringify(sceneData)
    });
    set({ scenes: [...get().scenes, result] });
    return result;
  },

  updateScene: async (id, updates) => {
    set({ scenes: get().scenes.map(s => s.id === id ? { ...s, ...updates } : s) });
    try {
      await api(`/api/scenes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
      });
    } catch (e) {
      await get().fetchScenes();
      throw e;
    }
  },

  deleteScene: async (id) => {
    await api(`/api/scenes/${id}`, { method: 'DELETE' });
    set({ scenes: get().scenes.filter(s => s.id !== id) });
  },

  runScene: async (id) => {
    await api(`/api/scenes/${id}/run`, { method: 'POST' });
  },

  pushScene: async (id) => {
    return api(`/api/scenes/${id}/push`, { method: 'POST' });
  },

  updateRoomType: async (room, roomType) => {
    // Optimistic local update
    const rooms = { ...get().rooms };
    if (rooms[room]) {
      rooms[room] = { ...rooms[room], type: roomType };
      set({ rooms });
    }
    await api(`/api/rooms/${room}/type`, {
      method: 'PATCH',
      body: JSON.stringify({ roomType }),
    });
  },
}));

// Local state application for optimistic updates
function applyLocal(r, m, p) {
  if (m === 'setLines') {
    if ('line1' in p) r.line1 = p.line1;
    if ('line2' in p) r.line2 = p.line2;
    if ('line3' in p) r.line3 = p.line3;
    if ('dimmer1' in p) r.dimmer1 = p.dimmer1;
    if ('dimmer2' in p) r.dimmer2 = p.dimmer2;
  }
  if (m === 'setAC') {
    if ('acMode' in p) r.acMode = p.acMode;
    if ('acTemperatureSet' in p) r.acTemperatureSet = p.acTemperatureSet;
    if ('fanSpeed' in p) r.fanSpeed = p.fanSpeed;
  }
  if (m === 'setDoorUnlock') r.doorUnlock = true;
  if (m === 'setDoorLock') r.doorUnlock = false;
  if (m === 'setCurtainsBlinds') {
    if ('curtainsPosition' in p) r.curtainsPosition = p.curtainsPosition;
    if ('blindsPosition' in p) r.blindsPosition = p.blindsPosition;
  }
  if (m === 'setService') Object.assign(r, p);
  if (m === 'resetServices') (p.services || []).forEach(s => { r[s] = false; });
  if (m === 'setRoomStatus') r.roomStatus = p.roomStatus;
  if (m === 'setPDMode') {
    r.pdMode = !!p.pdMode;
    if (r.pdMode) {
      // Cut all power optimistically
      r.line1 = false; r.line2 = false; r.line3 = false;
      r.dimmer1 = 0; r.dimmer2 = 0; r.acMode = 0; r.fanSpeed = 0;
      r.curtainsPosition = 0; r.blindsPosition = 0;
    }
  }
}

export default useHotelStore;
