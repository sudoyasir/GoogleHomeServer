import express from 'express';
import { body, validationResult } from 'express-validator';
import { UserModel, GoogleAccountLinkModel, AuditLogModel } from '../database/models.js';
import { 
  generateAuthCode, 
  generateAccessToken, 
  generateRefreshToken,
  verifyAuthCode,
  verifyRefreshToken
} from '../middleware/auth.js';
import { log } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /oauth/authorize
 * OAuth 2.0 Authorization endpoint
 * Google redirects user here to grant access
 */
router.get('/authorize', async (req, res) => {
  try {
    const { client_id, redirect_uri, state, response_type } = req.query;

    // Validate required parameters
    if (!client_id || !redirect_uri || !state) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    }

    if (response_type !== 'code') {
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported'
      });
    }

    // Validate client_id
    const expectedClientId = process.env.OAUTH_CLIENT_ID;
    if (client_id !== expectedClientId) {
      log.warn('Invalid OAuth client_id', { client_id });
      return res.status(401).json({
        error: 'unauthorized_client',
        error_description: 'Invalid client_id'
      });
    }

    // In production, this would render a login/consent page
    // For now, we'll return a simple HTML form
    const loginHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Smart Home Authorization</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
    h2 { color: #333; }
    form { display: flex; flex-direction: column; gap: 10px; }
    input { padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
    button { padding: 10px; background: #4285f4; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #357ae8; }
    .error { color: red; font-size: 14px; }
  </style>
</head>
<body>
  <h2>Smart Home Authorization</h2>
  <p>Google Assistant wants to access your smart home devices.</p>
  <form id="loginForm">
    <input type="text" name="username" placeholder="Username" required />
    <input type="password" name="password" placeholder="Password" required />
    <button type="submit">Authorize</button>
    <div id="error" class="error"></div>
  </form>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const username = formData.get('username');
      const password = formData.get('password');
      
      try {
        const response = await fetch('/oauth/authorize/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            client_id: '${client_id}',
            redirect_uri: '${redirect_uri}',
            state: '${state}'
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          window.location.href = data.redirectUrl;
        } else {
          document.getElementById('error').textContent = data.message || 'Authorization failed';
        }
      } catch (error) {
        document.getElementById('error').textContent = 'Network error';
      }
    });
  </script>
</body>
</html>
    `;

    res.send(loginHtml);
  } catch (error) {
    log.error('OAuth authorize error', { error: error.message });
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

/**
 * POST /oauth/authorize/submit
 * Handle authorization form submission
 */
router.post('/authorize/submit',
  [
    body('username').notEmpty(),
    body('password').notEmpty(),
    body('client_id').notEmpty(),
    body('redirect_uri').notEmpty(),
    body('state').notEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request parameters'
        });
      }

      const { username, password, client_id, redirect_uri, state } = req.body;

      // Authenticate user
      const user = UserModel.findByUsername(username);
      if (!user || !UserModel.verifyPassword(password, user.password_hash)) {
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password'
        });
      }

      // Generate authorization code
      const authCode = generateAuthCode(user.id, client_id, redirect_uri);

      // Audit log
      AuditLogModel.log({
        userId: user.id,
        action: 'oauth_authorize',
        resourceType: 'oauth',
        details: { client_id, redirect_uri },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      log.auth('oauth_authorize', user.id, true, { client_id });

      // Redirect to Google with authorization code
      const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state}`;

      res.json({
        success: true,
        redirectUrl
      });
    } catch (error) {
      log.error('OAuth authorize submit error', { error: error.message });
      res.status(500).json({
        success: false,
        message: 'Authorization failed'
      });
    }
  }
);

/**
 * POST /oauth/token
 * OAuth 2.0 Token endpoint
 * Exchange authorization code for access token
 */
router.post('/token', async (req, res) => {
  try {
    const { grant_type, code, redirect_uri, client_id, client_secret, refresh_token } = req.body;

    // Validate client credentials
    const expectedClientId = process.env.OAUTH_CLIENT_ID;
    const expectedClientSecret = process.env.OAUTH_CLIENT_SECRET;

    if (client_id !== expectedClientId || client_secret !== expectedClientSecret) {
      log.warn('Invalid OAuth client credentials');
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      });
    }

    if (grant_type === 'authorization_code') {
      // Exchange authorization code for tokens
      if (!code || !redirect_uri) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing code or redirect_uri'
        });
      }

      // Verify authorization code
      const authData = verifyAuthCode(code);
      if (!authData) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code'
        });
      }

      // Verify redirect_uri matches
      if (authData.redirectUri !== redirect_uri) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Redirect URI mismatch'
        });
      }

      const userId = authData.userId;

      // Generate agent user ID (unique per user-Google pair)
      const agentUserId = `agent_${userId}_${Date.now()}`;

      // Generate tokens
      const accessToken = generateAccessToken(userId, agentUserId);
      const refreshToken = generateRefreshToken(userId, agentUserId);

      // Store account link
      GoogleAccountLinkModel.createOrUpdate({
        userId,
        googleAgentUserId: agentUserId,
        accessToken,
        refreshToken,
        tokenExpiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
      });

      log.google('token_exchange', agentUserId, true, { grant_type });

      res.json({
        token_type: 'Bearer',
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 2592000 // 30 days
      });

    } else if (grant_type === 'refresh_token') {
      // Refresh access token
      if (!refresh_token) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing refresh_token'
        });
      }

      // Verify refresh token
      const tokenData = verifyRefreshToken(refresh_token);
      if (!tokenData) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired refresh token'
        });
      }

      const { userId, agentUserId } = tokenData;

      // Generate new access token
      const newAccessToken = generateAccessToken(userId, agentUserId);

      // Update account link
      GoogleAccountLinkModel.createOrUpdate({
        userId,
        googleAgentUserId: agentUserId,
        accessToken: newAccessToken,
        refreshToken: refresh_token,
        tokenExpiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000)
      });

      log.google('token_refresh', agentUserId, true);

      res.json({
        token_type: 'Bearer',
        access_token: newAccessToken,
        expires_in: 2592000
      });

    } else {
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code and refresh_token are supported'
      });
    }
  } catch (error) {
    log.error('OAuth token error', { error: error.message });
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

export default router;
