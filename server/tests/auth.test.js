/**
 * Auth Middleware Unit Tests
 * Tests: authenticate, requireRole, generateAccessToken, generateRefreshToken
 */
const jwt = require('jsonwebtoken');
const { authenticate, requireRole, generateAccessToken, generateRefreshToken, JWT_SECRET } = require('../auth');

// ── helpers ──────────────────────────────────────────────────────────────────
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

function makeReq(overrides = {}) {
  return { headers: {}, user: undefined, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('generateAccessToken', () => {
  const user = { id: 1, username: 'testuser', role: 'frontdesk' };

  test('returns a signed JWT string', () => {
    const token = generateAccessToken(user);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  test('payload contains id, username, role', () => {
    const token = generateAccessToken(user);
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.id).toBe(1);
    expect(payload.username).toBe('testuser');
    expect(payload.role).toBe('frontdesk');
  });

  test('payload includes room when present', () => {
    const token = generateAccessToken({ ...user, room: '101' });
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.room).toBe('101');
  });

  test('payload does NOT include room when absent', () => {
    const token = generateAccessToken(user);
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.room).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('generateRefreshToken', () => {
  const user = { id: 42, username: 'owner', role: 'owner' };

  test('returns a signed JWT string', () => {
    const token = generateRefreshToken(user);
    expect(typeof token).toBe('string');
  });

  test('payload contains id and type=refresh', () => {
    const token = generateRefreshToken(user);
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.id).toBe(42);
    expect(payload.type).toBe('refresh');
  });

  test('does NOT expose username or role', () => {
    const token = generateRefreshToken(user);
    const payload = jwt.verify(token, JWT_SECRET);
    expect(payload.username).toBeUndefined();
    expect(payload.role).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('authenticate middleware', () => {
  test('passes with valid Bearer token', () => {
    const token = generateAccessToken({ id: 1, username: 'admin', role: 'admin' });
    const req  = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res  = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.username).toBe('admin');
    expect(req.user.role).toBe('admin');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects missing Authorization header', () => {
    const req  = makeReq();
    const res  = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test('rejects malformed Authorization header (no Bearer prefix)', () => {
    const req  = makeReq({ headers: { authorization: 'Token abc' } });
    const res  = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('rejects invalid/tampered token', () => {
    const req  = makeReq({ headers: { authorization: 'Bearer invalid.token.here' } });
    const res  = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid token' }));
  });

  test('rejects expired token with TOKEN_EXPIRED code', () => {
    const expiredToken = jwt.sign(
      { id: 1, username: 'u', role: 'frontdesk' },
      JWT_SECRET,
      { expiresIn: -1 } // already expired
    );
    const req  = makeReq({ headers: { authorization: `Bearer ${expiredToken}` } });
    const res  = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('requireRole middleware', () => {
  function authedReq(role) {
    return makeReq({ user: { id: 1, username: 'u', role } });
  }

  test('passes when user has an allowed role', () => {
    const middleware = requireRole('owner', 'admin');
    const req  = authedReq('admin');
    const res  = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects when user has wrong role', () => {
    const middleware = requireRole('owner');
    const req  = authedReq('frontdesk');
    const res  = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  test('rejects when req.user is absent', () => {
    const middleware = requireRole('owner');
    const req  = makeReq({ user: undefined });
    const res  = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('single-role: only exact match passes', () => {
    const middleware = requireRole('frontdesk');
    const roles = ['owner', 'admin', 'frontdesk', 'guest'];

    roles.forEach(role => {
      const next = jest.fn();
      middleware(authedReq(role), mockRes(), next);
      if (role === 'frontdesk') {
        expect(next).toHaveBeenCalled();
      } else {
        expect(next).not.toHaveBeenCalled();
      }
    });
  });

  test('multi-role: all listed roles pass', () => {
    const middleware = requireRole('owner', 'admin', 'frontdesk');
    ['owner', 'admin', 'frontdesk'].forEach(role => {
      const next = jest.fn();
      middleware(authedReq(role), mockRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });
});
