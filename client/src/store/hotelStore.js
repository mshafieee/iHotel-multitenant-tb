import { create } from 'zustand';
import { api, getAccessToken } from '../utils/api';

const useHotelStore = create((set, get) => ({
  rooms: {},
  deviceCount: 0,
  source: 'loading',
  reservations: [],
  logs: [],
  alerts: [],
  sse: null,
  pollTimer: null,

  // Fetch full overview from server
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
    const { fetchOverview, fetchReservations, fetchLogs } = get();
    fetchOverview();
    fetchReservations();
    fetchLogs();
    const timer = setInterval(fetchOverview, 15000);
    set({ pollTimer: timer });
    setInterval(fetchReservations, 30000);
    setInterval(fetchLogs, 15000);
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

    es2.onerror = () => {
      setTimeout(() => get().connectSSE(), 5000);
    };

    set({ sse: es2 });
  },

  // Send control command to a device
  rpc: async (deviceId, method, params) => {
    // Optimistic local update
    const rooms = { ...get().rooms };
    const room = Object.values(rooms).find(r => r.deviceId === deviceId);
    if (room) {
      applyLocal(room, method, params);
      set({ rooms: { ...rooms } });
    }
    try {
      await api(`/api/devices/${deviceId}/rpc`, {
        method: 'POST',
        body: JSON.stringify({ method, params })
      });
    } catch (e) { console.error('RPC error:', e.message); }
  },

  // Check out a room: cancel reservation, set status to MUR, notify guest
  checkout: async (room) => {
    await api(`/api/rooms/${room}/checkout`, { method: 'POST' });
    // Optimistic: update room status to MUR (2) in local store
    const rooms = { ...get().rooms };
    if (rooms[room]) {
      rooms[room] = { ...rooms[room], roomStatus: 2, reservation: null };
      set({ rooms });
    }
    get().fetchReservations();
  },

  // Clear logs from local store (called after server DELETE /api/logs)
  clearLogs: () => set({ logs: [] }),

  dismissAlert: (idx) => {
    const alerts = [...get().alerts];
    alerts.splice(idx, 1);
    set({ alerts });
  }
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
