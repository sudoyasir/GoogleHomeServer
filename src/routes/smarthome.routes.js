import express from 'express';
import { GoogleAccountLinkModel, DeviceModel, UserModel } from '../database/models.js';
import thingsboardService from '../services/thingsboard.service.js';
import { log } from '../utils/logger.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

/**
 * Extract agentUserId from Authorization header
 */
const extractAgentUserId = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.decode(token);
    return decoded?.agentUserId || null;
  } catch {
    return null;
  }
};

/**
 * POST /smarthome/fulfillment
 * Google Smart Home fulfillment endpoint
 * Handles SYNC, QUERY, EXECUTE, DISCONNECT intents
 */
router.post('/fulfillment', async (req, res) => {
  try {
    const { requestId, inputs } = req.body;

    if (!requestId || !inputs || !Array.isArray(inputs)) {
      log.warn('Invalid Google Smart Home request');
      return res.status(400).json({
        error: 'Invalid request format'
      });
    }

    const input = inputs[0];
    const intent = input.intent;

    log.google(intent, extractAgentUserId(req), true, { requestId });

    // Route to appropriate handler
    switch (intent) {
      case 'action.devices.SYNC':
        return await handleSync(req, res);
      
      case 'action.devices.QUERY':
        return await handleQuery(req, res);
      
      case 'action.devices.EXECUTE':
        return await handleExecute(req, res);
      
      case 'action.devices.DISCONNECT':
        return await handleDisconnect(req, res);
      
      default:
        log.warn('Unknown intent', { intent });
        return res.status(400).json({
          requestId,
          payload: {
            errorCode: 'notSupported'
          }
        });
    }
  } catch (error) {
    log.error('Smart Home fulfillment error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      requestId: req.body.requestId,
      payload: {
        errorCode: 'hardError',
        debugString: error.message
      }
    });
  }
});

/**
 * SYNC Intent - Return user's devices
 */
async function handleSync(req, res) {
  try {
    const { requestId } = req.body;
    const agentUserId = extractAgentUserId(req);

    if (!agentUserId) {
      return res.status(401).json({
        requestId,
        payload: {
          errorCode: 'authFailure'
        }
      });
    }

    // Get user from agent user ID
    const accountLink = GoogleAccountLinkModel.findByAgentUserId(agentUserId);
    if (!accountLink) {
      log.warn('Account link not found', { agentUserId });
      return res.status(401).json({
        requestId,
        payload: {
          errorCode: 'authFailure'
        }
      });
    }

    const userId = accountLink.user_id;

    // Get user's devices
    const devices = DeviceModel.findAllForSync(userId);

    // Convert devices to Google Home format
    const googleDevices = devices.map(device => convertToGoogleDevice(device));

    // Update last sync time
    GoogleAccountLinkModel.updateLastSync(agentUserId);

    log.google('SYNC', agentUserId, true, { deviceCount: googleDevices.length });

    res.json({
      requestId,
      payload: {
        agentUserId,
        devices: googleDevices
      }
    });
  } catch (error) {
    log.error('SYNC error', { error: error.message });
    return res.status(500).json({
      requestId: req.body.requestId,
      payload: {
        errorCode: 'hardError',
        debugString: error.message
      }
    });
  }
}

/**
 * QUERY Intent - Return device states
 */
async function handleQuery(req, res) {
  try {
    const { requestId, inputs } = req.body;
    const agentUserId = extractAgentUserId(req);

    if (!agentUserId) {
      return res.status(401).json({
        requestId,
        payload: {
          errorCode: 'authFailure'
        }
      });
    }

    const accountLink = GoogleAccountLinkModel.findByAgentUserId(agentUserId);
    if (!accountLink) {
      return res.status(401).json({
        requestId,
        payload: {
          errorCode: 'authFailure'
        }
      });
    }

    const requestedDevices = inputs[0].payload.devices;
    const deviceStates = {};

    // Query each device
    for (const reqDevice of requestedDevices) {
      const deviceId = reqDevice.id; // This is the device UUID
      
      try {
        const device = DeviceModel.findByUuid(deviceId);
        
        if (!device || device.owner_user_id !== accountLink.user_id) {
          deviceStates[deviceId] = {
            status: 'ERROR',
            errorCode: 'deviceNotFound'
          };
          continue;
        }

        // Get device state from ThingsBoard
        const telemetry = await thingsboardService.getLatestTelemetry(
          device.thingsboard_device_id,
          ['device1_state', 'device2_state', 'device3_state', 'device4_state', 'fan_speed']
        );

        const attributes = await thingsboardService.getDeviceAttributes(
          device.thingsboard_device_id,
          'SERVER_SCOPE'
        );

        // Convert to Google Home state format
        deviceStates[deviceId] = {
          status: 'SUCCESS',
          online: device.is_online === 1,
          ...convertToGoogleState(device, telemetry, attributes)
        };
      } catch (error) {
        log.error('Query device error', { deviceId, error: error.message });
        deviceStates[deviceId] = {
          status: 'ERROR',
          errorCode: 'hardError'
        };
      }
    }

    log.google('QUERY', agentUserId, true, { deviceCount: requestedDevices.length });

    res.json({
      requestId,
      payload: {
        devices: deviceStates
      }
    });
  } catch (error) {
    log.error('QUERY error', { error: error.message });
    return res.status(500).json({
      requestId: req.body.requestId,
      payload: {
        errorCode: 'hardError',
        debugString: error.message
      }
    });
  }
}

/**
 * EXECUTE Intent - Execute device commands
 */
async function handleExecute(req, res) {
  try {
    const { requestId, inputs } = req.body;
    const agentUserId = extractAgentUserId(req);

    if (!agentUserId) {
      return res.status(401).json({
        requestId,
        payload: {
          errorCode: 'authFailure'
        }
      });
    }

    const accountLink = GoogleAccountLinkModel.findByAgentUserId(agentUserId);
    if (!accountLink) {
      return res.status(401).json({
        requestId,
        payload: {
          errorCode: 'authFailure'
        }
      });
    }

    const commands = inputs[0].payload.commands;
    const commandResults = [];

    // Process each command
    for (const command of commands) {
      for (const device of command.devices) {
        const deviceId = device.id;
        
        try {
          const dbDevice = DeviceModel.findByUuid(deviceId);
          
          if (!dbDevice || dbDevice.owner_user_id !== accountLink.user_id) {
            commandResults.push({
              ids: [deviceId],
              status: 'ERROR',
              errorCode: 'deviceNotFound'
            });
            continue;
          }

          // Execute each command
          for (const execution of command.execution) {
            const googleCommand = execution.command;
            const params = execution.params;

            // Convert Google command to ThingsBoard RPC
            const rpcCommand = convertGoogleCommandToRpc(googleCommand, params, dbDevice);
            
            if (rpcCommand) {
              await thingsboardService.sendRpcCommand(
                dbDevice.thingsboard_device_id,
                rpcCommand.method,
                rpcCommand.params
              );

              commandResults.push({
                ids: [deviceId],
                status: 'SUCCESS',
                states: {
                  online: true,
                  ...rpcCommand.resultState
                }
              });

              log.google('EXECUTE', agentUserId, true, { 
                deviceId, 
                command: googleCommand,
                rpcMethod: rpcCommand.method 
              });
            } else {
              commandResults.push({
                ids: [deviceId],
                status: 'ERROR',
                errorCode: 'functionNotSupported'
              });
            }
          }
        } catch (error) {
          log.error('Execute command error', { deviceId, error: error.message });
          commandResults.push({
            ids: [deviceId],
            status: 'ERROR',
            errorCode: 'hardError'
          });
        }
      }
    }

    res.json({
      requestId,
      payload: {
        commands: commandResults
      }
    });
  } catch (error) {
    log.error('EXECUTE error', { error: error.message });
    return res.status(500).json({
      requestId: req.body.requestId,
      payload: {
        errorCode: 'hardError',
        debugString: error.message
      }
    });
  }
}

/**
 * DISCONNECT Intent - Unlink account
 */
async function handleDisconnect(req, res) {
  try {
    const { requestId } = req.body;
    const agentUserId = extractAgentUserId(req);

    if (!agentUserId) {
      return res.json({
        requestId,
        payload: {}
      });
    }

    // Disconnect account link
    GoogleAccountLinkModel.disconnect(agentUserId);

    log.google('DISCONNECT', agentUserId, true);

    res.json({
      requestId,
      payload: {}
    });
  } catch (error) {
    log.error('DISCONNECT error', { error: error.message });
    return res.json({
      requestId: req.body.requestId,
      payload: {}
    });
  }
}

/**
 * Convert device to Google Home device format
 */
function convertToGoogleDevice(device) {
  const capabilities = device.capabilities || [];
  
  // Determine device type and traits based on capabilities
  let deviceType = 'action.devices.types.OUTLET';
  let traits = ['action.devices.traits.OnOff'];

  if (capabilities.includes('light') || capabilities.includes('dimmer')) {
    deviceType = 'action.devices.types.LIGHT';
    traits = ['action.devices.traits.OnOff'];
    
    if (capabilities.includes('dimmer')) {
      traits.push('action.devices.traits.Brightness');
    }
  } else if (capabilities.includes('fan') || capabilities.includes('speed')) {
    deviceType = 'action.devices.types.FAN';
    traits = ['action.devices.traits.OnOff', 'action.devices.traits.FanSpeed'];
  } else if (capabilities.includes('outlet')) {
    deviceType = 'action.devices.types.OUTLET';
    traits = ['action.devices.traits.OnOff'];
  }

  return {
    id: device.device_uuid,
    type: deviceType,
    traits,
    name: {
      defaultNames: [device.device_name],
      name: device.device_label || device.device_name,
      nicknames: [device.device_label || device.device_name]
    },
    willReportState: true,
    deviceInfo: {
      manufacturer: 'Smart Home Panel',
      model: device.device_type,
      hwVersion: '1.0',
      swVersion: '1.0'
    }
  };
}

/**
 * Convert device state to Google Home state format
 */
function convertToGoogleState(device, telemetry, attributes) {
  const state = { on: false };

  // Parse telemetry for device states
  if (telemetry) {
    // For simplicity, check first device state
    // In production, you'd parse the device's specific state
    const deviceStates = Object.keys(telemetry)
      .filter(key => key.includes('device') && key.includes('state'))
      .map(key => telemetry[key]?.[0]?.value);

    state.on = deviceStates.some(s => s === 1 || s === true);

    // Fan speed
    if (telemetry.fan_speed && telemetry.fan_speed[0]) {
      const speed = telemetry.fan_speed[0].value;
      state.currentFanSpeedSetting = `speed_${speed}`;
    }
  }

  return state;
}

/**
 * Convert Google command to ThingsBoard RPC
 */
function convertGoogleCommandToRpc(googleCommand, params, device) {
  const capabilities = device.capabilities || [];

  switch (googleCommand) {
    case 'action.devices.commands.OnOff':
      // Find the first device to control (in a real implementation, you'd track which sub-device)
      return {
        method: 'setDeviceState',
        params: {
          device_id: device.device_id || 'device1',
          state: params.on
        },
        resultState: {
          on: params.on
        }
      };

    case 'action.devices.commands.SetFanSpeed':
      if (capabilities.includes('fan') || capabilities.includes('speed')) {
        // Map Google fan speed to hardware speed (0-5)
        const speedMap = {
          'speed_0': 0,
          'speed_1': 1,
          'speed_2': 2,
          'speed_3': 3,
          'speed_4': 4,
          'speed_5': 5
        };
        const speed = speedMap[params.fanSpeed] || 0;
        
        return {
          method: 'setFanSpeed',
          params: {
            speed
          },
          resultState: {
            currentFanSpeedSetting: params.fanSpeed
          }
        };
      }
      return null;

    case 'action.devices.commands.BrightnessAbsolute':
      if (capabilities.includes('dimmer')) {
        // Convert brightness (0-100) to device-specific range
        return {
          method: 'setBrightness',
          params: {
            brightness: params.brightness
          },
          resultState: {
            brightness: params.brightness
          }
        };
      }
      return null;

    default:
      return null;
  }
}

export default router;
