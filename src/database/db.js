import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Database initialization and migration
 * Creates tables for users, devices, account links, and sessions
 */

const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '../../data/smart-home.db');

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Users table - stores backend users
 */
const createUsersTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backend_user_id TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      thingsboard_user_id TEXT,
      thingsboard_customer_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_users_backend_id ON users(backend_user_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_tb_user_id ON users(thingsboard_user_id);
  `);
};

/**
 * Google account links table - OAuth 2.0 account linking
 */
const createGoogleAccountLinksTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_account_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      google_agent_user_id TEXT UNIQUE NOT NULL,
      google_account_id TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      linked_at INTEGER NOT NULL,
      last_sync_at INTEGER,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_google_links_agent_user_id ON google_account_links(google_agent_user_id);
    CREATE INDEX IF NOT EXISTS idx_google_links_user_id ON google_account_links(user_id);
  `);
};

/**
 * Devices table - stores device provisioning data
 */
const createDevicesTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_uuid TEXT UNIQUE NOT NULL,
      thingsboard_device_id TEXT UNIQUE NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      access_token TEXT NOT NULL,
      device_label TEXT,
      capabilities TEXT NOT NULL,
      device_config TEXT,
      provisioned_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      is_online INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_devices_uuid ON devices(device_uuid);
    CREATE INDEX IF NOT EXISTS idx_devices_tb_id ON devices(thingsboard_device_id);
    CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active);
  `);
};

/**
 * ThingsBoard sessions table - JWT token management
 */
const createThingsBoardSessionsTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS thingsboard_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      jwt_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tb_sessions_user_id ON thingsboard_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tb_sessions_active ON thingsboard_sessions(is_active);
  `);
};

/**
 * Provisioning requests table - track device provisioning attempts
 */
const createProvisioningRequestsTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provisioning_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_uuid TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      request_data TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_prov_requests_device_uuid ON provisioning_requests(device_uuid);
    CREATE INDEX IF NOT EXISTS idx_prov_requests_user_id ON provisioning_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_prov_requests_status ON provisioning_requests(status);
  `);
};

/**
 * Audit log table - track important system events
 */
const createAuditLogTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  `);
};

/**
 * Run all migrations
 */
export const migrate = () => {
  console.log('Running database migrations...');
  
  db.transaction(() => {
    createUsersTable();
    createGoogleAccountLinksTable();
    createDevicesTable();
    createThingsBoardSessionsTable();
    createProvisioningRequestsTable();
    createAuditLogTable();
  })();
  
  console.log('Database migrations completed successfully');
};

/**
 * Get database instance
 */
export const getDatabase = () => db;

/**
 * Close database connection
 */
export const closeDatabase = () => {
  db.close();
};

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  closeDatabase();
}

export default {
  getDatabase,
  migrate,
  closeDatabase
};
