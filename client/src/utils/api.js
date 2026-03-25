/**
 * API client with JWT token management
 * Handles: login, auto-refresh on 401, secure token storage
 */
const API_BASE = '';

let accessToken = localStorage.getItem('accessToken');
let refreshToken = localStorage.getItem('refreshToken');
let onLogout = null; // callback set by auth store

export function setLogoutCallback(cb) { onLogout = cb; }

export function setTokens(access, refresh) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('accessToken', access);
  else localStorage.removeItem('accessToken');
  if (refresh) localStorage.setItem('refreshToken', refresh);
  else localStorage.removeItem('refreshToken');
}

export function getAccessToken() { return accessToken; }
export function clearTokens() { setTokens(null, null); }

async function refreshAccessToken() {
  if (!refreshToken) throw new Error('No refresh token');
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  if (!res.ok) throw new Error('Refresh failed');
  const data = await res.json();
  accessToken = data.accessToken;
  localStorage.setItem('accessToken', data.accessToken);
  return data.accessToken;
}

// Codes that mean the server has hard-terminated this session.
// No point retrying or refreshing — log out immediately.
const HARD_LOGOUT_CODES = new Set(['ACCOUNT_DEACTIVATED', 'SESSION_REVOKED']);

// Main fetch wrapper with auto-retry on 401
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));

    // Hard logout: account deactivated or session force-revoked — no refresh attempt.
    if (HARD_LOGOUT_CODES.has(body.code)) {
      clearTokens();
      if (onLogout) onLogout();
      throw new Error(body.error || 'Session terminated');
    }

    // Normal expiry: try refresh once, then give up.
    if (refreshToken) {
      try {
        const newToken = await refreshAccessToken();
        headers['Authorization'] = `Bearer ${newToken}`;
        res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      } catch {
        clearTokens();
        if (onLogout) onLogout();
        throw new Error('Session expired');
      }
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// SSE with auth token in URL (since EventSource doesn't support headers)
export function createSSE() {
  if (!accessToken) return null;
  // We pass token as query param; server validates it
  return new EventSource(`${API_BASE}/api/events?token=${accessToken}`);
}
