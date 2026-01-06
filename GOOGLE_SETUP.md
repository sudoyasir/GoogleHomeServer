# Google Cloud Platform Setup Guide

This guide walks you through setting up a Google Smart Home Action to integrate with your GoogleHomeServer.

## Prerequisites

- Google Cloud Platform account
- Domain with HTTPS (required for production)
- GoogleHomeServer deployed and running

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: "Smart Home Panel"
4. Click "Create"

## Step 2: Enable Required APIs

1. Go to "APIs & Services" → "Library"
2. Enable the following APIs:
   - **HomeGraph API** (required for device state reporting)
   - **Google Assistant API**

## Step 3: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure OAuth consent screen:
   - User Type: External
   - App name: "Smart Home Panel"
   - User support email: your email
   - Developer contact: your email
   - Scopes: Leave default
   - Test users: Add your Google account
   - Click "Save and Continue"

4. Back to "Create OAuth client ID":
   - Application type: **Web application**
   - Name: "Smart Home Panel OAuth"
   - Authorized redirect URIs:
     ```
     https://oauth-redirect.googleusercontent.com/r/YOUR_PROJECT_ID
     https://oauth-redirect.googleusercontent.com/r/YOUR_PROJECT_ID/callback
     ```
   - Click "Create"

5. **Save credentials**:
   - Client ID: Copy to `.env` as `OAUTH_CLIENT_ID`
   - Client Secret: Copy to `.env` as `OAUTH_CLIENT_SECRET`

## Step 4: Create Actions on Google Project

1. Go to [Actions Console](https://console.actions.google.com/)
2. Click "New project"
3. Select your Google Cloud project from dropdown
4. Click "Import project"

## Step 5: Configure Smart Home Action

### 1. Select Category

1. In Actions Console, click "Develop" tab
2. Choose "Smart Home"
3. Click "Start Building"

### 2. Configure Account Linking

1. Go to "Develop" → "Account linking"
2. Fill in:

```
Account creation: Yes, allow users to sign up for new accounts via voice
Linking type: OAuth → Authorization Code

Client Information:
  Client ID: <your OAUTH_CLIENT_ID>
  Client Secret: <your OAUTH_CLIENT_SECRET>
  Authorization URL: https://your-domain.com/oauth/authorize
  Token URL: https://your-domain.com/oauth/token

Configure your client:
  Scopes: (leave empty or add: smart_home)

Testing instructions: 
  "Use test account: test@example.com, password: test123"
```

3. Click "Save"

### 3. Configure Actions

1. Go to "Develop" → "Actions"
2. Add fulfillment URL:
   ```
   https://your-domain.com/smarthome/fulfillment
   ```
3. Click "Save"

## Step 6: Configure HomeGraph API

1. Go back to Google Cloud Console
2. Navigate to "APIs & Services" → "Credentials"
3. Click "Create Credentials" → "API key"
4. Copy API key to `.env` as `GOOGLE_API_KEY`
5. (Optional) Restrict API key to HomeGraph API

## Step 7: Test Account Linking

### Using Actions Console Simulator

1. Go to "Test" tab in Actions Console
2. Click "Start Testing"
3. In simulator, type: "Talk to Smart Home Panel"
4. Complete account linking flow
5. Authorize access

### Using Google Home App

1. Open Google Home app on phone
2. Tap "+" → "Set up device"
3. Tap "Works with Google"
4. Search for "Smart Home Panel" (or your test app name)
5. Complete account linking
6. Your devices should appear automatically

## Step 8: Request Production Access

Once testing is complete:

1. Go to Actions Console → "Deploy" → "Production"
2. Fill in all required information:
   - App information
   - Privacy policy URL
   - Terms of service URL
   - Brand verification
3. Submit for review
4. Wait for Google approval (usually 1-2 weeks)

## Environment Variables Summary

Update your `.env` file with all collected values:

```env
# OAuth 2.0
OAUTH_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
OAUTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
OAUTH_REDIRECT_URI=https://oauth-redirect.googleusercontent.com/r/YOUR_PROJECT_ID

# Google Smart Home
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_API_KEY=your-api-key
```

## Testing Voice Commands

After setup, try these commands:

```
"Hey Google, sync my devices"
"Hey Google, turn on living room light"
"Hey Google, set bedroom fan to speed 3"
"Hey Google, turn off all lights"
"Hey Google, what devices do I have?"
```

## Troubleshooting

### Account Linking Fails

1. Check OAuth URLs are correct and accessible via HTTPS
2. Verify client ID and secret match
3. Check server logs: `tail -f logs/combined.log`
4. Test OAuth flow manually with curl:
   ```bash
   curl "https://your-domain.com/oauth/authorize?client_id=...&redirect_uri=...&state=test&response_type=code"
   ```

### Devices Not Syncing

1. Check fulfillment URL is accessible
2. Verify device provisioning: `GET /api/device/list`
3. Check ThingsBoard devices exist
4. Review fulfillment logs in Actions Console
5. Manually trigger sync: "Hey Google, sync my devices"

### RPC Commands Not Working

1. Check ThingsBoard connectivity
2. Verify MQTT connection from ESP32
3. Check device telemetry is being sent
4. Review server logs for RPC errors
5. Test RPC directly via ThingsBoard UI

## Local Testing with ngrok

For development without deploying:

1. Install ngrok: `npm install -g ngrok`
2. Start server locally: `npm run dev`
3. Start ngrok: `ngrok http 3000`
4. Use ngrok HTTPS URL in Actions Console
5. Update `.env` with ngrok URL temporarily

```bash
# Terminal 1
npm run dev

# Terminal 2
ngrok http 3000

# Use the https URL from ngrok in Actions Console
```

## Production Deployment Checklist

- [ ] Server deployed with HTTPS
- [ ] SSL certificate valid
- [ ] Environment variables configured
- [ ] Database backed up
- [ ] Logs rotation configured
- [ ] Rate limiting enabled
- [ ] OAuth credentials from production domain
- [ ] Actions Console configured with production URLs
- [ ] Test account linking works
- [ ] Test voice commands work
- [ ] Error monitoring setup
- [ ] Submit for Google review

## Useful Links

- [Actions Console](https://console.actions.google.com/)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Smart Home Documentation](https://developers.google.com/assistant/smarthome)
- [OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [HomeGraph API](https://developers.google.com/assistant/smarthome/develop/request-sync)

## Support

If you encounter issues:

1. Check Actions Console → Test → Logs
2. Check server logs in `logs/combined.log`
3. Enable debug logging: `LOG_LEVEL=debug`
4. Test with Google's OAuth Playground
5. Review Google Smart Home troubleshooting guide

## Next Steps

After successful setup:

1. Test all device types
2. Test all voice commands
3. Monitor logs for errors
4. Optimize response times
5. Add more device types
6. Implement HomeGraph reporting (state push)
7. Add scene support
8. Add routine support
