/**
 * Hilton Grand Hotel — Database Module (SQLite)
 * Persistent storage for users, reservations, audit logs
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'hilton.db');

function initDB() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','user')),
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  // Reservations table
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

  // Audit log table
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

  // Refresh tokens table
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

  // Seed default users if none exist
  const count = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, ?, ?)');
    insert.run('owner', bcrypt.hashSync('hilton2026', 10), 'owner', 'Hotel Owner');
    insert.run('admin', bcrypt.hashSync('hilton2026', 10), 'admin', 'Operations Manager');
    insert.run('frontdesk', bcrypt.hashSync('hilton2026', 10), 'user', 'Front Desk Agent');
    console.log('✓ Seeded 3 default users (password: hilton2026)');
  }

  return db;
}

module.exports = { initDB };
