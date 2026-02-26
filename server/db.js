/**
 * Hilton Grand Hotel — Database Module (SQLite)
 * Persistent storage for users, reservations, audit logs, finance, shifts
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'hilton.db');

function initDB() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Migrations table ─────────────────────────────────────────────────────
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

  // ── Users table (original) ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  // ── Migration 001: migrate role 'user' → 'frontdesk' ────────────────────
  // Recreate users table to drop old CHECK constraint and translate role values.
  // Must disable FK enforcement during table swap (refresh_tokens references users).
  if (!hasMigration('001_role_frontdesk')) {
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          full_name TEXT,
          active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          last_login TEXT
        );
        INSERT OR IGNORE INTO users_new (id, username, password_hash, role, full_name, active, created_at, last_login)
          SELECT id, username, password_hash,
                 CASE WHEN role = 'user' THEN 'frontdesk' ELSE role END,
                 full_name, active, created_at, last_login
          FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      markMigration('001_role_frontdesk');
      console.log('✓ Migration 001: users table rebuilt, role user→frontdesk');
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  // ── Reservations table ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      password TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Migration 002: add payment_method to reservations ───────────────────
  if (!hasMigration('002_reservations_payment')) {
    try { db.exec(`ALTER TABLE reservations ADD COLUMN payment_method TEXT DEFAULT 'pending'`); } catch {}
    try { db.exec(`ALTER TABLE reservations ADD COLUMN rate_per_night REAL`); } catch {}
    try { db.exec(`ALTER TABLE reservations ADD COLUMN elec_at_checkin REAL`); } catch {}
    try { db.exec(`ALTER TABLE reservations ADD COLUMN water_at_checkin REAL`); } catch {}
    markMigration('002_reservations_payment');
    console.log('✓ Migration 002: reservations payment/rate/consumption columns');
  }

  // ── Audit log table ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      room TEXT,
      source TEXT,
      user TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Refresh tokens table ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ── Night rates table ────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS night_rates (
      room_type TEXT PRIMARY KEY,
      rate_per_night REAL NOT NULL,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Migration 003: seed night_rates ─────────────────────────────────────
  if (!hasMigration('003_seed_night_rates')) {
    const ins = db.prepare('INSERT OR IGNORE INTO night_rates (room_type, rate_per_night) VALUES (?, ?)');
    ins.run('STANDARD', 600);
    ins.run('DELUXE', 950);
    ins.run('SUITE', 1500);
    ins.run('VIP', 2500);
    markMigration('003_seed_night_rates');
    console.log('✓ Migration 003: night_rates seeded');
  }

  // ── Income log table ─────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS income_log (
      id TEXT PRIMARY KEY,
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
      created_by TEXT
    )
  `);

  // ── Shifts table ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
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
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ── Seed default users if none exist ────────────────────────────────────
  const count = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, ?, ?)');
    insert.run('owner', bcrypt.hashSync('hilton2026', 10), 'owner', 'Hotel Owner');
    insert.run('admin', bcrypt.hashSync('hilton2026', 10), 'admin', 'Operations Manager');
    insert.run('frontdesk', bcrypt.hashSync('hilton2026', 10), 'frontdesk', 'Front Desk Agent');
    console.log('✓ Seeded 3 default users (password: hilton2026)');
  }

  return db;
}

module.exports = { initDB };
