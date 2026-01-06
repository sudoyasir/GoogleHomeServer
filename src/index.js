import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { migrate } from './database/db.js';
import authRoutes from './routes/auth.routes.js';
import deviceRoutes from './routes/device.routes.js';
import oauthRoutes from './routes/oauth.routes.js';
import smarthomeRoutes from './routes/smarthome.routes.js';
import { log } from './utils/logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ═══════════════════════════════════════════════════════════════
// DATABASE INITIALIZATION
// ═══════════════════════════════════════════════════════════════

try {
  log.info('Initializing database...');
  migrate();
  log.info('Database initialized successfully');
} catch (error) {
  log.error('Database initialization failed', { error: error.message });
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow OAuth redirects
}));

// CORS configuration
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://oauth-redirect.googleusercontent.com', process.env.FRONTEND_URL]
    : '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000 || 900, // 15 minutes
});

app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (error) {
    log.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.'
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GENERAL MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Request logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Request timing and logging
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    log.response(req, res, duration);
  });
  
  next();
});

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/device', deviceRoutes);

// OAuth routes
app.use('/oauth', oauthRoutes);

// Google Smart Home routes
app.use('/smarthome', smarthomeRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Google Smart Home Server',
    version: '1.0.0',
    description: 'Cloud-to-Cloud bridge for Google Assistant and ThingsBoard',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      devices: '/api/device/*',
      oauth: '/oauth/*',
      smarthome: '/smarthome/fulfillment'
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    path: req.path
  });
});

// Global error handler
app.use((error, req, res, next) => {
  log.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method
  });

  res.status(error.status || 500).json({
    error: error.name || 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An error occurred' 
      : error.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
  });
});

// ═══════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════

const server = app.listen(PORT, HOST, () => {
  log.info(`Server started`, {
    port: PORT,
    host: HOST,
    environment: process.env.NODE_ENV || 'development',
    thingsboardUrl: process.env.THINGSBOARD_URL
  });
  
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║        🏠 Google Smart Home Server                           ║
║                                                               ║
║        Server running on: http://${HOST}:${PORT}           ║
║        Environment: ${(process.env.NODE_ENV || 'development').toUpperCase().padEnd(15)}                         ║
║                                                               ║
║        Endpoints:                                             ║
║        • Health: GET /health                                  ║
║        • Auth: POST /api/auth/login                           ║
║        • Device Provision: POST /api/device/register          ║
║        • OAuth: GET /oauth/authorize                          ║
║        • Smart Home: POST /smarthome/fulfillment              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════

const gracefulShutdown = (signal) => {
  log.info(`${signal} received, shutting down gracefully...`);
  
  server.close(() => {
    log.info('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error: error.message, stack: error.stack });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection', { reason, promise });
});

export default app;
