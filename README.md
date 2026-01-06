# Google Smart Home Server

Production-grade Node.js backend that bridges **Google Assistant** with **ThingsBoard IoT Platform** for ESP32 smart home devices.

## 🏗️ Architecture Overview

```
┌─────────────────┐
│ Google Assistant│
└────────┬────────┘
         │ OAuth 2.0 + Smart Home API
         │
┌────────▼──────────────────────────────────────┐
│         GoogleHomeServer (This App)           │
│  ┌──────────────────────────────────────────┐ │
│  │ • OAuth 2.0 Account Linking              │ │
│  │ • Smart Home Intents (SYNC/QUERY/EXECUTE)│ │
│  │ • Device Auto-Provisioning               │ │
│  │ • User & Device Management               │ │
│  │ • JWT Authentication                     │ │
│  └──────────────────────────────────────────┘ │
└────────┬──────────────────────────────────────┘
         │ REST API + JWT
         │
┌────────▼──────────────────────────────────────┐
│          ThingsBoard IoT Platform             │
│  • Device Registry                            │
│  • MQTT Broker                                │
│  • Telemetry & Attributes Storage             │
│  • RPC Command Routing                        │
└────────┬──────────────────────────────────────┘
         │ MQTT (Access Token Auth)
         │
┌────────▼──────────────────────────────────────┐
│         ESP32 Smart Home Panels               │
│  • GPIO/I2C Device Control                    │
│  • MQTT Client                                │
│  • RPC Handler                                │
│  • Telemetry Reporting                        │
└───────────────────────────────────────────────┘
```

## 🚀 Features

### ✅ Production-Grade Implementation

- **OAuth 2.0 Account Linking** - Secure Google account integration
- **Google Smart Home API** - Full SYNC, QUERY, EXECUTE, DISCONNECT support
- **Device Auto-Provisioning** - ESP32 devices register automatically
- **ThingsBoard Integration** - JWT authentication, device management, RPC commands
- **User Management** - Multi-user support with isolation
- **Security** - Rate limiting, helmet, CORS, JWT tokens
- **Database** - SQLite with migrations (easy to switch to PostgreSQL/MySQL)
- **Logging** - Structured logging with Winston
- **Error Handling** - Comprehensive error handling and graceful shutdown

### 📱 Supported Device Types

- **Lights** - On/Off, Dimming (via Google Assistant)
- **Fans** - Speed control (0-5 speeds)
- **Outlets** - On/Off control
- **Custom Devices** - Extensible capability system

## 🛠️ Installation

### Prerequisites

- Node.js >= 18.0.0
- ThingsBoard Community Edition (running)
- Google Cloud Project with Smart Home Action

### 1. Clone and Install

```bash
cd GoogleHomeServer
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# ThingsBoard Configuration
THINGSBOARD_URL=http://128.199.239.218:8080
THINGSBOARD_ADMIN_USERNAME=tenant@thingsboard.org
THINGSBOARD_ADMIN_PASSWORD=your_password

# OAuth 2.0 Configuration (from Google Cloud Console)
OAUTH_CLIENT_ID=your_google_client_id
OAUTH_CLIENT_SECRET=your_google_client_secret
OAUTH_REDIRECT_URI=https://oauth-redirect.googleusercontent.com/r/YOUR_PROJECT_ID

# JWT Configuration
JWT_SECRET=generate_a_strong_random_secret_here
JWT_EXPIRES_IN=7d

# Google Smart Home
GOOGLE_PROJECT_ID=your_google_project_id

# Database
DATABASE_PATH=./data/smart-home.db

# Logging
LOG_LEVEL=info

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### 3. Initialize Database

```bash
npm run migrate
```

### 4. Start Server

```bash
# Development
npm run dev

# Production
npm start
```

## 📡 API Endpoints

### Authentication

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "john",
  "email": "john@example.com",
  "password": "secure123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "john",
  "password": "secure123"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "backendUserId": "uuid",
    "username": "john",
    "email": "john@example.com"
  }
}
```

### Device Management

#### Register Device (Auto-Provisioning)
```http
POST /api/device/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceName": "Living Room Panel",
  "deviceType": "smart-home-panel",
  "capabilities": ["light", "fan", "outlet", "speed"],
  "deviceLabel": "Living Room",
  "deviceConfig": {
    "numDevices": 4,
    "hasFan": true
  }
}

Response:
{
  "success": true,
  "device": {
    "deviceUuid": "uuid",
    "deviceName": "Living Room Panel",
    "deviceType": "smart-home-panel",
    "accessToken": "thingsboard_access_token",
    "thingsboardUrl": "http://...",
    "mqttServer": "...",
    "mqttPort": 1883
  }
}
```

#### List Devices
```http
GET /api/device/list
Authorization: Bearer <token>
```

#### Control Device
```http
POST /api/device/:deviceUuid/control
Authorization: Bearer <token>
Content-Type: application/json

{
  "method": "setDeviceState",
  "params": {
    "device_id": "device1",
    "state": true
  }
}
```

### OAuth 2.0

#### Authorization Endpoint
```http
GET /oauth/authorize?client_id=...&redirect_uri=...&state=...&response_type=code
```

#### Token Exchange
```http
POST /oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "auth_code",
  "redirect_uri": "...",
  "client_id": "...",
  "client_secret": "..."
}
```

### Google Smart Home

#### Fulfillment Endpoint
```http
POST /smarthome/fulfillment
Authorization: Bearer <google_access_token>
Content-Type: application/json

{
  "requestId": "...",
  "inputs": [{
    "intent": "action.devices.SYNC"
  }]
}
```

## 🔧 Google Cloud Configuration

### 1. Create Smart Home Action

1. Go to [Google Actions Console](https://console.actions.google.com/)
2. Create new project
3. Choose "Smart Home" action type

### 2. Configure Account Linking

```
Client ID: <from your .env>
Client Secret: <from your .env>
Authorization URL: https://your-domain.com/oauth/authorize
Token URL: https://your-domain.com/oauth/token
```

### 3. Configure Fulfillment

```
Fulfillment URL: https://your-domain.com/smarthome/fulfillment
```

### 4. Test with Google Home App

1. Open Google Home app
2. Go to "Add" → "Set up device" → "Works with Google"
3. Search for your action
4. Complete account linking
5. Devices will appear automatically

## 🗄️ Database Schema

### Users
- `id` - Primary key
- `backend_user_id` - UUID (external identifier)
- `username` - Unique username
- `email` - Email address
- `password_hash` - Bcrypt hash
- `thingsboard_user_id` - ThingsBoard user mapping
- `thingsboard_customer_id` - ThingsBoard customer mapping

### Devices
- `device_uuid` - Device UUID (from ESP32)
- `thingsboard_device_id` - ThingsBoard device ID
- `device_name` - Device name
- `device_type` - Device type
- `owner_user_id` - Owner reference
- `access_token` - MQTT access token
- `capabilities` - JSON array of capabilities

### Google Account Links
- `user_id` - User reference
- `google_agent_user_id` - Google agent user ID
- `access_token` - OAuth access token
- `refresh_token` - OAuth refresh token

## 🔐 Security Features

- **JWT Authentication** - Secure token-based auth
- **bcrypt Password Hashing** - Industry standard
- **Rate Limiting** - Prevent abuse
- **Helmet** - Security headers
- **CORS** - Controlled cross-origin access
- **Input Validation** - Express-validator
- **SQL Injection Prevention** - Prepared statements
- **Audit Logging** - Track all important actions

## 📝 Logging

Logs are stored in `logs/` directory:

- `combined.log` - All logs
- `error.log` - Error logs only

Log format:
```json
{
  "timestamp": "2026-01-06 10:30:00",
  "level": "info",
  "message": "Request completed",
  "service": "google-home-server",
  "method": "POST",
  "url": "/api/device/register",
  "statusCode": 201,
  "responseTime": "123ms"
}
```

## 🚢 Deployment

### Replit Deployment

1. Fork this repository to Replit
2. Configure environment variables in Replit Secrets
3. Run: `npm install && npm start`
4. Replit will provide HTTPS URL automatically

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t google-home-server .
docker run -p 3000:3000 --env-file .env google-home-server
```

### VPS Deployment

1. Clone repository
2. Install Node.js 18+
3. Configure `.env`
4. Install PM2: `npm install -g pm2`
5. Start: `pm2 start src/index.js --name google-home-server`
6. Setup Nginx reverse proxy with SSL

## 🧪 Testing

### Manual Testing

1. **Health Check**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Register User**
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"test","email":"test@test.com","password":"test123"}'
   ```

3. **Login**
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"test","password":"test123"}'
   ```

4. **Provision Device**
   ```bash
   curl -X POST http://localhost:3000/api/device/register \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"deviceName":"Test Device","deviceType":"panel","capabilities":["light","fan"]}'
   ```

## 🔄 Integration Flow

### 1. User Registration
```
Mobile App → POST /api/auth/register → Database + ThingsBoard
```

### 2. Device Provisioning (ESP32 Boot)
```
ESP32 → POST /api/device/register → ThingsBoard Device Created → Access Token Returned
```

### 3. Google Account Linking
```
Google Home App → OAuth Flow → /oauth/authorize → User Login → /oauth/token → Account Linked
```

### 4. Device Sync
```
Google Assistant → SYNC Intent → /smarthome/fulfillment → Query Devices → Return Device List
```

### 5. Device Control
```
Google Assistant → EXECUTE Intent → /smarthome/fulfillment → RPC to ThingsBoard → MQTT to ESP32
```

## 📚 Project Structure

```
GoogleHomeServer/
├── src/
│   ├── index.js                 # Main server
│   ├── database/
│   │   ├── db.js               # Database initialization
│   │   └── models.js           # Data models
│   ├── routes/
│   │   ├── auth.routes.js      # Authentication
│   │   ├── device.routes.js    # Device management
│   │   ├── oauth.routes.js     # OAuth 2.0
│   │   └── smarthome.routes.js # Google Smart Home
│   ├── services/
│   │   └── thingsboard.service.js # ThingsBoard API
│   ├── middleware/
│   │   └── auth.js             # JWT middleware
│   └── utils/
│       └── logger.js           # Winston logger
├── data/                        # SQLite database
├── logs/                        # Application logs
├── package.json
├── .env.example
└── README.md
```

## 🤝 Contributing

This is a production-grade system. Contributions should:

1. Not break existing APIs
2. Include error handling
3. Follow existing patterns
4. Include logging
5. Be backward compatible

## 📄 License

MIT

## 👤 Author

Smart Home Panel Team

## 🆘 Support

For issues or questions:
1. Check logs in `logs/` directory
2. Enable debug logging: `LOG_LEVEL=debug`
3. Review ThingsBoard logs
4. Check ESP32 serial output

## 🎯 Next Steps

1. ✅ Complete server setup
2. Configure Google Cloud Project
3. Deploy to production
4. Test with ESP32 devices
5. Link Google Assistant
6. Test voice commands
7. Monitor logs and performance
