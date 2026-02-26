/**
 * Zustand Store Tests (Vitest + jsdom)
 * Tests: hotelStore state transitions, authStore helpers
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// hotelStore — local (non-async) state transitions
// ─────────────────────────────────────────────────────────────────────────────

// Mock the api utility so no real fetch is made
vi.mock('../utils/api', () => ({
  api: vi.fn().mockResolvedValue([]),
  getAccessToken: vi.fn().mockReturnValue(null), // null → isAuthenticated: false
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  setLogoutCallback: vi.fn(),
}));

describe('hotelStore — dismissAlert', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('removes an alert at the given index', async () => {
    const { default: useHotelStore } = await import('../store/hotelStore.js');

    useHotelStore.setState({
      alerts: [
        { type: 'SOS', room: '101' },
        { type: 'MUR', room: '102' },
        { type: 'DND', room: '103' },
      ]
    });

    useHotelStore.getState().dismissAlert(1); // remove MUR
    const alerts = useHotelStore.getState().alerts;
    expect(alerts).toHaveLength(2);
    expect(alerts.map(a => a.type)).toEqual(['SOS', 'DND']);
  });

  it('dismissAlert(0) removes the first alert', async () => {
    const { default: useHotelStore } = await import('../store/hotelStore.js');

    useHotelStore.setState({ alerts: [{ type: 'SOS', room: '101' }, { type: 'MUR', room: '102' }] });
    useHotelStore.getState().dismissAlert(0);
    expect(useHotelStore.getState().alerts).toHaveLength(1);
    expect(useHotelStore.getState().alerts[0].type).toBe('MUR');
  });
});

describe('hotelStore — clearLogs', () => {
  beforeEach(() => { vi.resetModules(); });

  it('empties the logs array', async () => {
    const { default: useHotelStore } = await import('../store/hotelStore.js');
    useHotelStore.setState({ logs: [{ ts: 1, message: 'a' }, { ts: 2, message: 'b' }] });
    useHotelStore.getState().clearLogs();
    expect(useHotelStore.getState().logs).toEqual([]);
  });
});

describe('hotelStore — stopPolling', () => {
  beforeEach(() => { vi.resetModules(); });

  it('clears the poll timer and closes SSE', async () => {
    const { default: useHotelStore } = await import('../store/hotelStore.js');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const mockSSE = { close: vi.fn() };

    useHotelStore.setState({ pollTimer: 42, sse: mockSSE });
    useHotelStore.getState().stopPolling();

    expect(clearIntervalSpy).toHaveBeenCalledWith(42);
    expect(mockSSE.close).toHaveBeenCalledTimes(1);
    expect(useHotelStore.getState().pollTimer).toBeNull();
    expect(useHotelStore.getState().sse).toBeNull();
  });
});

describe('hotelStore — checkout optimistic update', () => {
  beforeEach(() => { vi.resetModules(); });

  it('sets roomStatus to 2 (SERVICE) and clears reservation locally', async () => {
    const { api } = await import('../utils/api.js');
    api.mockResolvedValue({});

    const { default: useHotelStore } = await import('../store/hotelStore.js');
    useHotelStore.setState({
      rooms: {
        '101': { roomStatus: 1, reservation: { id: 'res-1', guestName: 'Alice' } }
      },
      reservations: []
    });

    await useHotelStore.getState().checkout('101');

    const room = useHotelStore.getState().rooms['101'];
    expect(room.roomStatus).toBe(2);
    expect(room.reservation).toBeNull();
  });
});

describe('hotelStore — resetRoom optimistic update', () => {
  beforeEach(() => { vi.resetModules(); });

  it('resets all room properties to defaults', async () => {
    const { api } = await import('../utils/api.js');
    api.mockResolvedValue({});

    const { default: useHotelStore } = await import('../store/hotelStore.js');
    useHotelStore.setState({
      rooms: {
        '201': {
          roomStatus: 3,
          line1: true, line2: true, line3: true,
          dimmer1: 80, dimmer2: 60,
          acMode: 2, fanSpeed: 2,
          curtainsPosition: 50, blindsPosition: 30,
          dndService: true, murService: true, sosService: false, pdMode: true,
        }
      }
    });

    await useHotelStore.getState().resetRoom('201');

    const room = useHotelStore.getState().rooms['201'];
    expect(room.roomStatus).toBe(0);
    expect(room.line1).toBe(false);
    expect(room.line2).toBe(false);
    expect(room.line3).toBe(false);
    expect(room.acMode).toBe(0);
    expect(room.curtainsPosition).toBe(0);
    expect(room.blindsPosition).toBe(0);
    expect(room.dndService).toBe(false);
    expect(room.murService).toBe(false);
    expect(room.pdMode).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// authStore — token bootstrapping
// ─────────────────────────────────────────────────────────────────────────────
describe('authStore — initial state', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });

  it('isAuthenticated is false when no token in localStorage', async () => {
    const { default: useAuthStore } = await import('../store/authStore.js');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('user is null initially', async () => {
    const { default: useAuthStore } = await import('../store/authStore.js');
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('authStore — login success', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });

  it('sets isAuthenticated and user on successful login', async () => {
    const { api, setTokens } = await import('../utils/api.js');
    api.mockResolvedValue({
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 1, username: 'owner', role: 'owner' }
    });

    const { default: useAuthStore } = await import('../store/authStore.js');
    const ok = await useAuthStore.getState().login('owner', 'hilton2026');

    expect(ok).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toMatchObject({ username: 'owner', role: 'owner' });
    expect(setTokens).toHaveBeenCalledWith('tok', 'ref');
  });
});

describe('authStore — login failure', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });

  it('returns false and sets error on failed login', async () => {
    const { api } = await import('../utils/api.js');
    api.mockRejectedValue(new Error('Invalid credentials'));

    const { default: useAuthStore } = await import('../store/authStore.js');
    const ok = await useAuthStore.getState().login('owner', 'wrong');

    expect(ok).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().error).toBe('Invalid credentials');
  });
});

describe('authStore — logout', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });

  it('clears user and isAuthenticated on logout', async () => {
    const { api, clearTokens } = await import('../utils/api.js');
    api.mockResolvedValue({});

    const { default: useAuthStore } = await import('../store/authStore.js');

    // Seed an authenticated state
    useAuthStore.setState({ user: { id: 1, username: 'owner', role: 'owner' }, isAuthenticated: true });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(clearTokens).toHaveBeenCalled();
  });
});
