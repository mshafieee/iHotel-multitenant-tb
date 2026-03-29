import { create } from 'zustand';
import { api, getAccessToken } from '../utils/api';

function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

const useHotelStore = create((set, get) => ({
  rooms: {},
  deviceCount: 0,
  source: 'loading',
  reservations: [],
  logs: [],
  alerts: [],
  todayCheckouts: [],
  scenes: [],
  commandAcks: [],  // { room, method, success, message, ts }
  sse: null,
  pollTimer: null,

  // ── Housekeeping state ───────────────────────────────────────────────────
  // hkQueue        : dirty rooms with no active assignment (for manager view)
  // hkAssignments  : active assignments (managers see all; housekeepers see own)
  // hkHousekeepers : list of housekeeper accounts (for assignment dropdown)
  // hkNotifications: incoming assignment alerts for the logged-in housekeeper
  // maintWorkers   : list of maintenance worker accounts (for ticket assignment)
  // maintTickets   : open tickets for the logged-in maintenance worker (real-time)
  hkQueue:         [],
  hkAssignments:   [],
  hkHousekeepers:  [],
  hkNotifications: [],  // { rooms, assignedBy, notes, ts } — desktop toast payloads
  maintWorkers:    [],
  maintTickets:    [],
  maintNotifications: [],

  // ── Upsell state ─────────────────────────────────────────────────────────
  upsellPending:   [],   // pending extras across all reservations (managers)

  // ── Meter stats (owner/admin only) ───────────────────────────────────────
  meterStats: null,  // { rooms, monthlyKwh, monthlyM3, month }

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

  fetchMeterStats: async () => {
    try {
      const data = await api('/api/hotel/meter-stats');
      set({ meterStats: data });
    } catch {}
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

    // Individual telemetry events (from direct control actions / non-batched sources)
    es2.addEventListener('telemetry', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const rooms = { ...get().rooms };
        // Allow new rooms (e.g. simulator virtual rooms) to be added to the store
        if (!rooms[d.room]) rooms[d.room] = { room: d.room, floor: Math.floor(Number(d.room) / 100) || 1 };
        rooms[d.room] = { ...rooms[d.room], ...d.data };
        set({ rooms });
      } catch {}
    });

    // Batched telemetry — server accumulates all room updates within a 500ms window
    // and sends them as a single event. One Zustand set() = one React re-render
    // instead of 300+ individual re-renders per simulator tick.
    es2.addEventListener('batch-telemetry', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const rooms = { ...get().rooms };
        for (const [roomNum, { data }] of Object.entries(d.rooms)) {
          if (!rooms[roomNum]) rooms[roomNum] = { room: roomNum, floor: Math.floor(Number(roomNum) / 100) || 1 };
          rooms[roomNum] = { ...rooms[roomNum], ...data };
        }
        set({ rooms });
      } catch {}
    });

    // Individual log events (from non-batched sources)
    es2.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        const logs = get().logs;
        if (!logs.some(l => l.ts === entry.ts)) {
          set({ logs: [entry, ...logs].slice(0, 300) });
        }
      } catch {}
    });

    // Batched log events — all log entries from a 500ms window in one event
    es2.addEventListener('batch-log', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const logs = get().logs;
        const existing = new Set(logs.map(l => l.ts));
        const newEntries = d.entries.filter(e => !existing.has(e.ts));
        if (newEntries.length) {
          set({ logs: [...newEntries.reverse(), ...logs].slice(0, 300) });
        }
      } catch {}
    });

    es2.addEventListener('alert', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        set({ alerts: [d, ...get().alerts].slice(0, 50) });
      } catch {}
    });

    // Command acknowledgement — device confirmed or failed
    es2.addEventListener('command-ack', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const ack = { ...d, ts: Date.now() };
        set({ commandAcks: [ack, ...get().commandAcks].slice(0, 20) });
        // Auto-remove after 4 seconds
        setTimeout(() => {
          set({ commandAcks: get().commandAcks.filter(a => a.ts !== ack.ts) });
        }, 4000);
      } catch {}
    });

    es2.addEventListener('checkout_alert', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.rooms) set({ todayCheckouts: d.rooms });
      } catch {}
    });

    // ── Housekeeping SSE events ────────────────────────────────────────────

    // Manager view: a queue/assignment list changed (assign, start, complete, cancel)
    es2.addEventListener('housekeeping_update', (ev) => {
      try {
        // Re-fetch both queue and assignments to stay in sync
        get().fetchHKQueue();
        get().fetchHKAssignments();
      } catch {}
    });

    // Housekeeper personal notification: new rooms assigned to them
    es2.addEventListener('housekeeping_assign', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        // Append notification (shown as a toast) and refresh their assignment list
        const note = { ...d, id: Date.now() };
        set({ hkNotifications: [note, ...get().hkNotifications].slice(0, 10) });
        get().fetchHKAssignments();
        get().fetchHKQueue();
      } catch {}
    });

    // Housekeeper personal notification: one of their assignments was cancelled
    es2.addEventListener('housekeeping_cancel', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        // Remove the cancelled assignment from local state immediately
        set({ hkAssignments: get().hkAssignments.filter(a => a.id !== d.id) });
        get().fetchHKQueue();
      } catch {}
    });

    // ── Maintenance SSE events ─────────────────────────────────────────────

    // Personal notification when a ticket is assigned to this maintenance worker
    es2.addEventListener('maintenance_assigned', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        // Play a sound alert
        playNotifSound();
        // Add a toast notification
        const note = { ...d.ticket, _notifId: Date.now() };
        set({ maintNotifications: [note, ...get().maintNotifications].slice(0, 10) });
      } catch {}
      get().fetchMaintTickets();
    });

    // Any ticket update (status change, assign, resolve)
    es2.addEventListener('maintenance_update', () => {
      get().fetchMaintTickets();
      // Also refresh HK queue in case a resolved maintenance ticket freed a room
      get().fetchHKQueue();
      get().fetchHKAssignments();
    });

    // Upsell: new request or status change
    es2.addEventListener('upsell_request', () => { get().fetchUpsellPending(); });
    es2.addEventListener('upsell_update',  () => { get().fetchUpsellPending(); });

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
  checkout: async (room, paymentMethod, thirdPartyChannel) => {
    const result = await api(`/api/rooms/${room}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ paymentMethod, thirdPartyChannel }),
    });
    // Optimistic: update room status to SERVICE (2) in local store
    const rooms = { ...get().rooms };
    if (rooms[room]) {
      rooms[room] = { ...rooms[room], roomStatus: 2, reservation: null };
      set({ rooms });
    }
    get().fetchReservations();
    return result; // { success, reviewUrl }
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

  dismissCommandAck: (ts) => {
    set({ commandAcks: get().commandAcks.filter(a => a.ts !== ts) });
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

  bulkDeleteScenes: async (ids) => {
    await api('/api/scenes', {
      method: 'DELETE',
      body: JSON.stringify({ ids })
    });
    const idSet = new Set(ids);
    set({ scenes: get().scenes.filter(s => !idSet.has(s.id)) });
  },

  runScene: async (id) => {
    await api(`/api/scenes/${id}/run`, { method: 'POST' });
  },

  pushScene: async (id) => {
    return api(`/api/scenes/${id}/push`, { method: 'POST' });
  },

  // ── Housekeeping actions ─────────────────────────────────────────────────

  // Fetch dirty rooms with no active assignment (manager: unassigned queue)
  // or own assignments (housekeeper: personal queue).
  fetchHKQueue: async () => {
    try {
      const data = await api('/api/housekeeping/queue');
      set({ hkQueue: data });
    } catch {}
  },

  // Fetch all active assignments (managers: all; housekeepers: own).
  fetchHKAssignments: async () => {
    try {
      const data = await api('/api/housekeeping/assignments');
      set({ hkAssignments: data });
    } catch {}
  },

  // Fetch list of housekeeper accounts for the assignment dropdown.
  fetchHKHousekeepers: async () => {
    try {
      const data = await api('/api/housekeeping/housekeepers');
      set({ hkHousekeepers: data });
    } catch {}
  },

  // Fetch list of maintenance worker accounts for the ticket assignment dropdown.
  fetchMaintWorkers: async () => {
    try {
      const data = await api('/api/housekeeping/maintenance-workers');
      set({ maintWorkers: data });
    } catch {}
  },

  // Fetch maintenance tickets for the logged-in maintenance worker.
  fetchMaintTickets: async () => {
    try {
      const data = await api('/api/maintenance');
      set({ maintTickets: data });
    } catch {}
  },

  // Fetch all pending upsell extras (managers only).
  fetchUpsellPending: async () => {
    try {
      const data = await api('/api/upsell/pending');
      set({ upsellPending: data });
    } catch {}
  },

  // Manager: assign a list of rooms to a housekeeper.
  hkAssign: async (rooms, assignedTo, notes = '') => {
    const result = await api('/api/housekeeping/assign', {
      method: 'POST',
      body: JSON.stringify({ rooms, assignedTo, notes }),
    });
    // Refresh both lists so the UI is up to date immediately
    await get().fetchHKQueue();
    await get().fetchHKAssignments();
    return result;
  },

  // Housekeeper (or manager): mark a task as in_progress.
  hkStart: async (assignmentId) => {
    await api(`/api/housekeeping/assignments/${assignmentId}/start`, { method: 'POST' });
    // Optimistic update
    set({
      hkAssignments: get().hkAssignments.map(a =>
        a.id === assignmentId ? { ...a, status: 'in_progress', started_at: Date.now() } : a
      ),
    });
  },

  // Housekeeper (or manager): mark cleaning done and reset the room.
  hkComplete: async (assignmentId) => {
    await api(`/api/housekeeping/assignments/${assignmentId}/complete`, { method: 'POST' });
    // Remove from local assignment list; the room telemetry update (roomStatus→0)
    // arrives via SSE and refreshes the rooms map automatically.
    set({
      hkAssignments: get().hkAssignments.filter(a => a.id !== assignmentId),
    });
    await get().fetchHKQueue();
  },

  // Manager: cancel an assignment.
  hkCancel: async (assignmentId) => {
    await api(`/api/housekeeping/assignments/${assignmentId}`, { method: 'DELETE' });
    set({
      hkAssignments: get().hkAssignments.filter(a => a.id !== assignmentId),
    });
    await get().fetchHKQueue();
    await get().fetchHKAssignments();
  },

  // Dismiss a housekeeping notification toast.
  dismissHKNotification: (id) => {
    set({ hkNotifications: get().hkNotifications.filter(n => n.id !== id) });
  },

  dismissMaintNotification: (id) => {
    set({ maintNotifications: get().maintNotifications.filter(n => n._notifId !== id) });
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
  if (m === 'setService') {
    Object.assign(r, p);
    // DND/MUR mutual exclusivity
    if (p.dndService === true) r.murService = false;
    else if (p.murService === true) r.dndService = false;
  }
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
