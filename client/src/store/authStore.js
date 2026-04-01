import { create } from 'zustand';
import { api, setTokens, clearTokens, setLogoutCallback, getAccessToken } from '../utils/api';

const useAuthStore = create((set, get) => {
  // Register logout callback
  setLogoutCallback(() => set({ user: null, isAuthenticated: false }));

  return {
    user: null,
    isAuthenticated: !!getAccessToken(),
    loading: true,
    error: null,

    // Check if already logged in (on app load)
    checkAuth: async () => {
      if (!getAccessToken()) { set({ loading: false }); return; }
      try {
        const user = await api('/api/auth/me');
        set({ user, isAuthenticated: true, loading: false });
      } catch {
        // If /api/auth/me fails, attempt guest validation (tokens issued to guests)
        try {
          const g = await api('/api/guest/room');
          const guestUser = { id: 0, username: `guest:${g.room}`, role: 'guest', fullName: null };
          set({ user: guestUser, isAuthenticated: true, loading: false });
        } catch {
          clearTokens();
          set({ user: null, isAuthenticated: false, loading: false });
        }
      }
    },

    // Multi-tenant login: hotelSlug identifies which hotel to authenticate against
    login: async (hotelSlug, username, password) => {
      set({ error: null });
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ hotelSlug, username, password })
        });
        setTokens(data.accessToken, data.refreshToken);
        // deviceConfig: auto-detected device topology (lamps/dimmers/ac/curtains/blinds counts)
        set({ user: data.user, isAuthenticated: true, error: null });
        return true;
      } catch (e) {
        set({ error: e.message });
        return false;
      }
    },

    logout: async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
      clearTokens();
      set({ user: null, isAuthenticated: false });
    }
  };
});

export default useAuthStore;
