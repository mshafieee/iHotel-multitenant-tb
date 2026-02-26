/**
 * Hilton Grand Hotel — Authentication Middleware
 * JWT token verification + role-based access control
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_hilton_default';

// Verify JWT and attach user to request
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, role }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Role-based access: require one of the specified roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Generate access token (short-lived)
function generateAccessToken(user) {
  const payload = { id: user.id, username: user.username, role: user.role };
  if (user.room) payload.room = user.room;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY || '8h' });
}

// Generate refresh token (long-lived)
function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
}

module.exports = { authenticate, requireRole, generateAccessToken, generateRefreshToken, JWT_SECRET };
