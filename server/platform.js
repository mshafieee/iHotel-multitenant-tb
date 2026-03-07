/**
 * iHotel SaaS Platform — Platform Admin Router
 * All routes require a valid super-admin JWT (role: superadmin)
 *
 * Routes:
 *   POST   /api/platform/auth/login              Super admin login
 *   GET    /api/platform/auth/me                 Current admin info
 *   POST   /api/platform/hotels                  Create hotel tenant
 *   GET    /api/platform/hotels                  List all hotels
 *   GET    /api/platform/hotels/:id              Hotel detail
 *   PUT    /api/platform/hotels/:id              Update hotel / TB credentials
 *   DELETE /api/platform/hotels/:id              Deactivate hotel
 *   POST   /api/platform/hotels/:id/discover     Auto-discover rooms from ThingsBoard
 *   POST   /api/platform/hotels/:id/rooms        Import rooms manually (JSON or CSV)
 *   GET    /api/platform/hotels/:id/rooms        List hotel rooms
 *   POST   /api/platform/hotels/:id/users        Create hotel user
 *   GET    /api/platform/hotels/:id/users        List hotel users
 *   PUT    /api/platform/hotels/:id/users/:uid   Update hotel user
 *   GET    /api/platform/metrics                 Platform-wide metrics
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');

const { authenticatePlatformAdmin, generatePlatformAdminToken } = require('./auth');
const { seedHotelRates, seedHotelUsers, seedRoomDefaultScenes } = require('./db');
const { ThingsBoardClient, ThingsBoardClientPool } = require('./thingsboard');

const router = express.Router();
let _db   = null;
let _pool = null;

// Injected by index.js
function init(db, tbPool) {
  _db   = db;
  _pool = tbPool;
}

// Rate limiter for platform login
const platformAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true, legacyHeaders: false
});

// ── Platform admin login ───────────────────────────────────────────────────────
router.post('/auth/login', platformAuthLimiter, (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const admin = _db.prepare('SELECT * FROM platform_admins WHERE username = ? AND active = 1').get(username);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generatePlatformAdminToken(admin);
    res.json({
      accessToken: token,
      admin: { id: admin.id, username: admin.username, fullName: admin.full_name }
    });
  } catch (e) {
    console.error('Platform login error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/auth/me', authenticatePlatformAdmin, (req, res) => {
  const admin = _db.prepare('SELECT id, username, full_name FROM platform_admins WHERE id = ?').get(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Not found' });
  res.json({ id: admin.id, username: admin.username, fullName: admin.full_name });
});

router.put('/auth/password', authenticatePlatformAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const admin = _db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(req.admin.id);
  if (!admin || !bcrypt.compareSync(currentPassword || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  _db.prepare('UPDATE platform_admins SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), admin.id);
  res.json({ success: true });
});

// ── Hotel management ───────────────────────────────────────────────────────────
router.post('/hotels', authenticatePlatformAdmin, (req, res) => {
  const { name, slug, contactEmail, plan, tbHost, tbUser, tbPass } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Slug must be lowercase letters, digits, and hyphens only' });
  }

  const id = crypto.randomUUID();

  try {
    _db.prepare(`INSERT INTO hotels (id, name, slug, contact_email, plan, tb_host, tb_user, tb_pass)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, slug, contactEmail || null, plan || 'starter',
           tbHost || null, tbUser || null, tbPass || null);

    seedHotelRates(_db, id);
    seedHotelUsers(_db, id, slug);

    res.json({
      hotel: { id, name, slug, contactEmail, plan: plan || 'starter', active: true },
      defaultUserPassword: `iHotel-${slug}-2026`
    });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Slug already taken' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/hotels', authenticatePlatformAdmin, (req, res) => {
  const hotels = _db.prepare('SELECT * FROM hotels ORDER BY created_at DESC').all();
  const result = hotels.map(h => {
    const roomCount = _db.prepare('SELECT COUNT(*) as c FROM hotel_rooms WHERE hotel_id = ?').get(h.id).c;
    const userCount = _db.prepare('SELECT COUNT(*) as c FROM hotel_users WHERE hotel_id = ? AND active = 1').get(h.id).c;
    const activeRes = _db.prepare('SELECT COUNT(*) as c FROM reservations WHERE hotel_id = ? AND active = 1').get(h.id).c;
    const hasTB     = !!(h.tb_host && h.tb_user && h.tb_pass);
    return {
      id: h.id, name: h.name, slug: h.slug, contactEmail: h.contact_email,
      plan: h.plan, active: !!h.active, createdAt: h.created_at,
      tbConfigured: hasTB, tbHost: h.tb_host || null,
      roomCount, userCount, activeReservations: activeRes
    };
  });
  res.json(result);
});

router.get('/hotels/:id', authenticatePlatformAdmin, (req, res) => {
  const hotel = _db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  const rooms   = _db.prepare('SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY floor, room_number').all(hotel.id);
  const users   = _db.prepare('SELECT id, username, role, full_name, active, last_login FROM hotel_users WHERE hotel_id = ?').all(hotel.id);
  const revenue = _db.prepare('SELECT SUM(total_amount) as total FROM income_log WHERE hotel_id = ?').get(hotel.id);

  res.json({
    id: hotel.id, name: hotel.name, slug: hotel.slug, contactEmail: hotel.contact_email,
    plan: hotel.plan, active: !!hotel.active, createdAt: hotel.created_at,
    tbHost: hotel.tb_host || null,
    tbUser: hotel.tb_user || null,
    tbConfigured: !!(hotel.tb_host && hotel.tb_user && hotel.tb_pass),
    rooms, users, totalRevenue: revenue.total || 0
  });
});

router.put('/hotels/:id', authenticatePlatformAdmin, (req, res) => {
  const { name, contactEmail, plan, active, tbHost, tbUser, tbPass } = req.body;
  const hotel = _db.prepare('SELECT id FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  _db.prepare(`UPDATE hotels SET
    name          = COALESCE(?, name),
    contact_email = COALESCE(?, contact_email),
    plan          = COALESCE(?, plan),
    active        = COALESCE(?, active),
    tb_host       = COALESCE(?, tb_host),
    tb_user       = COALESCE(?, tb_user),
    tb_pass       = COALESCE(?, tb_pass)
    WHERE id = ?`)
    .run(name ?? null, contactEmail ?? null, plan ?? null,
         active != null ? (active ? 1 : 0) : null,
         tbHost ?? null, tbUser ?? null, tbPass ?? null,
         hotel.id);

  // Invalidate cached TB client if credentials changed
  if (tbHost || tbUser || tbPass) {
    _pool?.invalidate(hotel.id);
  }

  res.json({ success: true });
});

router.delete('/hotels/:id', authenticatePlatformAdmin, (req, res) => {
  const hotel = _db.prepare('SELECT id FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
  _db.prepare('UPDATE hotels SET active = 0 WHERE id = ?').run(hotel.id);
  _pool?.invalidate(hotel.id);
  res.json({ success: true });
});

// ── ThingsBoard: auto-discover rooms ──────────────────────────────────────────
// Connects to hotel's TB instance, fetches all gateway-room-* devices,
// and populates hotel_rooms with room_number + tb_device_id.
router.post('/hotels/:id/discover', authenticatePlatformAdmin, async (req, res) => {
  const hotel = _db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
  if (!hotel.tb_host || !hotel.tb_user || !hotel.tb_pass) {
    return res.status(400).json({ error: 'ThingsBoard credentials not configured for this hotel' });
  }

  try {
    const client  = new ThingsBoardClient(hotel.tb_host, hotel.tb_user, hotel.tb_pass);
    const devices = await client.getDevices(); // returns gateway-room-* devices

    const ins = _db.prepare(`INSERT OR REPLACE INTO hotel_rooms
      (hotel_id, room_number, floor, room_type, tb_device_id)
      VALUES (?, ?, ?, ?, ?)`);

    let discovered = 0;
    const newRooms = [];
    const runAll = _db.transaction(() => {
      for (const dev of devices) {
        // Device name format: gateway-room-{room_number}
        // e.g. gateway-room-101, gateway-room-201A
        const match = dev.name.match(/^gateway-room-(.+)$/);
        if (!match) continue;

        const roomNumber = match[1];
        const floor = parseInt(roomNumber.substring(0, roomNumber.length - 2)) || 1;

        // Only insert if not already existing with a device ID
        const existing = _db.prepare(
          'SELECT tb_device_id FROM hotel_rooms WHERE hotel_id = ? AND room_number = ?'
        ).get(hotel.id, roomNumber);

        ins.run(hotel.id, roomNumber, floor, existing?.room_type || 'STANDARD', dev.id.id);
        if (!existing) newRooms.push(roomNumber);
        discovered++;
      }
    });
    runAll();

    // Seed default scenes for brand-new rooms
    for (const roomNumber of newRooms) seedRoomDefaultScenes(_db, hotel.id, roomNumber);

    // Refresh pool since we just validated credentials
    _pool?.invalidate(hotel.id);

    res.json({ success: true, discovered, total: devices.length });
  } catch (e) {
    console.error('TB discover error:', e.message);
    res.status(502).json({ error: `ThingsBoard connection failed: ${e.message}` });
  }
});

// ── Room import (manual JSON or CSV) ──────────────────────────────────────────
router.post('/hotels/:id/rooms', authenticatePlatformAdmin, (req, res) => {
  const hotel = _db.prepare('SELECT id FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  let rows = [];

  if (Array.isArray(req.body)) {
    rows = req.body;
  } else if (req.body.csv) {
    const lines  = req.body.csv.trim().split('\n');
    const header = lines[0].toLowerCase().split(',').map(s => s.trim());
    const ri = Math.max(header.indexOf('room_number'), header.indexOf('room'));
    const fi = header.indexOf('floor');
    const ti = Math.max(header.indexOf('room_type'), header.indexOf('type'));
    const di = header.indexOf('tb_device_id');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(s => s.trim());
      if (!cols[ri]) continue;
      rows.push({
        room_number:  cols[ri],
        floor:        parseInt(cols[fi] || '1'),
        room_type:    (cols[ti] || 'STANDARD').toUpperCase(),
        tb_device_id: di >= 0 ? (cols[di] || null) : null
      });
    }
  } else if (req.body.rooms) {
    rows = req.body.rooms;
  }

  if (!rows.length) return res.status(400).json({ error: 'No room data provided' });

  const VALID_TYPES = ['STANDARD', 'DELUXE', 'SUITE', 'VIP'];
  const ins = _db.prepare(`INSERT OR REPLACE INTO hotel_rooms
    (hotel_id, room_number, floor, room_type, tb_device_id) VALUES (?, ?, ?, ?, ?)`);

  let inserted = 0, errors = 0;
  const newRooms = [];
  const runAll = _db.transaction(() => {
    for (const row of rows) {
      const rn = String(row.room_number || '').trim();
      const fl = parseInt(row.floor || 1);
      const rt = String(row.room_type || 'STANDARD').toUpperCase();
      const td = row.tb_device_id || null;
      if (!rn || isNaN(fl)) { errors++; continue; }
      const existing = _db.prepare('SELECT 1 FROM hotel_rooms WHERE hotel_id=? AND room_number=?').get(hotel.id, rn);
      ins.run(hotel.id, rn, fl, VALID_TYPES.includes(rt) ? rt : 'STANDARD', td);
      if (!existing) newRooms.push(rn);
      inserted++;
    }
  });
  runAll();

  // Seed default scenes for brand-new rooms
  for (const rn of newRooms) seedRoomDefaultScenes(_db, hotel.id, rn);

  res.json({ success: true, inserted, errors, total: rows.length });
});

router.get('/hotels/:id/rooms', authenticatePlatformAdmin, (req, res) => {
  const rooms = _db.prepare(
    'SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY floor, room_number'
  ).all(req.params.id);
  res.json(rooms);
});

// ── Hotel user management ──────────────────────────────────────────────────────
router.post('/hotels/:id/users', authenticatePlatformAdmin, (req, res) => {
  const { username, password, role, fullName } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, role required' });
  }

  const VALID_ROLES = ['owner', 'admin', 'frontdesk'];
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const hotel = _db.prepare('SELECT id FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  try {
    _db.prepare(`INSERT INTO hotel_users (hotel_id, username, password_hash, role, full_name)
                 VALUES (?, ?, ?, ?, ?)`)
      .run(hotel.id, username, bcrypt.hashSync(password, 10), role, fullName || null);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists in this hotel' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/hotels/:id/users', authenticatePlatformAdmin, (req, res) => {
  const users = _db.prepare(`SELECT id, username, role, full_name, active, last_login, created_at
                              FROM hotel_users WHERE hotel_id = ? ORDER BY created_at`).all(req.params.id);
  res.json(users);
});

router.put('/hotels/:id/users/:uid', authenticatePlatformAdmin, (req, res) => {
  const { role, fullName, active, password } = req.body;
  const user = _db.prepare('SELECT * FROM hotel_users WHERE id = ? AND hotel_id = ?')
    .get(req.params.uid, req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (role && !['owner', 'admin', 'frontdesk'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  _db.prepare(`UPDATE hotel_users SET
    full_name = COALESCE(?, full_name),
    role      = COALESCE(?, role),
    active    = COALESCE(?, active)
    WHERE id = ?`)
    .run(fullName ?? null, role ?? null, active != null ? (active ? 1 : 0) : null, user.id);

  if (password && password.length >= 6) {
    _db.prepare('UPDATE hotel_users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), user.id);
  }

  res.json({ success: true });
});

// ── Platform metrics ───────────────────────────────────────────────────────────
router.get('/metrics', authenticatePlatformAdmin, (req, res) => {
  const totalHotels  = _db.prepare('SELECT COUNT(*) as c FROM hotels WHERE active = 1').get().c;
  const totalRooms   = _db.prepare('SELECT COUNT(*) as c FROM hotel_rooms').get().c;
  const configuredRooms = _db.prepare('SELECT COUNT(*) as c FROM hotel_rooms WHERE tb_device_id IS NOT NULL').get().c;
  const activeRes    = _db.prepare('SELECT COUNT(*) as c FROM reservations WHERE active = 1').get().c;
  const totalRevenue = _db.prepare('SELECT SUM(total_amount) as t FROM income_log').get().t || 0;
  const totalUsers   = _db.prepare('SELECT COUNT(*) as c FROM hotel_users WHERE active = 1').get().c;

  const byHotel = _db.prepare(`
    SELECT h.name, h.slug, SUM(i.total_amount) as revenue, COUNT(i.id) as stays
    FROM income_log i
    JOIN hotels h ON h.id = i.hotel_id
    GROUP BY i.hotel_id ORDER BY revenue DESC LIMIT 10
  `).all();

  res.json({
    totalHotels, totalRooms, configuredRooms,
    activeReservations: activeRes,
    totalRevenue, totalUsers,
    revenueByHotel: byHotel
  });
});

module.exports = { router, init };
