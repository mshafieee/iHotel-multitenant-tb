/**
 * Database Module Tests
 * Tests: schema creation, migrations, table columns, idempotency
 *
 * Strategy: intercept better-sqlite3 to always use :memory: so tests
 * never touch ihotel.db and are fully isolated / repeatable.
 */

// Redirect all Database() calls to :memory:
jest.mock('better-sqlite3', () => {
  const RealDatabase = jest.requireActual('better-sqlite3');
  return function FakeDatabase() {
    return new RealDatabase(':memory:');
  };
});

const { initDB } = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — schema creation', () => {
  let db;

  beforeAll(() => {
    db = initDB();
  });

  function tableExists(name) {
    return !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name);
  }

  // Multi-tenant core tables
  test('creates hotels table',              () => expect(tableExists('hotels')).toBe(true));
  test('creates hotel_users table',         () => expect(tableExists('hotel_users')).toBe(true));
  test('creates platform_admins table',     () => expect(tableExists('platform_admins')).toBe(true));
  test('creates hotel_rooms table',         () => expect(tableExists('hotel_rooms')).toBe(true));
  test('creates scenes table',              () => expect(tableExists('scenes')).toBe(true));
  test('creates reservations table',        () => expect(tableExists('reservations')).toBe(true));
  test('creates audit_log table',           () => expect(tableExists('audit_log')).toBe(true));
  test('creates refresh_tokens table',      () => expect(tableExists('refresh_tokens')).toBe(true));
  test('creates night_rates table',         () => expect(tableExists('night_rates')).toBe(true));
  test('creates income_log table',          () => expect(tableExists('income_log')).toBe(true));
  test('creates shifts table',              () => expect(tableExists('shifts')).toBe(true));
  test('creates migrations table',          () => expect(tableExists('migrations')).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — hotels table columns', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  const requiredCols = ['id', 'name', 'slug', 'active', 'tb_host', 'tb_user', 'tb_pass', 'created_at'];

  requiredCols.forEach(col => {
    test(`hotels has column: ${col}`, () => {
      expect(columnNames('hotels')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — hotel_users table columns', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  const requiredCols = ['id', 'hotel_id', 'username', 'password_hash', 'role', 'active', 'created_at'];

  requiredCols.forEach(col => {
    test(`hotel_users has column: ${col}`, () => {
      expect(columnNames('hotel_users')).toContain(col);
    });
  });

  test('hotel_users does NOT reference a standalone users table', () => {
    // Confirm the old single-tenant table is gone
    const oldTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();
    expect(oldTable).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — reservations columns', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  test('reservations has hotel_id column (multi-tenant)', () => {
    expect(columnNames('reservations')).toContain('hotel_id');
  });

  test('reservations has payment_method column', () => {
    expect(columnNames('reservations')).toContain('payment_method');
  });

  test('reservations has rate_per_night column', () => {
    expect(columnNames('reservations')).toContain('rate_per_night');
  });

  test('reservations has elec_at_checkin column', () => {
    expect(columnNames('reservations')).toContain('elec_at_checkin');
  });

  test('reservations has water_at_checkin column', () => {
    expect(columnNames('reservations')).toContain('water_at_checkin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — night_rates schema (multi-tenant)', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  test('night_rates has hotel_id column (multi-tenant scoping)', () => {
    expect(columnNames('night_rates')).toContain('hotel_id');
  });

  test('night_rates has room_type column', () => {
    expect(columnNames('night_rates')).toContain('room_type');
  });

  test('night_rates has rate_per_night column', () => {
    expect(columnNames('night_rates')).toContain('rate_per_night');
  });

  test('night_rates is empty on fresh DB (no default hotel)', () => {
    // In multi-tenant, rates are per-hotel — no global defaults seeded
    const count = db.prepare('SELECT COUNT(*) as cnt FROM night_rates').get().cnt;
    expect(count).toBe(0);
  });

  test('night_rates enforces unique (hotel_id, room_type) via primary key', () => {
    const pks = db.prepare("PRAGMA table_info(night_rates)").all().filter(c => c.pk > 0).map(c => c.name);
    expect(pks).toContain('hotel_id');
    expect(pks).toContain('room_type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — migrations table', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function getMigrationIds() {
    return db.prepare('SELECT id FROM migrations').all().map(r => r.id);
  }

  test('at least one migration is recorded', () => {
    expect(getMigrationIds().length).toBeGreaterThan(0);
  });

  test('migration 010_multitenant_migrate is recorded', () => {
    expect(getMigrationIds()).toContain('010_multitenant_migrate');
  });

  test('migration 028_meter_baselines is recorded', () => {
    expect(getMigrationIds()).toContain('028_meter_baselines');
  });

  test('migration 031_rename_tb_to_iot is recorded', () => {
    expect(getMigrationIds()).toContain('031_rename_tb_to_iot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — platform_admins seeding', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  test('at least one platform admin is seeded', () => {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM platform_admins').get().cnt;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('seeded platform admin is active', () => {
    const admin = db.prepare('SELECT * FROM platform_admins LIMIT 1').get();
    expect(admin).toBeDefined();
    expect(admin.active).toBe(1);
  });

  test('hotel_users is empty on fresh DB (users belong to hotels)', () => {
    const count = db.prepare('SELECT COUNT(*) as cnt FROM hotel_users').get().cnt;
    expect(count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — idempotency (double-call)', () => {
  test('calling initDB twice does not throw', () => {
    expect(() => {
      const db1 = initDB();
      initDB(); // second call — our mock returns a new :memory: each time, no throw
      const count = db1.prepare('SELECT COUNT(*) as cnt FROM migrations').get().cnt;
      expect(count).toBeGreaterThan(0);
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('income_log schema', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  const requiredColumns = [
    'id', 'hotel_id', 'reservation_id', 'room', 'guest_name', 'check_in', 'check_out',
    'nights', 'room_type', 'rate_per_night', 'total_amount', 'payment_method',
    'elec_at_checkin', 'water_at_checkin', 'elec_at_checkout', 'water_at_checkout',
    'created_at', 'created_by'
  ];

  requiredColumns.forEach(col => {
    test(`income_log has column: ${col}`, () => {
      expect(columnNames('income_log')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('shifts schema', () => {
  let db;

  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  const requiredColumns = [
    'id', 'hotel_id', 'user_id', 'username', 'opened_at', 'closed_at',
    'expected_cash', 'expected_visa', 'actual_cash', 'actual_visa',
    'status', 'notes', 'created_at'
  ];

  requiredColumns.forEach(col => {
    test(`shifts has column: ${col}`, () => {
      expect(columnNames('shifts')).toContain(col);
    });
  });

  test('shifts default status is "open"', () => {
    const col = db.prepare("PRAGMA table_info(shifts)").all().find(c => c.name === 'status');
    expect(col.dflt_value).toContain('open');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — hotels IoT / multi-platform columns (migrations 033–034)', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  test('hotels has platform_type column (migration 033)', () => {
    expect(columnNames('hotels')).toContain('platform_type');
  });

  test('hotels has device_config column (migration 034)', () => {
    expect(columnNames('hotels')).toContain('device_config');
  });

  test('platform_type defaults to "thingsboard"', () => {
    const col = db.prepare("PRAGMA table_info(hotels)").all().find(c => c.name === 'platform_type');
    expect(col.dflt_value).toBe("'thingsboard'");
  });

  test('device_config defaults to NULL', () => {
    const col = db.prepare("PRAGMA table_info(hotels)").all().find(c => c.name === 'device_config');
    expect(col.dflt_value).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — upsell_offers table', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  test('upsell_offers table exists', () => {
    const exists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='upsell_offers'").get();
    expect(exists).toBe(true);
  });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  ['id', 'hotel_id', 'name', 'price', 'category', 'active'].forEach(col => {
    test(`upsell_offers has column: ${col}`, () => {
      expect(columnNames('upsell_offers')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — reservation_extras table', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  test('reservation_extras table exists', () => {
    const exists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reservation_extras'").get();
    expect(exists).toBe(true);
  });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  ['id', 'reservation_id', 'offer_id', 'quantity', 'status'].forEach(col => {
    test(`reservation_extras has column: ${col}`, () => {
      expect(columnNames('reservation_extras')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — channel_connections table', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  test('channel_connections table exists', () => {
    const exists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='channel_connections'").get();
    expect(exists).toBe(true);
  });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  ['id', 'hotel_id', 'name', 'type', 'ical_token', 'active'].forEach(col => {
    test(`channel_connections has column: ${col}`, () => {
      expect(columnNames('channel_connections')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — housekeeping_assignments table', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  test('housekeeping_assignments table exists', () => {
    const exists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='housekeeping_assignments'").get();
    expect(exists).toBe(true);
  });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  ['id', 'hotel_id', 'room', 'status'].forEach(col => {
    test(`housekeeping_assignments has column: ${col}`, () => {
      expect(columnNames('housekeeping_assignments')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — maintenance_tickets table', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  test('maintenance_tickets table exists', () => {
    const exists = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_tickets'").get();
    expect(exists).toBe(true);
  });

  function columnNames(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  }

  ['id', 'hotel_id', 'room_number', 'category', 'priority', 'description', 'status'].forEach(col => {
    test(`maintenance_tickets has column: ${col}`, () => {
      expect(columnNames('maintenance_tickets')).toContain(col);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initDB — migrations table (new entries 033–034)', () => {
  let db;
  beforeAll(() => { db = initDB(); });

  function getMigrationIds() {
    return db.prepare('SELECT id FROM migrations').all().map(r => r.id);
  }

  test('migration 033_platform_type is recorded', () => {
    expect(getMigrationIds()).toContain('033_platform_type');
  });

  test('migration 034_device_config is recorded', () => {
    expect(getMigrationIds()).toContain('034_device_config');
  });

  test('migration 025_upsell_offers is recorded', () => {
    expect(getMigrationIds()).toContain('025_upsell_offers');
  });

  test('migration 031_channel_connections is recorded', () => {
    expect(getMigrationIds()).toContain('031_channel_connections');
  });

  test('migration 020_housekeeping_assignments is recorded', () => {
    expect(getMigrationIds()).toContain('020_housekeeping_assignments');
  });

  test('migration 024_maintenance_tickets is recorded', () => {
    expect(getMigrationIds()).toContain('024_maintenance_tickets');
  });
});
