/**
 * iHotel SaaS Platform — Authentication Middleware
 * JWT token verification + role-based access control
 * Supports: hotel staff tokens (include hotelId) and platform admin tokens
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_ihotel_default';

// db reference injected by index.js after DB init (needed for token validity check)
let _db = null;
function setDB(database) { _db = database; }

// ── Hotel staff / guest authentication ────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // If this is a hotel user token, check that it was issued after the last
    // forced sign-out (tokens_valid_after). This ensures QR revocation
    // immediately invalidates all active sessions — not just on next refresh.
    if (_db && decoded.id && decoded.hotelId) {
      const row = _db.prepare('SELECT tokens_valid_after FROM hotel_users WHERE id=?').get(decoded.id);
      if (row?.tokens_valid_after) {
        const validAfterMs = new Date(row.tokens_valid_after).getTime();
        const tokenIssuedMs = decoded.iat * 1000; // JWT iat is in seconds
        if (tokenIssuedMs < validAfterMs) {
          return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
        }
      }
    }

    req.user = decoded; // { id, username, role, hotelId?, room? }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Platform super admin authentication ───────────────────────────────────────
function authenticatePlatformAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'superadmin') {
      return res.status(403).json({ error: 'Platform admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Role-based access: require one of the specified roles ─────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ── Generate hotel staff/guest access token (short-lived) ─────────────────────
function generateAccessToken(user) {
  const payload = { id: user.id, username: user.username, role: user.role };
  if (user.hotelId) payload.hotelId = user.hotelId;
  if (user.room)    payload.room    = user.room;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY || '8h' });
}

// ── Generate platform admin access token ──────────────────────────────────────
function generatePlatformAdminToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, role: 'superadmin' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '8h' }
  );
}

// ── Generate refresh token (long-lived) ───────────────────────────────────────
function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
}

// ── Generate group user access token ──────────────────────────────────────────
function generateGroupUserToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: 'group_user', fullName: user.full_name || null },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '8h' }
  );
}

// ── Authenticate any platform-level user (superadmin OR group_user) ───────────
function authenticatePlatformAny(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'superadmin' && decoded.role !== 'group_user') {
      return res.status(403).json({ error: 'Platform access required' });
    }
    req.platformUser = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Authenticate group user only ──────────────────────────────────────────────
function authenticateGroupUser(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'group_user') {
      return res.status(403).json({ error: 'Group user access required' });
    }
    req.groupUser = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = {
  setDB,
  authenticate,
  authenticatePlatformAdmin,
  authenticatePlatformAny,
  authenticateGroupUser,
  requireRole,
  generateAccessToken,
  generatePlatformAdminToken,
  generateGroupUserToken,
  generateRefreshToken,
  JWT_SECRET
};
