/**
 * iHotel SaaS Platform — Database Module (SQLite)
 * Multi-tenant: all tables scoped by hotel_id
 * Each hotel stores its own ThingsBoard credentials (host, user, pass)
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'ihotel.db');

function initDB() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Migrations table ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  function hasMigration(id) {
    return !!db.prepare('SELECT 1 FROM migrations WHERE id = ?').get(id);
  }
  function markMigration(id) {
    db.prepare('INSERT OR IGNORE INTO migrations (id) VALUES (?)').run(id);
  }

  // ── Platform admins (super admins — platform owner only) ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Hotels table (tenant registry + TB credentials) ───────────────────────
  // tb_pass is stored plaintext here (use ENCRYPTION_KEY env to encrypt at app layer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      contact_email TEXT,
      plan TEXT DEFAULT 'starter',
      active INTEGER DEFAULT 1,
      tb_host TEXT,
      tb_user TEXT,
      tb_pass TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Hotel users (replaces single-tenant users table) ─────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotel_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT,
      UNIQUE (hotel_id, username),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Hotel rooms config (set during onboarding; tb_device_id links to TB) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotel_rooms (
      hotel_id TEXT NOT NULL,
      room_number TEXT NOT NULL,
      floor INTEGER NOT NULL DEFAULT 1,
      room_type TEXT NOT NULL DEFAULT 'STANDARD',
      tb_device_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hotel_id, room_number),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Scenes / Automation (per room, per hotel) ──────────────────────────────
  // trigger_type: 'time' | 'event'
  // trigger_config: JSON — e.g. {"time":"06:00","days":["mon","fri"]} or {"event":"roomStatus","operator":"eq","value":0}
  // actions: JSON array — [{type,params,delay},...] where delay = seconds before action
  // is_default: 1 = system-seeded scene (Welcome/Departure); 0 = user-created custom scene
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL,
      room_number TEXT NOT NULL,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'time',
      trigger_config TEXT NOT NULL DEFAULT '{}',
      actions TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Reservations (hotel-scoped) ────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL,
      room TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      password TEXT NOT NULL,
      password_hash TEXT,
      token TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_by TEXT,
      payment_method TEXT DEFAULT 'pending',
      rate_per_night REAL,
      elec_at_checkin REAL,
      water_at_checkin REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Audit log (hotel-scoped) ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      room TEXT,
      source TEXT,
      user TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Password reset tokens ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'platform',
      identifier TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Refresh tokens ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'hotel',
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Night rates (hotel-scoped) ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS night_rates (
      hotel_id TEXT NOT NULL,
      room_type TEXT NOT NULL,
      rate_per_night REAL NOT NULL,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hotel_id, room_type),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Income log (hotel-scoped) ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS income_log (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL,
      reservation_id TEXT,
      room TEXT,
      guest_name TEXT,
      check_in TEXT,
      check_out TEXT,
      nights INTEGER,
      room_type TEXT,
      rate_per_night REAL,
      total_amount REAL,
      payment_method TEXT DEFAULT 'pending',
      elec_at_checkin REAL,
      water_at_checkin REAL,
      elec_at_checkout REAL,
      water_at_checkout REAL,
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT,
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Shifts (hotel-scoped) ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL,
      user_id INTEGER,
      username TEXT,
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      expected_cash REAL DEFAULT 0,
      expected_visa REAL DEFAULT 0,
      actual_cash REAL,
      actual_visa REAL,
      status TEXT DEFAULT 'open',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Group users (between superadmin and hotel-level) ──────────────────────
  // A group user can monitor financials and manage staff for assigned hotels.
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Group user ↔ hotel assignments (many-to-many) ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_user_hotels (
      group_user_id INTEGER NOT NULL,
      hotel_id TEXT NOT NULL,
      PRIMARY KEY (group_user_id, hotel_id),
      FOREIGN KEY (group_user_id) REFERENCES group_users(id),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Migration 012: seed default scenes for existing rooms ────────────────
  if (!hasMigration('012_default_room_scenes')) {
    const rooms = db.prepare('SELECT hotel_id, room_number FROM hotel_rooms').all();
    let seeded = 0;
    for (const room of rooms) {
      const existing = db.prepare('SELECT COUNT(*) as c FROM scenes WHERE hotel_id=? AND room_number=?')
        .get(room.hotel_id, room.room_number).c;
      if (existing === 0) {
        seedRoomDefaultScenes(db, room.hotel_id, room.room_number);
        seeded++;
      }
    }
    if (seeded > 0) console.log(`✓ Migration 012: seeded default scenes for ${seeded} room(s)`);
    markMigration('012_default_room_scenes');
  }

  // ── Migration 014: enable existing default scenes (seeded as disabled) ───
  if (!hasMigration('014_enable_default_scenes')) {
    const updated = db.prepare(
      "UPDATE scenes SET enabled=1 WHERE is_default=1 AND enabled=0"
    ).run();
    if (updated.changes > 0) console.log(`✓ Migration 014: enabled ${updated.changes} default scenes`);
    markMigration('014_enable_default_scenes');
  }

  // ── Migration 013: add is_default column to scenes ───────────────────────
  if (!hasMigration('013_scenes_is_default')) {
    const cols = db.pragma('table_info(scenes)').map(c => c.name);
    if (!cols.includes('is_default')) {
      db.exec('ALTER TABLE scenes ADD COLUMN is_default INTEGER DEFAULT 0');
      // Mark the two system-seeded scenes per room as default
      const updated = db.prepare(
        "UPDATE scenes SET is_default=1 WHERE name IN ('Welcome to Room','Departure Routine')"
      ).run();
      if (updated.changes > 0) console.log(`✓ Migration 013: marked ${updated.changes} system scenes as default`);
    }
    markMigration('013_scenes_is_default');
  }

  // ── Migration 017: (no-op — placeholder, previously removed default scenes) ──
  if (!hasMigration('017_remove_seeded_scenes')) {
    markMigration('017_remove_seeded_scenes');
  }

  // ── Migration 018: re-seed Welcome + Departure scenes for every room ─────────
  // Restores scenes deleted by migration 017; skips rooms that already have them.
  if (!hasMigration('018_reseed_default_scenes')) {
    const rooms = db.prepare('SELECT hotel_id, room_number FROM hotel_rooms').all();
    let seeded = 0;
    for (const room of rooms) {
      const has = db.prepare(
        "SELECT COUNT(*) as c FROM scenes WHERE hotel_id=? AND room_number=? AND name IN ('Welcome to Room','Departure Routine')"
      ).get(room.hotel_id, room.room_number).c;
      if (has < 2) {
        seedRoomDefaultScenes(db, room.hotel_id, room.room_number);
        seeded++;
      }
    }
    if (seeded > 0) console.log(`✓ Migration 018: re-seeded default scenes for ${seeded} room(s)`);
    markMigration('018_reseed_default_scenes');
  }

  // ── Migration 019: delete all scenes named 'Test' ────────────────────────
  if (!hasMigration('019_delete_test_scenes')) {
    const deleted = db.prepare("DELETE FROM scenes WHERE name = 'Test'").run();
    if (deleted.changes > 0) console.log(`✓ Migration 019: deleted ${deleted.changes} 'Test' scenes`);
    markMigration('019_delete_test_scenes');
  }

  // ── Migration 016: add is_shared column to scenes ────────────────────────
  if (!hasMigration('016_scenes_is_shared')) {
    const cols = db.pragma('table_info(scenes)').map(c => c.name);
    if (!cols.includes('is_shared')) {
      db.exec('ALTER TABLE scenes ADD COLUMN is_shared INTEGER DEFAULT 0');
      console.log('✓ Migration 016: added is_shared to scenes');
    }
    markMigration('016_scenes_is_shared');
  }

  // ── Hotel profile (public info for self-booking) ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotel_profiles (
      hotel_id TEXT PRIMARY KEY,
      description TEXT,
      description_ar TEXT,
      location TEXT,
      location_ar TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      amenities TEXT DEFAULT '[]',
      check_in_time TEXT DEFAULT '15:00',
      check_out_time TEXT DEFAULT '12:00',
      currency TEXT DEFAULT 'SAR',
      booking_enabled INTEGER DEFAULT 0,
      booking_terms TEXT,
      booking_terms_ar TEXT,
      hero_image_url TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Room type images (for self-booking pages) ───────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_type_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hotel_id TEXT NOT NULL,
      room_type TEXT NOT NULL,
      image_url TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Room type descriptions (for self-booking pages) ─────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_type_info (
      hotel_id TEXT NOT NULL,
      room_type TEXT NOT NULL,
      description TEXT,
      description_ar TEXT,
      max_guests INTEGER DEFAULT 2,
      bed_type TEXT DEFAULT 'King',
      area_sqm REAL,
      amenities TEXT DEFAULT '[]',
      PRIMARY KEY (hotel_id, room_type),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Housekeeping assignments (hotel-scoped) ───────────────────────────────
  // Tracks room cleaning tasks: who assigned, who cleans, timing, and status.
  // status: 'pending' | 'in_progress' | 'done' | 'cancelled'
  // One assignment record per room per cleaning cycle.
  db.exec(`
    CREATE TABLE IF NOT EXISTS housekeeping_assignments (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL,
      room TEXT NOT NULL,
      assigned_to TEXT NOT NULL,        -- username of the housekeeper
      assigned_by TEXT NOT NULL,        -- username of manager who assigned
      assigned_at INTEGER NOT NULL,     -- Unix ms timestamp
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER,               -- when housekeeper tapped "Start"
      completed_at INTEGER,             -- when housekeeper tapped "Done"
      notes TEXT,                       -- optional manager note
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Migration 020: create housekeeping_assignments table ─────────────────
  // This is a new table so no ALTER needed; the CREATE IF NOT EXISTS above
  // handles first-run. We just mark the migration so we know it ran.
  if (!hasMigration('020_housekeeping_assignments')) {
    markMigration('020_housekeeping_assignments');
    console.log('✓ Migration 020: housekeeping_assignments table ready');
  }

  // ── Web Push subscriptions (hotel-scoped, per user) ──────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      hotel_id TEXT NOT NULL,
      username TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Platform-level config (VAPID keys, etc.) ──────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // ── Migration 021: add qr_login_token to hotel_users ────────────────────
  if (!hasMigration('021_qr_login_token')) {
    const cols = db.pragma('table_info(hotel_users)').map(c => c.name);
    if (!cols.includes('qr_login_token')) {
      db.exec('ALTER TABLE hotel_users ADD COLUMN qr_login_token TEXT');
      console.log('✓ Migration 021: added qr_login_token to hotel_users');
    }
    markMigration('021_qr_login_token');
  }

  if (!hasMigration('022_guest_reviews')) {
    const resCols = db.pragma('table_info(reservations)').map(c => c.name);
    if (!resCols.includes('review_token')) {
      db.exec('ALTER TABLE reservations ADD COLUMN review_token TEXT');
      console.log('✓ Migration 022: added review_token to reservations');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS guest_reviews (
        id           TEXT PRIMARY KEY,
        hotel_id     TEXT NOT NULL,
        reservation_id TEXT UNIQUE,
        room         TEXT,
        guest_name   TEXT,
        check_in     TEXT,
        check_out    TEXT,
        nights       INTEGER,
        stars        INTEGER NOT NULL CHECK(stars >= 1 AND stars <= 5),
        review_text  TEXT,
        created_at   TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (hotel_id) REFERENCES hotels(id)
      )
    `);
    markMigration('022_guest_reviews');
    console.log('✓ Migration 022: created guest_reviews table');
  }

  if (!hasMigration('023_tokens_valid_after')) {
    const cols = db.pragma('table_info(hotel_users)').map(c => c.name);
    if (!cols.includes('tokens_valid_after')) {
      db.exec('ALTER TABLE hotel_users ADD COLUMN tokens_valid_after TEXT');
      console.log('✓ Migration 023: added tokens_valid_after to hotel_users');
    }
    markMigration('023_tokens_valid_after');
  }

  // ── Migration 024: maintenance tickets ───────────────────────────────────
  if (!hasMigration('024_maintenance_tickets')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS maintenance_tickets (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        hotel_id     TEXT    NOT NULL,
        room_number  TEXT,
        category     TEXT    NOT NULL,
        description  TEXT    NOT NULL,
        priority     TEXT    NOT NULL DEFAULT 'medium',
        status       TEXT    NOT NULL DEFAULT 'open',
        reported_by  TEXT    NOT NULL,
        assigned_to  TEXT,
        notes        TEXT,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        resolved_at  INTEGER,
        FOREIGN KEY (hotel_id) REFERENCES hotels(id)
      )
    `);
    console.log('✓ Migration 024: created maintenance_tickets table');
    markMigration('024_maintenance_tickets');
  }

  // ── Migration 025: upsell offers catalog ─────────────────────────────────
  if (!hasMigration('025_upsell_offers')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS upsell_offers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        hotel_id       TEXT    NOT NULL,
        name           TEXT    NOT NULL,
        name_ar        TEXT    NOT NULL,
        description    TEXT,
        description_ar TEXT,
        category       TEXT    NOT NULL DEFAULT 'SERVICE',
        price          REAL    NOT NULL DEFAULT 0,
        unit           TEXT    NOT NULL DEFAULT 'one-time',
        active         INTEGER NOT NULL DEFAULT 1,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (hotel_id) REFERENCES hotels(id)
      )
    `);
    console.log('✓ Migration 025: created upsell_offers table');
    markMigration('025_upsell_offers');
  }

  // ── Migration 026: reservation extras (guest orders) ─────────────────────
  if (!hasMigration('026_reservation_extras')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reservation_extras (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        hotel_id         TEXT    NOT NULL,
        reservation_id   TEXT    NOT NULL,
        offer_id         INTEGER NOT NULL,
        offer_name       TEXT    NOT NULL,
        offer_name_ar    TEXT    NOT NULL,
        quantity         INTEGER NOT NULL DEFAULT 1,
        unit_price       REAL    NOT NULL,
        total_price      REAL    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'pending',
        requested_by     TEXT    NOT NULL,
        staff_note       TEXT,
        created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (hotel_id)       REFERENCES hotels(id),
        FOREIGN KEY (reservation_id) REFERENCES reservations(id)
      )
    `);
    console.log('✓ Migration 026: created reservation_extras table');
    markMigration('026_reservation_extras');
  }

  // ── Migration 027: room_types filter column on upsell_offers ──────────────
  if (!hasMigration('027_upsell_room_types')) {
    try { db.exec(`ALTER TABLE upsell_offers ADD COLUMN room_types TEXT DEFAULT NULL`); } catch {}
    console.log('✓ Migration 027: upsell_offers.room_types column added');
    markMigration('027_upsell_room_types');
  }

  // ── Migration 028: meter baselines (soft-reset after checkout/clean) ───────
  // elec_meter_baseline / water_meter_baseline: absolute TB reading at last reset.
  // "Room consumption since last reset" = current - baseline (never touches TB device).
  // hotel_profiles gets: meter_month (YYYY-MM), elec_month_start, water_month_start
  // — snapshotted on first request of each calendar month so monthly delta can be shown.
  // ── Migration 031: channel_connections (Channel Manager) ─────────────────
  if (!hasMigration('031_channel_connections')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_connections (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        hotel_id       TEXT    NOT NULL,
        name           TEXT    NOT NULL,
        type           TEXT    NOT NULL DEFAULT 'ical',
        webhook_secret TEXT,
        api_key        TEXT,
        ical_token     TEXT    NOT NULL,
        last_sync_at   INTEGER DEFAULT NULL,
        active         INTEGER NOT NULL DEFAULT 1,
        notes          TEXT,
        created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (hotel_id) REFERENCES hotels(id)
      )
    `);
    console.log('✓ Migration 031: channel_connections table created');
    markMigration('031_channel_connections');
  }

  // ── Migration 032: public_url on hotel_profiles (for Channel Manager iCal links) ──
  if (!hasMigration('032_public_url')) {
    const profCols = db.pragma('table_info(hotel_profiles)').map(c => c.name);
    if (!profCols.includes('public_url'))
      db.exec("ALTER TABLE hotel_profiles ADD COLUMN public_url TEXT DEFAULT NULL");
    console.log('✓ Migration 032: public_url column added to hotel_profiles');
    markMigration('032_public_url');
  }

  if (!hasMigration('030_checked_out_at')) {
    const ilCols = db.pragma('table_info(income_log)').map(c => c.name);
    if (!ilCols.includes('checked_out_at'))
      db.exec("ALTER TABLE income_log ADD COLUMN checked_out_at TEXT DEFAULT NULL");
    console.log('✓ Migration 030: checked_out_at column added to income_log');
    markMigration('030_checked_out_at');
  }

  // ── Migration 033: Add platform_type to hotels ───────────────────────────────
  if (!hasMigration('033_platform_type')) {
    const cols = db.pragma('table_info(hotels)').map(c => c.name);
    if (!cols.includes('platform_type')) {
      db.exec("ALTER TABLE hotels ADD COLUMN platform_type TEXT DEFAULT 'thingsboard'");
      console.log("✓ Migration 033: added platform_type to hotels (default: 'thingsboard')");
    }
    markMigration('033_platform_type');
  }

  // ── Migration 034: Add device_config to hotels ───────────────────────────────
  if (!hasMigration('034_device_config')) {
    const cols = db.pragma('table_info(hotels)').map(c => c.name);
    if (!cols.includes('device_config')) {
      db.exec("ALTER TABLE hotels ADD COLUMN device_config TEXT DEFAULT NULL");
      console.log('✓ Migration 034: added device_config to hotels');
    }
    markMigration('034_device_config');
  }

  // ── Migration 031: Rename tb_* columns to iot_* for platform-agnostic naming ──
  if (!hasMigration('031_rename_tb_to_iot')) {
    const hotelCols = db.pragma('table_info(hotels)').map(c => c.name);
    const roomCols  = db.pragma('table_info(hotel_rooms)').map(c => c.name);
    // Add iot_ columns if they don't exist yet
    if (!hotelCols.includes('iot_host')) {
      db.exec('ALTER TABLE hotels ADD COLUMN iot_host TEXT');
      db.exec('ALTER TABLE hotels ADD COLUMN iot_user TEXT');
      db.exec('ALTER TABLE hotels ADD COLUMN iot_pass TEXT');
      // Copy existing TB credentials to new columns
      db.exec('UPDATE hotels SET iot_host = tb_host, iot_user = tb_user, iot_pass = tb_pass');
    }
    if (!roomCols.includes('device_id')) {
      db.exec('ALTER TABLE hotel_rooms ADD COLUMN device_id TEXT');
      db.exec('UPDATE hotel_rooms SET device_id = tb_device_id');
    }
    // Keep old columns for backward compatibility — they'll be read by AdapterPool fallback
    console.log('✓ Migration 031: iot_host/iot_user/iot_pass + device_id columns added (tb_* kept as fallback)');
    markMigration('031_rename_tb_to_iot');
  }

  if (!hasMigration('029_thirdparty_channel')) {
    const ilCols  = db.pragma('table_info(income_log)').map(c => c.name);
    const resCols = db.pragma('table_info(reservations)').map(c => c.name);
    if (!ilCols.includes('thirdparty_channel'))
      db.exec("ALTER TABLE income_log ADD COLUMN thirdparty_channel TEXT DEFAULT ''");
    if (!resCols.includes('thirdparty_channel'))
      db.exec("ALTER TABLE reservations ADD COLUMN thirdparty_channel TEXT DEFAULT ''");
    console.log('✓ Migration 029: thirdparty_channel column added');
    markMigration('029_thirdparty_channel');
  }

  if (!hasMigration('028_meter_baselines')) {
    const roomCols    = db.pragma('table_info(hotel_rooms)').map(c => c.name);
    const profileCols = db.pragma('table_info(hotel_profiles)').map(c => c.name);
    if (!roomCols.includes('elec_meter_baseline'))
      db.exec('ALTER TABLE hotel_rooms ADD COLUMN elec_meter_baseline REAL DEFAULT 0');
    if (!roomCols.includes('water_meter_baseline'))
      db.exec('ALTER TABLE hotel_rooms ADD COLUMN water_meter_baseline REAL DEFAULT 0');
    if (!profileCols.includes('meter_month'))
      db.exec("ALTER TABLE hotel_profiles ADD COLUMN meter_month TEXT DEFAULT ''");
    if (!profileCols.includes('elec_month_start'))
      db.exec('ALTER TABLE hotel_profiles ADD COLUMN elec_month_start REAL DEFAULT 0');
    if (!profileCols.includes('water_month_start'))
      db.exec('ALTER TABLE hotel_profiles ADD COLUMN water_month_start REAL DEFAULT 0');
    console.log('✓ Migration 028: meter baseline columns added');
    markMigration('028_meter_baselines');
  }

  // ── Utility costs (hotel-scoped) — cost per kWh and cost per m³ ───────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS utility_costs (
      hotel_id TEXT NOT NULL,
      cost_type TEXT NOT NULL,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hotel_id, cost_type),
      FOREIGN KEY (hotel_id) REFERENCES hotels(id)
    )
  `);

  // ── Migration 015: add logo_url column to hotels ─────────────────────────
  if (!hasMigration('015_hotel_logo')) {
    const cols = db.pragma('table_info(hotels)').map(c => c.name);
    if (!cols.includes('logo_url')) {
      db.exec('ALTER TABLE hotels ADD COLUMN logo_url TEXT');
      console.log('✓ Migration 015: added logo_url to hotels');
    }
    markMigration('015_hotel_logo');
  }

  // ── Migration 011: add password_hash column to reservations ──────────────
  if (!hasMigration('011_guest_password_hash')) {
    const cols = db.pragma('table_info(reservations)').map(c => c.name);
    if (!cols.includes('password_hash')) {
      db.exec('ALTER TABLE reservations ADD COLUMN password_hash TEXT');
      const rows = db.prepare('SELECT id, password FROM reservations').all();
      const upd  = db.prepare('UPDATE reservations SET password_hash=? WHERE id=?');
      for (const r of rows) {
        if (r.password) upd.run(bcrypt.hashSync(r.password, 10), r.id);
      }
      console.log(`✓ Migration 011: hashed ${rows.length} guest reservation passwords`);
    }
    markMigration('011_guest_password_hash');
  }

  // ── Migration: migrate single-tenant data to multi-tenant schema ──────────
  // If old 'users' table exists and hotel_users is empty, migrate data
  if (!hasMigration('010_multitenant_migrate')) {
    const oldUsersExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();

    if (oldUsersExists) {
      const crypto = require('crypto');
      // Create a default hotel for the existing single-tenant data
      const defaultHotelId = process.env.DEFAULT_HOTEL_ID || crypto.randomUUID();
      const defaultSlug    = process.env.DEFAULT_HOTEL_SLUG || 'default';
      const tbHost = process.env.TB_HOST || 'http://localhost:8080';
      const tbUser = process.env.TB_USER || '';
      const tbPass = process.env.TB_PASS || '';

      // Insert default hotel (skip if exists)
      try {
        db.prepare(`INSERT OR IGNORE INTO hotels (id, name, slug, tb_host, tb_user, tb_pass)
                    VALUES (?, ?, ?, ?, ?, ?)`)
          .run(defaultHotelId, 'Default Hotel', defaultSlug, tbHost, tbUser, tbPass);
      } catch {}

      // Migrate users → hotel_users
      const oldUsers = db.prepare('SELECT * FROM users').all();
      for (const u of oldUsers) {
        try {
          db.prepare(`INSERT OR IGNORE INTO hotel_users
            (hotel_id, username, password_hash, role, full_name, active, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(defaultHotelId, u.username, u.password_hash, u.role, u.full_name,
                 u.active, u.created_at, u.last_login);
        } catch {}
      }

      // Migrate existing tables: add hotel_id column and fill with defaultHotelId
      const tables = ['reservations', 'audit_log', 'income_log', 'shifts'];
      for (const table of tables) {
        try {
          const cols = db.pragma(`table_info(${table})`).map(c => c.name);
          if (!cols.includes('hotel_id')) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN hotel_id TEXT`);
            db.exec(`UPDATE ${table} SET hotel_id = '${defaultHotelId}' WHERE hotel_id IS NULL`);
          }
        } catch {}
      }

      // Migrate night_rates (single PK → composite PK with hotel_id)
      try {
        const oldRates = db.prepare("SELECT * FROM night_rates").all();
        // Check if it's old schema (no hotel_id column)
        const nightRateCols = db.pragma('table_info(night_rates)').map(c => c.name);
        if (!nightRateCols.includes('hotel_id')) {
          // Rename old table
          db.exec('ALTER TABLE night_rates RENAME TO night_rates_old');
          // Create new schema (already defined above — drop and recreate)
          db.exec(`
            CREATE TABLE IF NOT EXISTS night_rates (
              hotel_id TEXT NOT NULL,
              room_type TEXT NOT NULL,
              rate_per_night REAL NOT NULL,
              updated_by TEXT,
              updated_at TEXT DEFAULT (datetime('now')),
              PRIMARY KEY (hotel_id, room_type),
              FOREIGN KEY (hotel_id) REFERENCES hotels(id)
            )
          `);
          for (const r of oldRates) {
            db.prepare('INSERT OR IGNORE INTO night_rates (hotel_id, room_type, rate_per_night, updated_by, updated_at) VALUES (?,?,?,?,?)')
              .run(defaultHotelId, r.room_type, r.rate_per_night, r.updated_by, r.updated_at);
          }
          db.exec('DROP TABLE night_rates_old');
        }
      } catch {}

      // Migrate refresh_tokens: drop old FK constraint by recreating
      try {
        const rtCols = db.pragma('table_info(refresh_tokens)').map(c => c.name);
        if (!rtCols.includes('user_type')) {
          db.exec(`
            CREATE TABLE IF NOT EXISTS refresh_tokens_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              user_type TEXT NOT NULL DEFAULT 'hotel',
              token TEXT UNIQUE NOT NULL,
              expires_at TEXT NOT NULL,
              created_at TEXT DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO refresh_tokens_new (id, user_id, token, expires_at, created_at)
              SELECT id, user_id, token, expires_at, created_at FROM refresh_tokens;
            DROP TABLE refresh_tokens;
            ALTER TABLE refresh_tokens_new RENAME TO refresh_tokens;
          `);
        }
      } catch {}

      console.log(`✓ Migration 010: single-tenant data migrated to hotel '${defaultSlug}' (${defaultHotelId})`);
    }
    markMigration('010_multitenant_migrate');
  }

  // ── Seed platform admin from env ───────────────────────────────────────────
  const adminUser = process.env.PLATFORM_ADMIN_USER || 'superadmin';
  const adminPass = process.env.PLATFORM_ADMIN_PASS || 'iHotel2026';
  const existingAdmin = db.prepare('SELECT id, password_hash FROM platform_admins WHERE username = ?').get(adminUser);
  if (!existingAdmin) {
    db.prepare('INSERT INTO platform_admins (username, password_hash, full_name) VALUES (?, ?, ?)')
      .run(adminUser, bcrypt.hashSync(adminPass, 10), 'Platform Administrator');
    console.log(`✓ Platform admin seeded: ${adminUser}`);
  } else if (!bcrypt.compareSync(adminPass, existingAdmin.password_hash)) {
    // .env PLATFORM_ADMIN_PASS changed — sync it to the DB
    db.prepare('UPDATE platform_admins SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(adminPass, 10), existingAdmin.id);
    console.log(`✓ Platform admin password updated from env: ${adminUser}`);
  }

  // ── Migration 036: per-room device names ─────────────────────────────────
  if (!hasMigration('036_room_device_names')) {
    const cols = db.pragma('table_info(hotel_rooms)').map(c => c.name);
    if (!cols.includes('device_id'))
      db.exec('ALTER TABLE hotel_rooms ADD COLUMN device_id TEXT');
    if (!cols.includes('device_names'))
      db.exec('ALTER TABLE hotel_rooms ADD COLUMN device_names TEXT DEFAULT NULL');
    console.log('✓ Migration 036: added device_id and device_names columns to hotel_rooms');
    markMigration('036_room_device_names');
  }

  return db;
}


// ── Seed night rates for a new hotel ────────────────────────────────────────
function seedHotelRates(db, hotelId) {
  const ins = db.prepare('INSERT OR IGNORE INTO night_rates (hotel_id, room_type, rate_per_night) VALUES (?, ?, ?)');
  ins.run(hotelId, 'STANDARD', 600);
  ins.run(hotelId, 'DELUXE',   950);
  ins.run(hotelId, 'SUITE',   1500);
  ins.run(hotelId, 'VIP',     2500);
}

// ── Seed default upsell offers for a new hotel ──────────────────────────────
function seedHotelUpsellOffers(db, hotelId) {
  const ins = db.prepare(`INSERT OR IGNORE INTO upsell_offers
    (hotel_id, name, name_ar, category, price, unit, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run(hotelId, 'Breakfast in Bed',         'إفطار في الغرفة',         'FOOD',      75,  'per-person', 0);
  ins.run(hotelId, 'Airport Transfer',          'توصيل المطار',            'TRANSPORT', 150, 'one-time',   1);
  ins.run(hotelId, 'Welcome Flowers & Fruits',  'زهور وفاكهة ترحيبية',     'AMENITY',   120, 'one-time',   2);
  ins.run(hotelId, 'Laundry Service',           'خدمة الغسيل',             'SERVICE',   60,  'one-time',   3);
}

// ── Seed default staff users for a new hotel ────────────────────────────────
function seedHotelUsers(db, hotelId, slug = '') {
  const password = slug ? `iHotel-${slug}-2026` : 'iHotel2026!';
  const hash = bcrypt.hashSync(password, 10);
  const ins  = db.prepare(`INSERT OR IGNORE INTO hotel_users
    (hotel_id, username, password_hash, role, full_name) VALUES (?, ?, ?, ?, ?)`);
  ins.run(hotelId, 'owner',     hash, 'owner',     'Hotel Owner');
  ins.run(hotelId, 'admin',     hash, 'admin',     'Operations Manager');
  ins.run(hotelId, 'frontdesk', hash, 'frontdesk', 'Front Desk Agent');
}

// ── Seed 2 default automation scenes for a new room ─────────────────────────
function seedRoomDefaultScenes(db, hotelId, roomNumber) {
  const crypto = require('crypto');
  const ins = db.prepare(
    'INSERT INTO scenes (id,hotel_id,room_number,name,trigger_type,trigger_config,actions,enabled,is_default) VALUES (?,?,?,?,?,?,?,?,?)'
  );

  // Scene 1 — Welcome to Room: fires when roomStatus → Occupied from Vacant or Not Occupied
  ins.run(
    crypto.randomUUID(), hotelId, roomNumber,
    'Welcome to Room', 'event',
    JSON.stringify({ event: 'roomStatus', operator: 'eq', value: 1, fromValues: [0, 4] }),
    JSON.stringify([
      { type: 'setLines',          params: { line1: true, line2: true, line3: true, dimmer1: 100, dimmer2: 100 }, delay: 0 },
      { type: 'setCurtainsBlinds', params: { curtainsPosition: 100, blindsPosition: 100 }, delay: 2 }
    ]),
    1, 1
  );

  // Scene 2 — Departure Routine: fires when roomStatus leaves Occupied
  ins.run(
    crypto.randomUUID(), hotelId, roomNumber,
    'Departure Routine', 'event',
    JSON.stringify({ event: 'roomStatus', operator: 'neq', value: 1, fromValues: [1] }),
    JSON.stringify([
      { type: 'setAC',             params: { acMode: 1, acTemperatureSet: 26, fanSpeed: 0 }, delay: 0 },
      { type: 'setLines',          params: { line1: false, line2: false, line3: false, dimmer1: 0, dimmer2: 0 }, delay: 1 },
      { type: 'setCurtainsBlinds', params: { curtainsPosition: 0, blindsPosition: 0 }, delay: 2 }
    ]),
    1, 1
  );
}

module.exports = { initDB, seedHotelRates, seedHotelUpsellOffers, seedHotelUsers, seedRoomDefaultScenes };
