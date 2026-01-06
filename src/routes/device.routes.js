import express from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { UserModel, DeviceModel, AuditLogModel } from '../database/models.js';
import thingsboardService from '../services/thingsboard.service.js';
import { authenticate, generateToken } from '../middleware/auth.js';
import { log } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/device/register
 * Device auto-provisioning endpoint
 * Called by ESP32 on first boot
 */
router.post('/register',
  authenticate,
  [
    body('deviceName').notEmpty().withMessage('Device name is required'),
    body('deviceType').notEmpty().withMessage('Device type is required'),
    body('capabilities').isArray().withMessage('Capabilities must be an array')
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { deviceName, deviceType, capabilities, deviceLabel, deviceConfig } = req.body;
      const userId = req.user.id;

      log.device('provision_start', null, userId, { deviceName, deviceType });

      // Generate device UUID
      const deviceUuid = uuidv4();

      // Create device in ThingsBoard
      const tbDevice = await thingsboardService.createDevice(deviceName, deviceType, deviceLabel);
      
      if (!tbDevice || !tbDevice.id || !tbDevice.id.id) {
        log.error('ThingsBoard device creation failed', { deviceName, deviceType });
        return res.status(500).json({
          error: 'Device provisioning failed',
          message: 'Failed to create device in ThingsBoard'
        });
      }

      const thingsboardDeviceId = tbDevice.id.id;

      // Get device credentials (access token)
      const credentials = await thingsboardService.getDeviceCredentials(thingsboardDeviceId);
      
      if (!credentials || !credentials.credentialsId) {
        log.error('Failed to get device credentials', { thingsboardDeviceId });
        return res.status(500).json({
          error: 'Device provisioning failed',
          message: 'Failed to get device access token'
        });
      }

      const accessToken = credentials.credentialsId;

      // Get user's ThingsBoard customer ID
      const user = UserModel.findByBackendUserId(req.user.backendUserId);
      if (user && user.thingsboard_customer_id) {
        // Assign device to customer
        await thingsboardService.assignDeviceToCustomer(thingsboardDeviceId, user.thingsboard_customer_id);
      }

      // Store device in database
      const device = DeviceModel.create({
        deviceUuid,
        thingsboardDeviceId,
        deviceName,
        deviceType,
        ownerUserId: userId,
        accessToken,
        capabilities,
        deviceLabel,
        deviceConfig
      });

      // Audit log
      AuditLogModel.log({
        userId,
        action: 'device_provisioned',
        resourceType: 'device',
        resourceId: deviceUuid,
        details: { deviceName, deviceType, thingsboardDeviceId },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      log.device('provision_success', deviceUuid, userId, { 
        thingsboardDeviceId,
        deviceName 
      });

      res.status(201).json({
        success: true,
        device: {
          deviceUuid,
          deviceName,
          deviceType,
          accessToken, // ESP32 needs this for MQTT
          thingsboardUrl: process.env.THINGSBOARD_URL,
          mqttServer: process.env.THINGSBOARD_URL.replace(/^https?:\/\//, ''),
          mqttPort: 1883
        }
      });
    } catch (error) {
      log.error('Device provisioning error', { error: error.message, stack: error.stack });
      res.status(500).json({
        error: 'Device provisioning failed',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/device/list
 * List all devices for authenticated user
 */
router.get('/list', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const devices = DeviceModel.findByOwner(userId);

    res.json({
      success: true,
      devices: devices.map(d => ({
        deviceUuid: d.device_uuid,
        deviceName: d.device_name,
        deviceType: d.device_type,
        deviceLabel: d.device_label,
        capabilities: d.capabilities,
        isOnline: d.is_online === 1,
        lastSeen: d.last_seen_at,
        provisionedAt: d.provisioned_at
      }))
    });
  } catch (error) {
    log.error('List devices error', { error: error.message });
    res.status(500).json({
      error: 'Failed to list devices',
      message: error.message
    });
  }
});

/**
 * GET /api/device/:deviceUuid
 * Get device details
 */
router.get('/:deviceUuid', authenticate, async (req, res) => {
  try {
    const { deviceUuid } = req.params;
    const userId = req.user.id;

    const device = DeviceModel.findByUuid(deviceUuid);
    
    if (!device) {
      return res.status(404).json({
        error: 'Device not found'
      });
    }

    // Check ownership
    if (device.owner_user_id !== userId) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    // Get real-time data from ThingsBoard
    const telemetry = await thingsboardService.getLatestTelemetry(
      device.thingsboard_device_id,
      ['device1_state', 'device2_state', 'device3_state', 'device4_state', 'fan_speed']
    );

    const attributes = await thingsboardService.getDeviceAttributes(
      device.thingsboard_device_id,
      'SERVER_SCOPE'
    );

    res.json({
      success: true,
      device: {
        deviceUuid: device.device_uuid,
        deviceName: device.device_name,
        deviceType: device.device_type,
        deviceLabel: device.device_label,
        capabilities: device.capabilities,
        isOnline: device.is_online === 1,
        lastSeen: device.last_seen_at,
        provisionedAt: device.provisioned_at,
        telemetry,
        attributes
      }
    });
  } catch (error) {
    log.error('Get device error', { error: error.message });
    res.status(500).json({
      error: 'Failed to get device',
      message: error.message
    });
  }
});

/**
 * DELETE /api/device/:deviceUuid
 * Delete device
 */
router.delete('/:deviceUuid', authenticate, async (req, res) => {
  try {
    const { deviceUuid } = req.params;
    const userId = req.user.id;

    const device = DeviceModel.findByUuid(deviceUuid);
    
    if (!device) {
      return res.status(404).json({
        error: 'Device not found'
      });
    }

    // Check ownership
    if (device.owner_user_id !== userId) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    // Soft delete in database
    DeviceModel.delete(deviceUuid);

    // Audit log
    AuditLogModel.log({
      userId,
      action: 'device_deleted',
      resourceType: 'device',
      resourceId: deviceUuid,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    log.device('delete', deviceUuid, userId);

    res.json({
      success: true,
      message: 'Device deleted successfully'
    });
  } catch (error) {
    log.error('Delete device error', { error: error.message });
    res.status(500).json({
      error: 'Failed to delete device',
      message: error.message
    });
  }
});

/**
 * POST /api/device/:deviceUuid/control
 * Send control command to device via RPC
 */
router.post('/:deviceUuid/control',
  authenticate,
  [
    body('method').notEmpty().withMessage('Method is required'),
    body('params').isObject().withMessage('Params must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { deviceUuid } = req.params;
      const { method, params, timeout = 5000 } = req.body;
      const userId = req.user.id;

      const device = DeviceModel.findByUuid(deviceUuid);
      
      if (!device) {
        return res.status(404).json({
          error: 'Device not found'
        });
      }

      // Check ownership
      if (device.owner_user_id !== userId) {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      // Send RPC command to ThingsBoard
      const result = await thingsboardService.sendRpcCommand(
        device.thingsboard_device_id,
        method,
        params,
        null,
        timeout
      );

      log.device('rpc_command', deviceUuid, userId, { method, params });

      res.json({
        success: true,
        result
      });
    } catch (error) {
      log.error('Device control error', { error: error.message });
      res.status(500).json({
        error: 'Device control failed',
        message: error.message
      });
    }
  }
);

export default router;
