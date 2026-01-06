import { getDatabase } from './db.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const db = getDatabase();

/**
 * User Model
 */
export class UserModel {
  /**
   * Create a new user
   */
  static create({ username, email, password, thingsboardUserId = null, thingsboardCustomerId = null }) {
    const backendUserId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO users (backend_user_id, username, email, password_hash, thingsboard_user_id, thingsboard_customer_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(backendUserId, username, email, passwordHash, thingsboardUserId, thingsboardCustomerId, now, now);
    
    return {
      id: result.lastInsertRowid,
      backendUserId,
      username,
      email,
      thingsboardUserId,
      thingsboardCustomerId,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Find user by username
   */
  static findByUsername(username) {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
    return stmt.get(username);
  }

  /**
   * Find user by backend user ID
   */
  static findByBackendUserId(backendUserId) {
    const stmt = db.prepare('SELECT * FROM users WHERE backend_user_id = ? AND is_active = 1');
    return stmt.get(backendUserId);
  }

  /**
   * Find user by ThingsBoard user ID
   */
  static findByThingsBoardUserId(thingsboardUserId) {
    const stmt = db.prepare('SELECT * FROM users WHERE thingsboard_user_id = ? AND is_active = 1');
    return stmt.get(thingsboardUserId);
  }

  /**
   * Verify password
   */
  static verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compareSync(plainPassword, passwordHash);
  }

  /**
   * Update ThingsBoard user mapping
   */
  static updateThingsBoardMapping(userId, thingsboardUserId, thingsboardCustomerId) {
    const stmt = db.prepare(`
      UPDATE users 
      SET thingsboard_user_id = ?, thingsboard_customer_id = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(thingsboardUserId, thingsboardCustomerId, Date.now(), userId);
  }

  /**
   * Get all users
   */
  static findAll() {
    const stmt = db.prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY created_at DESC');
    return stmt.all();
  }
}

/**
 * Device Model
 */
export class DeviceModel {
  /**
   * Create a new device
   */
  static create({ deviceUuid, thingsboardDeviceId, deviceName, deviceType, ownerUserId, accessToken, capabilities, deviceLabel = null, deviceConfig = null }) {
    const now = Date.now();
    const capabilitiesJson = JSON.stringify(capabilities);
    const configJson = deviceConfig ? JSON.stringify(deviceConfig) : null;

    const stmt = db.prepare(`
      INSERT INTO devices (device_uuid, thingsboard_device_id, device_name, device_type, owner_user_id, access_token, device_label, capabilities, device_config, provisioned_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(deviceUuid, thingsboardDeviceId, deviceName, deviceType, ownerUserId, accessToken, deviceLabel, capabilitiesJson, configJson, now);
    
    return {
      id: result.lastInsertRowid,
      deviceUuid,
      thingsboardDeviceId,
      deviceName,
      deviceType,
      ownerUserId,
      accessToken,
      deviceLabel,
      capabilities,
      deviceConfig,
      provisionedAt: now
    };
  }

  /**
   * Find device by UUID
   */
  static findByUuid(deviceUuid) {
    const stmt = db.prepare('SELECT * FROM devices WHERE device_uuid = ? AND is_active = 1');
    const device = stmt.get(deviceUuid);
    if (device && device.capabilities) {
      device.capabilities = JSON.parse(device.capabilities);
    }
    if (device && device.device_config) {
      device.device_config = JSON.parse(device.device_config);
    }
    return device;
  }

  /**
   * Find devices by owner user ID
   */
  static findByOwner(ownerUserId) {
    const stmt = db.prepare('SELECT * FROM devices WHERE owner_user_id = ? AND is_active = 1 ORDER BY provisioned_at DESC');
    const devices = stmt.all(ownerUserId);
    return devices.map(device => {
      if (device.capabilities) device.capabilities = JSON.parse(device.capabilities);
      if (device.device_config) device.device_config = JSON.parse(device.device_config);
      return device;
    });
  }

  /**
   * Update device online status
   */
  static updateOnlineStatus(deviceUuid, isOnline) {
    const now = Date.now();
    const stmt = db.prepare('UPDATE devices SET is_online = ?, last_seen_at = ? WHERE device_uuid = ?');
    stmt.run(isOnline ? 1 : 0, now, deviceUuid);
  }

  /**
   * Update device configuration
   */
  static updateConfig(deviceUuid, deviceConfig) {
    const configJson = JSON.stringify(deviceConfig);
    const stmt = db.prepare('UPDATE devices SET device_config = ? WHERE device_uuid = ?');
    stmt.run(configJson, deviceUuid);
  }

  /**
   * Delete device (soft delete)
   */
  static delete(deviceUuid) {
    const stmt = db.prepare('UPDATE devices SET is_active = 0 WHERE device_uuid = ?');
    stmt.run(deviceUuid);
  }

  /**
   * Get all devices for a user (for Google Home SYNC)
   */
  static findAllForSync(ownerUserId) {
    const stmt = db.prepare(`
      SELECT device_uuid, device_name, device_type, device_label, capabilities, is_online
      FROM devices 
      WHERE owner_user_id = ? AND is_active = 1
      ORDER BY provisioned_at ASC
    `);
    const devices = stmt.all(ownerUserId);
    return devices.map(device => {
      if (device.capabilities) device.capabilities = JSON.parse(device.capabilities);
      return device;
    });
  }
}

/**
 * Google Account Link Model
 */
export class GoogleAccountLinkModel {
  /**
   * Create or update Google account link
   */
  static createOrUpdate({ userId, googleAgentUserId, googleAccountId = null, accessToken = null, refreshToken = null, tokenExpiresAt = null }) {
    const now = Date.now();

    // Check if link exists
    const existing = this.findByAgentUserId(googleAgentUserId);
    
    if (existing) {
      const stmt = db.prepare(`
        UPDATE google_account_links 
        SET user_id = ?, google_account_id = ?, access_token = ?, refresh_token = ?, token_expires_at = ?, last_sync_at = ?, is_active = 1
        WHERE google_agent_user_id = ?
      `);
      stmt.run(userId, googleAccountId, accessToken, refreshToken, tokenExpiresAt, now, googleAgentUserId);
      return { ...existing, userId, googleAccountId, lastSyncAt: now };
    } else {
      const stmt = db.prepare(`
        INSERT INTO google_account_links (user_id, google_agent_user_id, google_account_id, access_token, refresh_token, token_expires_at, linked_at, last_sync_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      const result = stmt.run(userId, googleAgentUserId, googleAccountId, accessToken, refreshToken, tokenExpiresAt, now, now);
      return {
        id: result.lastInsertRowid,
        userId,
        googleAgentUserId,
        googleAccountId,
        linkedAt: now,
        lastSyncAt: now
      };
    }
  }

  /**
   * Find by Google agent user ID
   */
  static findByAgentUserId(googleAgentUserId) {
    const stmt = db.prepare('SELECT * FROM google_account_links WHERE google_agent_user_id = ? AND is_active = 1');
    return stmt.get(googleAgentUserId);
  }

  /**
   * Find by user ID
   */
  static findByUserId(userId) {
    const stmt = db.prepare('SELECT * FROM google_account_links WHERE user_id = ? AND is_active = 1');
    return stmt.get(userId);
  }

  /**
   * Disconnect (soft delete)
   */
  static disconnect(googleAgentUserId) {
    const stmt = db.prepare('UPDATE google_account_links SET is_active = 0 WHERE google_agent_user_id = ?');
    stmt.run(googleAgentUserId);
  }

  /**
   * Update last sync time
   */
  static updateLastSync(googleAgentUserId) {
    const stmt = db.prepare('UPDATE google_account_links SET last_sync_at = ? WHERE google_agent_user_id = ?');
    stmt.run(Date.now(), googleAgentUserId);
  }
}

/**
 * ThingsBoard Session Model
 */
export class ThingsBoardSessionModel {
  /**
   * Create or update session
   */
  static createOrUpdate({ userId, jwtToken, refreshToken = null, expiresIn = 3600 }) {
    const now = Date.now();
    const tokenExpiresAt = now + (expiresIn * 1000);

    // Deactivate old sessions
    const deactivateStmt = db.prepare('UPDATE thingsboard_sessions SET is_active = 0 WHERE user_id = ?');
    deactivateStmt.run(userId);

    // Create new session
    const stmt = db.prepare(`
      INSERT INTO thingsboard_sessions (user_id, jwt_token, refresh_token, token_expires_at, created_at, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(userId, jwtToken, refreshToken, tokenExpiresAt, now);
    
    return {
      id: result.lastInsertRowid,
      userId,
      jwtToken,
      refreshToken,
      tokenExpiresAt,
      createdAt: now
    };
  }

  /**
   * Get active session for user
   */
  static findActiveByUserId(userId) {
    const stmt = db.prepare(`
      SELECT * FROM thingsboard_sessions 
      WHERE user_id = ? AND is_active = 1 AND token_expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `);
    return stmt.get(userId, Date.now());
  }

  /**
   * Invalidate session
   */
  static invalidate(userId) {
    const stmt = db.prepare('UPDATE thingsboard_sessions SET is_active = 0 WHERE user_id = ?');
    stmt.run(userId);
  }
}

/**
 * Audit Log Model
 */
export class AuditLogModel {
  /**
   * Create audit log entry
   */
  static log({ userId = null, action, resourceType, resourceId = null, details = null, ipAddress = null, userAgent = null }) {
    const now = Date.now();
    const detailsJson = details ? JSON.stringify(details) : null;

    const stmt = db.prepare(`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId, action, resourceType, resourceId, detailsJson, ipAddress, userAgent, now);
  }

  /**
   * Get logs for user
   */
  static findByUser(userId, limit = 100) {
    const stmt = db.prepare(`
      SELECT * FROM audit_log 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(userId, limit);
  }
}

export default {
  UserModel,
  DeviceModel,
  GoogleAccountLinkModel,
  ThingsBoardSessionModel,
  AuditLogModel
};
