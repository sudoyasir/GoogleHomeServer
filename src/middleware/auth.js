import jwt from 'jsonwebtoken';
import { UserModel, GoogleAccountLinkModel } from '../database/models.js';
import { log } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Authentication middleware - verify JWT token
 */
export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Attach user info to request
      req.user = {
        id: decoded.userId,
        backendUserId: decoded.backendUserId,
        username: decoded.username
      };
      
      next();
    } catch (jwtError) {
      log.warn('Invalid JWT token', { error: jwtError.message });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
    }
  } catch (error) {
    log.error('Authentication middleware error', { error: error.message });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};

/**
 * Google API key authentication (for Google Smart Home requests)
 */
export const authenticateGoogleRequest = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn('Google request missing authorization header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authorization header'
      });
    }

    const token = authHeader.substring(7);
    
    // For Google Smart Home, the token is the OAuth access token
    // We need to decode it to get the agentUserId
    // In production, you would validate this with Google's token endpoint
    
    // For now, we'll extract agentUserId from the token payload
    try {
      // Google sends JWT tokens, but we can also use our own tokens
      const decoded = jwt.decode(token);
      
      if (decoded && decoded.agentUserId) {
        req.googleUser = {
          agentUserId: decoded.agentUserId
        };
      } else {
        // If not a JWT, treat as opaque token and look it up
        const link = GoogleAccountLinkModel.findByAccessToken(token);
        if (link) {
          req.googleUser = {
            agentUserId: link.google_agent_user_id
          };
        } else {
          log.warn('Invalid Google access token');
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid access token'
          });
        }
      }
      
      next();
    } catch (error) {
      log.error('Google token validation error', { error: error.message });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token format'
      });
    }
  } catch (error) {
    log.error('Google authentication error', { error: error.message });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};

/**
 * Generate JWT token for user
 */
export const generateToken = (user) => {
  const payload = {
    userId: user.id,
    backendUserId: user.backend_user_id || user.backendUserId,
    username: user.username
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Generate OAuth authorization code
 */
export const generateAuthCode = (userId, clientId, redirectUri) => {
  const payload = {
    userId,
    clientId,
    redirectUri,
    type: 'auth_code',
    timestamp: Date.now()
  };
  
  // Short-lived auth code (10 minutes)
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' });
};

/**
 * Generate OAuth access token
 */
export const generateAccessToken = (userId, agentUserId, scope = 'smart_home') => {
  const payload = {
    userId,
    agentUserId,
    scope,
    type: 'access_token'
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
};

/**
 * Generate OAuth refresh token
 */
export const generateRefreshToken = (userId, agentUserId) => {
  const payload = {
    userId,
    agentUserId,
    type: 'refresh_token'
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '90d' });
};

/**
 * Verify OAuth authorization code
 */
export const verifyAuthCode = (code) => {
  try {
    const decoded = jwt.verify(code, JWT_SECRET);
    
    if (decoded.type !== 'auth_code') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    log.warn('Invalid auth code', { error: error.message });
    return null;
  }
};

/**
 * Verify OAuth refresh token
 */
export const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.type !== 'refresh_token') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    log.warn('Invalid refresh token', { error: error.message });
    return null;
  }
};

export default {
  authenticate,
  authenticateGoogleRequest,
  generateToken,
  generateAuthCode,
  generateAccessToken,
  generateRefreshToken,
  verifyAuthCode,
  verifyRefreshToken
};
