import { create } from 'zustand';

// Separate fetch helper for platform admin (uses platformToken, not hotel token)
async function platformApi(path, options = {}) {
  const token = localStorage.getItem('platformToken');
  const res   = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const usePlatformStore = create((set, get) => ({
  admin: null,         // { id, username, fullName, role: 'superadmin' | 'group_user' }
  isAuthenticated: !!localStorage.getItem('platformToken'),
  authLoading: true,
  error: null,

  hotels: [],
  metrics: null,
  hotelsLoading: false,
  metricsLoading: false,

  // Group user state
  groupHotels: [],
  groupHotelsLoading: false,

  // ── Auth ────────────────────────────────────────────────────────────────────
  checkAuth: async () => {
    const token = localStorage.getItem('platformToken');
    if (!token) { set({ authLoading: false }); return; }
    try {
      const admin = await platformApi('/api/platform/auth/me');
      set({ admin, isAuthenticated: true, authLoading: false });
    } catch {
      localStorage.removeItem('platformToken');
      set({ admin: null, isAuthenticated: false, authLoading: false });
    }
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const data = await platformApi('/api/platform/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      localStorage.setItem('platformToken', data.accessToken);
      // data.admin includes role field
      set({ admin: data.admin, isAuthenticated: true, authLoading: false, error: null });
      return true;
    } catch (e) {
      set({ error: e.message });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem('platformToken');
    set({ admin: null, isAuthenticated: false, hotels: [], metrics: null, groupHotels: [] });
  },

  // ── Hotels (superadmin) ─────────────────────────────────────────────────────
  fetchHotels: async () => {
    set({ hotelsLoading: true });
    try {
      const hotels = await platformApi('/api/platform/hotels');
      set({ hotels, hotelsLoading: false });
    } catch (e) {
      set({ hotelsLoading: false, error: e.message });
    }
  },

  createHotel: async ({ name, slug, contactEmail, plan, tbHost, tbUser, tbPass }) => {
    const result = await platformApi('/api/platform/hotels', {
      method: 'POST',
      body: JSON.stringify({ name, slug, contactEmail, plan, tbHost, tbUser, tbPass })
    });
    await get().fetchHotels();
    return result; // includes defaultUserPassword
  },

  updateHotel: async (id, updates) => {
    await platformApi(`/api/platform/hotels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    await get().fetchHotels();
  },

  deactivateHotel: async (id) => {
    await platformApi(`/api/platform/hotels/${id}`, { method: 'DELETE' });
    await get().fetchHotels();
  },

  // ── Rooms (superadmin) ──────────────────────────────────────────────────────
  importRooms: async (hotelId, payload) => {
    return await platformApi(`/api/platform/hotels/${hotelId}/rooms`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  fetchRooms: async (hotelId) => {
    return await platformApi(`/api/platform/hotels/${hotelId}/rooms`);
  },

  discoverRooms: async (hotelId) => {
    return await platformApi(`/api/platform/hotels/${hotelId}/discover`, { method: 'POST' });
  },

  // ── Hotel Users (superadmin) ────────────────────────────────────────────────
  fetchUsers: async (hotelId) => {
    return await platformApi(`/api/platform/hotels/${hotelId}/users`);
  },

  createUser: async (hotelId, { username, password, role, fullName }) => {
    return await platformApi(`/api/platform/hotels/${hotelId}/users`, {
      method: 'POST',
      body: JSON.stringify({ username, password, role, fullName })
    });
  },

  updateUser: async (hotelId, userId, updates) => {
    return await platformApi(`/api/platform/hotels/${hotelId}/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  changeAdminPassword: async (currentPassword, newPassword) => {
    return await platformApi('/api/platform/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },

  fetchHotelDetail: async (id) => {
    return await platformApi(`/api/platform/hotels/${id}`);
  },

  // ── Metrics (superadmin) ────────────────────────────────────────────────────
  fetchMetrics: async () => {
    set({ metricsLoading: true });
    try {
      const metrics = await platformApi('/api/platform/metrics');
      set({ metrics, metricsLoading: false });
    } catch (e) {
      set({ metricsLoading: false, error: e.message });
    }
  },

  // ── Group User Management (superadmin) ──────────────────────────────────────
  fetchGroupUsers: async () => {
    return await platformApi('/api/platform/group-users');
  },

  createGroupUser: async ({ username, password, fullName }) => {
    return await platformApi('/api/platform/group-users', {
      method: 'POST',
      body: JSON.stringify({ username, password, fullName })
    });
  },

  updateGroupUser: async (id, updates) => {
    return await platformApi(`/api/platform/group-users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  setGroupUserHotels: async (id, hotelIds) => {
    return await platformApi(`/api/platform/group-users/${id}/hotels`, {
      method: 'PUT',
      body: JSON.stringify({ hotelIds })
    });
  },

  // ── Group User Self-Service ─────────────────────────────────────────────────
  fetchGroupHotels: async () => {
    set({ groupHotelsLoading: true });
    try {
      const groupHotels = await platformApi('/api/platform/group/hotels');
      set({ groupHotels, groupHotelsLoading: false });
    } catch (e) {
      set({ groupHotelsLoading: false });
    }
  },

  fetchGroupHotelFinance: async (hotelId) => {
    return await platformApi(`/api/platform/group/hotels/${hotelId}/finance`);
  },

  fetchGroupHotelUsers: async (hotelId) => {
    return await platformApi(`/api/platform/group/hotels/${hotelId}/users`);
  },

  createGroupHotelUser: async (hotelId, { username, password, role, fullName }) => {
    return await platformApi(`/api/platform/group/hotels/${hotelId}/users`, {
      method: 'POST',
      body: JSON.stringify({ username, password, role, fullName })
    });
  },

  updateGroupHotelUser: async (hotelId, userId, updates) => {
    return await platformApi(`/api/platform/group/hotels/${hotelId}/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },
}));

export default usePlatformStore;
