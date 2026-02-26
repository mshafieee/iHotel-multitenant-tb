/**
 * Frontend API Utility Tests (Vitest + jsdom)
 * Tests: token management, api() fetch wrapper, auto-refresh, error handling
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Helper: reset module state between tests by re-importing fresh
// (jsdom resets localStorage automatically each test via beforeEach)

// ─── Reset localStorage + module cache before each test ──────────────────────
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── Import helpers inline (api.js uses module-level vars, reset by reimport) ─
// We use vi.resetModules() pattern for full isolation

async function freshModule() {
  vi.resetModules();
  return import('../utils/api.js');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('setTokens / getAccessToken / clearTokens', () => {
  it('stores access token in localStorage', async () => {
    const { setTokens, getAccessToken } = await freshModule();
    setTokens('my-access', 'my-refresh');
    expect(getAccessToken()).toBe('my-access');
    expect(localStorage.getItem('accessToken')).toBe('my-access');
    expect(localStorage.getItem('refreshToken')).toBe('my-refresh');
  });

  it('removes tokens from localStorage on clearTokens', async () => {
    const { setTokens, clearTokens, getAccessToken } = await freshModule();
    setTokens('tok', 'ref');
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('setTokens(null, null) removes keys', async () => {
    const { setTokens } = await freshModule();
    setTokens('a', 'b');
    setTokens(null, null);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('api() — successful requests', () => {
  it('makes a GET request and returns parsed JSON', async () => {
    const { api } = await freshModule();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rooms: [] }),
    });

    const result = await api('/api/hotel/overview');
    expect(result).toEqual({ rooms: [] });
    expect(fetch).toHaveBeenCalledWith('/api/hotel/overview', expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });

  it('sends Authorization header when access token is set', async () => {
    const { setTokens, api } = await freshModule();
    setTokens('my-jwt', null);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    await api('/api/auth/me');
    expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer my-jwt' }),
    }));
  });

  it('makes a POST request with JSON body', async () => {
    const { api } = await freshModule();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'new-tok' }),
    });

    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: 'hilton2026' }),
    });
    expect(result).toHaveProperty('accessToken');
    expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('api() — error handling', () => {
  it('throws with server error message on non-ok response', async () => {
    const { api } = await freshModule();

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Authentication required' }),
    });

    await expect(api('/api/auth/me')).rejects.toThrow('Authentication required');
  });

  it('falls back to HTTP status string when body has no error field', async () => {
    const { api } = await freshModule();

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    await expect(api('/api/broken')).rejects.toThrow('HTTP 500');
  });

  it('falls back to HTTP status string when body is not JSON', async () => {
    const { api } = await freshModule();

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new SyntaxError('Invalid JSON')),
    });

    await expect(api('/api/broken')).rejects.toThrow('HTTP 503');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('api() — 401 auto-refresh', () => {
  it('retries with new token after successful refresh', async () => {
    const { setTokens, api } = await freshModule();
    setTokens('expired-tok', 'valid-refresh');

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ accessToken: 'new-token' }),
        });
      }
      callCount++;
      if (callCount === 1) {
        // First call to /api/auth/me — simulate expired token
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Token expired' }),
        });
      }
      // Second call after refresh — succeed
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ username: 'owner' }),
      });
    });

    const result = await api('/api/auth/me');
    expect(result).toEqual({ username: 'owner' });
    expect(fetch).toHaveBeenCalledTimes(3); // original + refresh + retry
  });

  it('clears tokens and calls onLogout when refresh fails', async () => {
    const { setTokens, setLogoutCallback, getAccessToken, api } = await freshModule();
    setTokens('expired-tok', 'bad-refresh');

    const logoutCb = vi.fn();
    setLogoutCallback(logoutCb);

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Refresh failed' }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Expired' }),
      });
    });

    await expect(api('/api/auth/me')).rejects.toThrow('Session expired');
    expect(getAccessToken()).toBeNull();
    expect(logoutCb).toHaveBeenCalledTimes(1);
  });

  it('does not retry when no refresh token is available', async () => {
    const { setTokens, api } = await freshModule();
    setTokens('expired-tok', null);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Expired' }),
    });

    await expect(api('/api/auth/me')).rejects.toThrow('Expired');
    // Only one fetch call — no refresh attempt
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createSSE', () => {
  it('returns null when no access token', async () => {
    const { createSSE } = await freshModule();
    // No token set → null
    expect(createSSE()).toBeNull();
  });

  it('returns EventSource with token param when logged in', async () => {
    const { setTokens, createSSE } = await freshModule();
    setTokens('my-token', null);

    // jsdom does not implement EventSource, so mock it
    const mockES = {};
    global.EventSource = vi.fn().mockReturnValue(mockES);

    const es = createSSE();
    expect(es).toBe(mockES);
    expect(EventSource).toHaveBeenCalledWith('/api/events?token=my-token');
  });
});
