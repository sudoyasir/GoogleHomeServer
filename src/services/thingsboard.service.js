import axios from 'axios';
import { ThingsBoardSessionModel } from '../database/models.js';

/**
 * ThingsBoard Service
 * Handles all communication with ThingsBoard REST API
 * Uses JWT authentication for API calls
 */
class ThingsBoardService {
  constructor() {
    this.baseURL = process.env.THINGSBOARD_URL || 'http://128.199.239.218:8080';
    this.adminUsername = process.env.THINGSBOARD_ADMIN_USERNAME;
    this.adminPassword = process.env.THINGSBOARD_ADMIN_PASSWORD;
    this.adminToken = null;
    this.adminTokenExpiry = null;
  }

  /**
   * Login to ThingsBoard and get JWT token
   */
  async login(username, password) {
    try {
      const response = await axios.post(`${this.baseURL}/api/auth/login`, {
        username,
        password
      });

      if (response.data && response.data.token) {
        return {
          token: response.data.token,
          refreshToken: response.data.refreshToken,
          expiresIn: 3600 // 1 hour default
        };
      }

      throw new Error('Invalid response from ThingsBoard login');
    } catch (error) {
      console.error('ThingsBoard login error:', error.response?.data || error.message);
      throw new Error(`ThingsBoard authentication failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get admin JWT token (cached with auto-refresh)
   */
  async getAdminToken() {
    // Return cached token if valid
    if (this.adminToken && this.adminTokenExpiry && Date.now() < this.adminTokenExpiry) {
      return this.adminToken;
    }

    // Login as admin
    const { token, expiresIn } = await this.login(this.adminUsername, this.adminPassword);
    this.adminToken = token;
    this.adminTokenExpiry = Date.now() + (expiresIn * 1000) - 60000; // Refresh 1 min before expiry
    
    return this.adminToken;
  }

  /**
   * Get JWT token for user (from session or create new)
   */
  async getUserToken(userId, username, password) {
    // Check for existing valid session
    const session = ThingsBoardSessionModel.findActiveByUserId(userId);
    if (session && session.jwt_token) {
      return session.jwt_token;
    }

    // Create new session
    const { token, refreshToken, expiresIn } = await this.login(username, password);
    ThingsBoardSessionModel.createOrUpdate({
      userId,
      jwtToken: token,
      refreshToken,
      expiresIn
    });

    return token;
  }

  /**
   * Create device in ThingsBoard
   */
  async createDevice(deviceName, deviceType, deviceLabel = null) {
    try {
      const token = await this.getAdminToken();
      
      const deviceData = {
        name: deviceName,
        type: deviceType,
        label: deviceLabel || deviceName
      };

      const response = await axios.post(
        `${this.baseURL}/api/device`,
        deviceData,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard create device error:', error.response?.data || error.message);
      throw new Error(`Failed to create device: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get device credentials (access token)
   */
  async getDeviceCredentials(deviceId) {
    try {
      const token = await this.getAdminToken();
      
      const response = await axios.get(
        `${this.baseURL}/api/device/${deviceId}/credentials`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard get credentials error:', error.response?.data || error.message);
      throw new Error(`Failed to get device credentials: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Assign device to customer
   */
  async assignDeviceToCustomer(deviceId, customerId) {
    try {
      const token = await this.getAdminToken();
      
      const response = await axios.post(
        `${this.baseURL}/api/customer/${customerId}/device/${deviceId}`,
        {},
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard assign device error:', error.response?.data || error.message);
      throw new Error(`Failed to assign device: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get device by ID
   */
  async getDevice(deviceId, userToken = null) {
    try {
      const token = userToken || await this.getAdminToken();
      
      const response = await axios.get(
        `${this.baseURL}/api/device/${deviceId}`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard get device error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get device telemetry (latest values)
   */
  async getLatestTelemetry(deviceId, keys, userToken = null) {
    try {
      const token = userToken || await this.getAdminToken();
      const keysParam = Array.isArray(keys) ? keys.join(',') : keys;
      
      const response = await axios.get(
        `${this.baseURL}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=${keysParam}`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard get telemetry error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get device attributes
   */
  async getDeviceAttributes(deviceId, scope = 'SERVER_SCOPE', userToken = null) {
    try {
      const token = userToken || await this.getAdminToken();
      
      const response = await axios.get(
        `${this.baseURL}/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard get attributes error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Send RPC command to device
   */
  async sendRpcCommand(deviceId, method, params, userToken = null, timeout = 5000) {
    try {
      const token = userToken || await this.getAdminToken();
      
      const requestBody = {
        method,
        params,
        persistent: true,
        timeout
      };

      const response = await axios.post(
        `${this.baseURL}/api/rpc/oneway/${deviceId}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard RPC error:', error.response?.data || error.message);
      throw new Error(`RPC command failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get customer devices
   */
  async getCustomerDevices(customerId, pageSize = 100, page = 0) {
    try {
      const token = await this.getAdminToken();
      
      const response = await axios.get(
        `${this.baseURL}/api/customer/${customerId}/devices?pageSize=${pageSize}&page=${page}`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('ThingsBoard get customer devices error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get tenant devices (all devices)
   */
  async getTenantDevices(pageSize = 100, page = 0) {
    try {
      const token = await this.getAdminToken();
      
      const response = await axios.get(
        `${this.baseURL}/api/tenant/devices?pageSize=${pageSize}&page=${page}`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('ThingsBoard get tenant devices error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Create user in ThingsBoard
   */
  async createUser(email, firstName, lastName, customerId = null) {
    try {
      const token = await this.getAdminToken();
      
      const userData = {
        email,
        firstName,
        lastName,
        authority: customerId ? 'CUSTOMER_USER' : 'TENANT_ADMIN'
      };

      if (customerId) {
        userData.customerId = { id: customerId, entityType: 'CUSTOMER' };
      }

      const response = await axios.post(
        `${this.baseURL}/api/user`,
        userData,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard create user error:', error.response?.data || error.message);
      throw new Error(`Failed to create user: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    try {
      const token = await this.getAdminToken();
      
      const response = await axios.get(
        `${this.baseURL}/api/user?email=${encodeURIComponent(email)}`,
        {
          headers: {
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('ThingsBoard get user error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Set device attributes
   */
  async setDeviceAttributes(deviceId, attributes, scope = 'SERVER_SCOPE', userToken = null) {
    try {
      const token = userToken || await this.getAdminToken();
      
      const response = await axios.post(
        `${this.baseURL}/api/plugins/telemetry/DEVICE/${deviceId}/attributes/${scope}`,
        attributes,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('ThingsBoard set attributes error:', error.response?.data || error.message);
      throw new Error(`Failed to set attributes: ${error.response?.data?.message || error.message}`);
    }
  }
}

export default new ThingsBoardService();
