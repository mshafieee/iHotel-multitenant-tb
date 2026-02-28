/**
 * iHotel SaaS Platform — Database Module (SQLite)
 * Multi-tenant: all tables scoped by hotel_id
 * Each hotel stores its own ThingsBoard credentials (host, user, pass)
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hilton.db');

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
  const adminCount = db.prepare('SELECT COUNT(*) as cnt FROM platform_admins').get().cnt;
  if (adminCount === 0) {
    const adminUser = process.env.PLATFORM_ADMIN_USER || 'superadmin';
    const adminPass = process.env.PLATFORM_ADMIN_PASS || 'iHotel2026!';
    db.prepare('INSERT INTO platform_admins (username, password_hash, full_name) VALUES (?, ?, ?)')
      .run(adminUser, bcrypt.hashSync(adminPass, 10), 'Platform Administrator');
    console.log(`✓ Platform admin seeded: ${adminUser}`);
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

module.exports = { initDB, seedHotelRates, seedHotelUsers };
