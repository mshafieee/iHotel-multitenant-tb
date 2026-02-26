/**
 * API Integration Tests (Supertest)
 * Tests all REST endpoints: auth, hotel overview, PMS, finance, users, shifts
 *
 * ThingsBoard is fully mocked — no real TB server required.
 * DB uses :memory: via the better-sqlite3 mock.
 * Rate limiters are neutralized so login tests don't hit 429.
 */

// ── Neutralize rate limiters ─────────────────────────────────────────────────
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

// ── Redirect DB to :memory: ──────────────────────────────────────────────────
jest.mock('better-sqlite3', () => {
  const RealDB = jest.requireActual('better-sqlite3');
  return function() { return new RealDB(':memory:'); };
});

// ── Mock ThingsBoard client ──────────────────────────────────────────────────
jest.mock('../thingsboard', () => {
  const MockTB = jest.fn().mockImplementation(() => ({
    ensureAuth:         jest.fn().mockResolvedValue(undefined),
    getDevices:         jest.fn().mockResolvedValue([
      { id: { id: 'dev-101' }, name: 'gateway-room-101', type: 'default' },
      { id: { id: 'dev-102' }, name: 'gateway-room-102', type: 'default' },
    ]),
    getAllTelemetry:     jest.fn().mockResolvedValue({
      'dev-101': {
        roomStatus:       [{ value: '1' }],
        temperature:      [{ value: '22.5' }],
        humidity:         [{ value: '55' }],
        co2:              [{ value: '800' }],
        elecConsumption:  [{ value: '100' }],
        waterConsumption: [{ value: '5' }],
      },
      'dev-102': {
        roomStatus:       [{ value: '0' }],
        temperature:      [{ value: '24.0' }],
        humidity:         [{ value: '50' }],
        co2:              [{ value: '600' }],
        elecConsumption:  [{ value: '50' }],
        waterConsumption: [{ value: '2' }],
      },
    }),
    getTelemetry:        jest.fn().mockResolvedValue({}),
    saveTelemetry:       jest.fn().mockResolvedValue(undefined),
    setAttribute:        jest.fn().mockResolvedValue(undefined),
    getSharedAttributes: jest.fn().mockResolvedValue([]),
    getAttributes:       jest.fn().mockResolvedValue({}),
    sendRpc:             jest.fn().mockResolvedValue({ payload: 'ok' }),
    getWsToken:          jest.fn().mockReturnValue('mock-ws-token'),
  }));
  return { ThingsBoardClient: MockTB };
});

const request = require('supertest');
const { app } = require('../index');
const { generateAccessToken } = require('../auth');

// ── Token helpers ────────────────────────────────────────────────────────────
function ownerToken()     { return generateAccessToken({ id: 1, username: 'owner',     role: 'owner'     }); }
function adminToken()     { return generateAccessToken({ id: 2, username: 'admin',     role: 'admin'     }); }
function frontdeskToken() { return generateAccessToken({ id: 3, username: 'frontdesk', role: 'frontdesk' }); }
function auth(token)      { return { Authorization: `Bearer ${token}` }; }

// ═════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/auth/login', () => {
  test('valid owner credentials → 200 with accessToken + user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'owner', password: 'hilton2026' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toMatchObject({ username: 'owner', role: 'owner' });
  });

  test('valid frontdesk credentials → 200 with role=frontdesk', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'frontdesk', password: 'hilton2026' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('frontdesk');
  });

  test('wrong password → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'owner', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('unknown user → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'any' });
    expect(res.status).toBe(401);
  });

  test('missing body fields → 400 or 401', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect([400, 401]).toContain(res.status);
  });
});

describe('GET /api/auth/me', () => {
  test('returns current user with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('username', 'owner');
    expect(res.body).toHaveProperty('role', 'owner');
  });

  test('returns 401 without token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  test('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set({ Authorization: 'Bearer bad.token.here' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  test('logout with valid token → 200 (clears refresh tokens for user)', async () => {
    // Use a pre-signed token — no need to go through login route
    const res = await request(app)
      .post('/api/auth/logout')
      .set(auth(adminToken()));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  test('logout without token → 401', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HOTEL OVERVIEW
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/hotel/overview', () => {
  test('requires authentication', async () => {
    expect((await request(app).get('/api/hotel/overview')).status).toBe(401);
  });

  test('returns rooms object and deviceCount for authenticated user', async () => {
    const res = await request(app)
      .get('/api/hotel/overview')
      .set(auth(frontdeskToken()));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rooms');
    expect(typeof res.body.rooms).toBe('object');
    expect(res.body).toHaveProperty('deviceCount');
  });

  test('rooms contains device data from mock TB', async () => {
    const res = await request(app)
      .get('/api/hotel/overview')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    // Mock returns 2 devices (gateway-room-101, gateway-room-102)
    expect(Object.keys(res.body.rooms)).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/logs', () => {
  test('requires auth', async () => {
    expect((await request(app).get('/api/logs')).status).toBe(401);
  });

  test('returns array of logs for authenticated user', async () => {
    const res = await request(app)
      .get('/api/logs')
      .set(auth(adminToken()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('accepts category filter without error', async () => {
    const res = await request(app)
      .get('/api/logs?category=system')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PMS — RESERVATIONS
// ═════════════════════════════════════════════════════════════════════════════
describe('PMS Reservations', () => {
  let createdReservationId;

  const tomorrow   = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const dayAfter   = () => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); };
  const threeDays  = () => { const d = new Date(); d.setDate(d.getDate() + 4); return d.toISOString().slice(0, 10); };

  test('GET /api/pms/reservations requires auth', async () => {
    expect((await request(app).get('/api/pms/reservations')).status).toBe(401);
  });

  test('GET /api/pms/reservations returns array', async () => {
    const res = await request(app)
      .get('/api/pms/reservations')
      .set(auth(frontdeskToken()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/pms/reservations creates a reservation', async () => {
    const res = await request(app)
      .post('/api/pms/reservations')
      .set(auth(frontdeskToken()))
      .send({
        room: '101',
        guestName: 'John Doe',
        checkIn:   tomorrow(),
        checkOut:  dayAfter(),
        roomType:  'STANDARD',
        paymentMethod: 'cash',
        ratePerNight: 600
      });
    expect(res.status).toBe(200);
    // Response shape: { reservation: {...}, password, guestUrl }
    expect(res.body).toHaveProperty('reservation');
    expect(res.body.reservation).toHaveProperty('id');
    expect(res.body.reservation).toHaveProperty('token');
    expect(res.body.reservation).toHaveProperty('totalAmount');
    expect(res.body.reservation.totalAmount).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('password');
    expect(res.body).toHaveProperty('guestUrl');
    createdReservationId = res.body.reservation.id;
  });

  test('POST /api/pms/reservations rejects missing fields → 400', async () => {
    const res = await request(app)
      .post('/api/pms/reservations')
      .set(auth(frontdeskToken()))
      .send({ room: '101' }); // missing guestName, checkIn, checkOut
    expect(res.status).toBe(400);
  });

  test('POST /api/pms/reservations/:id/extend requires auth → 401', async () => {
    const res = await request(app)
      .post('/api/pms/reservations/nonexistent/extend')
      .send({ newCheckOut: threeDays(), paymentMethod: 'cash' });
    expect(res.status).toBe(401);
  });

  test('POST /api/pms/reservations/:id/extend with non-existent id → 404', async () => {
    const res = await request(app)
      .post('/api/pms/reservations/nonexistent-id/extend')
      .set(auth(frontdeskToken()))
      .send({ newCheckOut: threeDays(), paymentMethod: 'cash' });
    expect(res.status).toBe(404);
  });

  test('POST /api/pms/reservations/:id/extend with valid id extends stay', async () => {
    // Depends on the reservation created above
    if (!createdReservationId) return;
    const res = await request(app)
      .post(`/api/pms/reservations/${createdReservationId}/extend`)
      .set(auth(frontdeskToken()))
      .send({ newCheckOut: threeDays(), paymentMethod: 'visa' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('nights');
    expect(res.body.nights).toBeGreaterThan(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FINANCE
// ═════════════════════════════════════════════════════════════════════════════
describe('Finance APIs (owner-only)', () => {
  test('GET /api/finance/rates returns 4 room type rates', async () => {
    const res = await request(app)
      .get('/api/finance/rates')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
    expect(res.body.map(r => r.room_type)).toContain('STANDARD');
    expect(res.body.map(r => r.room_type)).toContain('VIP');
  });

  test('GET /api/finance/rates blocked for frontdesk → 403', async () => {
    expect((await request(app).get('/api/finance/rates').set(auth(frontdeskToken()))).status).toBe(403);
  });

  test('PUT /api/finance/rates updates a rate (owner)', async () => {
    const res = await request(app)
      .put('/api/finance/rates')
      .set(auth(ownerToken()))
      .send({ roomType: 'STANDARD', ratePerNight: 650 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  test('PUT /api/finance/rates blocked for admin → 403', async () => {
    const res = await request(app)
      .put('/api/finance/rates')
      .set(auth(adminToken()))
      .send({ roomType: 'STANDARD', ratePerNight: 700 });
    expect(res.status).toBe(403);
  });

  test('GET /api/finance/income returns rows array (owner)', async () => {
    const res = await request(app)
      .get('/api/finance/income')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    // Shape: { rows: [...], total: N, totalAmount: N }
    expect(res.body).toHaveProperty('rows');
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalAmount');
  });

  test('GET /api/finance/summary returns aggregated data (owner)', async () => {
    const res = await request(app)
      .get('/api/finance/summary')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    // Shape: { byType: [...], byPayment: [...], total: N }
    expect(res.body).toHaveProperty('byType');
    expect(res.body).toHaveProperty('byPayment');
    expect(res.body).toHaveProperty('total');
  });

  test('GET /api/finance/income blocked for frontdesk → 403', async () => {
    expect((await request(app).get('/api/finance/income').set(auth(frontdeskToken()))).status).toBe(403);
  });

  test('GET /api/finance/summary blocked for frontdesk → 403', async () => {
    expect((await request(app).get('/api/finance/summary').set(auth(frontdeskToken()))).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════
describe('User Management APIs', () => {
  test('GET /api/users returns list for owner', async () => {
    const res = await request(app)
      .get('/api/users')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  test('GET /api/users blocked for frontdesk → 403', async () => {
    expect((await request(app).get('/api/users').set(auth(frontdeskToken()))).status).toBe(403);
  });

  test('POST /api/users creates a new user (owner)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(ownerToken()))
      .send({ username: 'teststaff', password: 'pass123', role: 'frontdesk', fullName: 'Test Staff' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  test('POST /api/users rejects invalid role → 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(ownerToken()))
      .send({ username: 'baduser', password: 'pass123', role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  test('POST /api/users blocked for admin → 403', async () => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(adminToken()))
      .send({ username: 'another', password: 'pass123', role: 'frontdesk' });
    expect(res.status).toBe(403);
  });

  test('DELETE /api/users/:id deactivates user (owner)', async () => {
    // Create a user to delete
    await request(app)
      .post('/api/users')
      .set(auth(ownerToken()))
      .send({ username: 'todelete', password: 'pass123', role: 'frontdesk' });

    const list = await request(app).get('/api/users').set(auth(ownerToken()));
    const target = list.body.find(u => u.username === 'todelete');
    expect(target).toBeDefined();

    const res = await request(app)
      .delete(`/api/users/${target.id}`)
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);

    const list2 = await request(app).get('/api/users').set(auth(ownerToken()));
    const deleted = list2.body.find(u => u.username === 'todelete');
    expect(deleted.active).toBeFalsy();
  });

  test('DELETE /api/users/:id blocked for admin → 403', async () => {
    const list = await request(app).get('/api/users').set(auth(ownerToken()));
    const target = list.body[0];
    expect((await request(app).delete(`/api/users/${target.id}`).set(auth(adminToken()))).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SHIFTS
// ═════════════════════════════════════════════════════════════════════════════
describe('Shifts APIs', () => {
  test('POST /api/shifts/open opens a shift', async () => {
    const res = await request(app)
      .post('/api/shifts/open')
      .set(auth(frontdeskToken()));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('status', 'open');
  });

  test('POST /api/shifts/open rejects double-open for same user → 400', async () => {
    const res = await request(app)
      .post('/api/shifts/open')
      .set(auth(frontdeskToken()));
    expect(res.status).toBe(400);
  });

  test('GET /api/shifts/current returns the open shift', async () => {
    const res = await request(app)
      .get('/api/shifts/current')
      .set(auth(frontdeskToken()));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'open');
  });

  test('POST /api/shifts/close closes the open shift', async () => {
    const res = await request(app)
      .post('/api/shifts/close')
      .set(auth(frontdeskToken()))
      .send({ actualCash: 500, actualVisa: 200, notes: 'End of day' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  test('GET /api/shifts returns list for owner', async () => {
    const res = await request(app)
      .get('/api/shifts')
      .set(auth(ownerToken()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/shifts blocked for frontdesk → 403', async () => {
    expect((await request(app).get('/api/shifts').set(auth(frontdeskToken()))).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROOM ENDPOINTS (reset, checkout)
// ═════════════════════════════════════════════════════════════════════════════
describe('Room Endpoints', () => {
  test('POST /api/rooms/:room/reset requires admin or owner', async () => {
    expect((await request(app).post('/api/rooms/101/reset').set(auth(frontdeskToken()))).status).toBe(403);
  });

  test('POST /api/rooms/:room/reset requires auth', async () => {
    expect((await request(app).post('/api/rooms/101/reset')).status).toBe(401);
  });

  test('POST /api/rooms/reset-all requires auth', async () => {
    expect((await request(app).post('/api/rooms/reset-all')).status).toBe(401);
  });

  test('POST /api/rooms/reset-all requires admin or owner', async () => {
    expect((await request(app).post('/api/rooms/reset-all').set(auth(frontdeskToken()))).status).toBe(403);
  });

  test('POST /api/rooms/:room/checkout requires frontdesk+', async () => {
    expect((await request(app).post('/api/rooms/101/checkout')).status).toBe(401);
  });

  test('POST /api/rooms/:room/checkout by frontdesk → 200 or 404 (no active reservation)', async () => {
    const res = await request(app)
      .post('/api/rooms/999/checkout')
      .set(auth(frontdeskToken()));
    // 404 = no reservation for room 999, which is correct behavior
    expect([200, 404]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SIMULATOR
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/simulator/inject', () => {
  test('requires auth → 401', async () => {
    expect((await request(app).post('/api/simulator/inject').send({ room: '101', telemetry: { temperature: 25 } })).status).toBe(401);
  });

  test('requires admin or owner role → 403 for frontdesk', async () => {
    const res = await request(app)
      .post('/api/simulator/inject')
      .set(auth(frontdeskToken()))
      .send({ room: '101', telemetry: { temperature: 25 } });
    expect(res.status).toBe(403);
  });

  test('owner can inject (200) or room not found (404)', async () => {
    const res = await request(app)
      .post('/api/simulator/inject')
      .set(auth(ownerToken()))
      .send({ room: '101', telemetry: { temperature: 28, humidity: 60 } });
    // After overview is fetched, deviceRoomMap is populated — room 101 should be mapped
    expect([200, 404]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TODAY'S CHECKOUTS
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/pms/today-checkouts', () => {
  test('requires auth → 401', async () => {
    expect((await request(app).get('/api/pms/today-checkouts')).status).toBe(401);
  });

  test('returns array for frontdesk', async () => {
    const res = await request(app)
      .get('/api/pms/today-checkouts')
      .set(auth(frontdeskToken()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GUEST LOGIN
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/guest/login', () => {
  test('missing password → 400', async () => {
    const res = await request(app)
      .post('/api/guest/login')
      .send({ room: '101' }); // no password
    expect(res.status).toBe(400);
  });

  test('missing room and token → 400', async () => {
    const res = await request(app)
      .post('/api/guest/login')
      .send({ password: '123456' }); // no room or token
    expect(res.status).toBe(400);
  });

  test('invalid reservation token → 401', async () => {
    const res = await request(app)
      .post('/api/guest/login')
      .send({ token: 'invalid-hex-token-does-not-exist', password: 'wrongpw' });
    expect(res.status).toBe(401);
  });

  test('room with no active reservation → 401', async () => {
    const res = await request(app)
      .post('/api/guest/login')
      .send({ room: '999', password: 'wrongpw' });
    // TEST_PW is '000000' by default; 'wrongpw' != '000000'
    expect(res.status).toBe(401);
  });
});
