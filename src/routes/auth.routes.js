import express from 'express';
import { body, validationResult } from 'express-validator';
import { UserModel, AuditLogModel } from '../database/models.js';
import { authenticate, generateToken } from '../middleware/auth.js';
import thingsboardService from '../services/thingsboard.service.js';
import { log } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Register new user
 */
router.post('/register',
  [
    body('username').notEmpty().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, email, password, firstName, lastName } = req.body;

      // Check if user exists
      const existingUser = UserModel.findByUsername(username);
      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          message: 'Username is already taken'
        });
      }

      // Create user in ThingsBoard
      let thingsboardUserId = null;
      let thingsboardCustomerId = null;
      
      try {
        const tbUser = await thingsboardService.createUser(
          email,
          firstName || username,
          lastName || 'User'
        );
        
        if (tbUser && tbUser.id) {
          thingsboardUserId = tbUser.id.id;
          thingsboardCustomerId = tbUser.customerId?.id || null;
        }
      } catch (tbError) {
        log.warn('Failed to create ThingsBoard user', { error: tbError.message, email });
        // Continue with backend user creation even if ThingsBoard fails
      }

      // Create user in local database
      const user = UserModel.create({
        username,
        email,
        password,
        thingsboardUserId,
        thingsboardCustomerId
      });

      // Generate JWT token
      const token = generateToken(user);

      // Audit log
      AuditLogModel.log({
        userId: user.id,
        action: 'user_registered',
        resourceType: 'user',
        resourceId: user.backendUserId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      log.auth('register', user.id, true, { username, email });

      res.status(201).json({
        success: true,
        token,
        user: {
          backendUserId: user.backendUserId,
          username: user.username,
          email: user.email
        }
      });
    } catch (error) {
      log.error('Registration error', { error: error.message, stack: error.stack });
      res.status(500).json({
        error: 'Registration failed',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/auth/login
 * User login
 */
router.post('/login',
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { username, password } = req.body;

      // Find user
      const user = UserModel.findByUsername(username);
      if (!user) {
        log.auth('login', null, false, { username, reason: 'user_not_found' });
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid username or password'
        });
      }

      // Verify password
      const isValidPassword = UserModel.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        log.auth('login', user.id, false, { username, reason: 'invalid_password' });
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid username or password'
        });
      }

      // Generate JWT token
      const token = generateToken(user);

      // Audit log
      AuditLogModel.log({
        userId: user.id,
        action: 'user_login',
        resourceType: 'user',
        resourceId: user.backend_user_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      log.auth('login', user.id, true, { username });

      res.json({
        success: true,
        token,
        user: {
          backendUserId: user.backend_user_id,
          username: user.username,
          email: user.email
        }
      });
    } catch (error) {
      log.error('Login error', { error: error.message });
      res.status(500).json({
        error: 'Login failed',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = UserModel.findByBackendUserId(req.user.backendUserId);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        backendUserId: user.backend_user_id,
        username: user.username,
        email: user.email,
        thingsboardUserId: user.thingsboard_user_id,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    log.error('Get user error', { error: error.message });
    res.status(500).json({
      error: 'Failed to get user',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/thingsboard/link
 * Link user to ThingsBoard account
 */
router.post('/thingsboard/link',
  authenticate,
  [
    body('thingsboardUsername').notEmpty().withMessage('ThingsBoard username is required'),
    body('thingsboardPassword').notEmpty().withMessage('ThingsBoard password is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { thingsboardUsername, thingsboardPassword } = req.body;
      const userId = req.user.id;

      // Login to ThingsBoard
      const { token } = await thingsboardService.login(thingsboardUsername, thingsboardPassword);
      
      if (!token) {
        return res.status(401).json({
          error: 'ThingsBoard authentication failed',
          message: 'Invalid ThingsBoard credentials'
        });
      }

      // Get ThingsBoard user info
      const tbUser = await thingsboardService.getUserByEmail(thingsboardUsername);
      
      if (tbUser && tbUser.id) {
        UserModel.updateThingsBoardMapping(
          userId,
          tbUser.id.id,
          tbUser.customerId?.id || null
        );

        log.auth('thingsboard_link', userId, true, { thingsboardUsername });

        res.json({
          success: true,
          message: 'ThingsBoard account linked successfully'
        });
      } else {
        res.status(500).json({
          error: 'Failed to link ThingsBoard account',
          message: 'Could not retrieve ThingsBoard user info'
        });
      }
    } catch (error) {
      log.error('ThingsBoard link error', { error: error.message });
      res.status(500).json({
        error: 'Failed to link ThingsBoard account',
        message: error.message
      });
    }
  }
);

export default router;
