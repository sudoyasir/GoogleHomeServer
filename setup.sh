#!/bin/bash

# GoogleHomeServer - Quick Setup Script
# This script helps you set up the server for the first time

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  🏠 Google Smart Home Server - Setup Script"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18 or higher is required"
    echo "   Current version: $(node -v)"
    echo "   Please upgrade Node.js and try again"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env file and configure:"
    echo "   - THINGSBOARD_URL"
    echo "   - THINGSBOARD_ADMIN_USERNAME"
    echo "   - THINGSBOARD_ADMIN_PASSWORD"
    echo "   - OAUTH_CLIENT_ID (from Google Cloud)"
    echo "   - OAUTH_CLIENT_SECRET (from Google Cloud)"
    echo "   - JWT_SECRET (generate a strong random string)"
    echo ""
    read -p "Press Enter when you've configured .env..."
else
    echo "✅ .env file already exists"
fi

echo ""

# Generate JWT secret if needed
echo "Checking JWT_SECRET..."
if grep -q "JWT_SECRET=your_super_secret" .env; then
    echo "Generating secure JWT_SECRET..."
    JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    
    # Update .env file
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/JWT_SECRET=your_super_secret.*/JWT_SECRET=$JWT_SECRET/" .env
    else
        # Linux
        sed -i "s/JWT_SECRET=your_super_secret.*/JWT_SECRET=$JWT_SECRET/" .env
    fi
    
    echo "✅ JWT_SECRET generated and saved"
else
    echo "✅ JWT_SECRET already configured"
fi

echo ""

# Create directories
echo "Creating directories..."
mkdir -p data
mkdir -p logs

echo "✅ Directories created"
echo ""

# Initialize database
echo "Initializing database..."
npm run migrate

if [ $? -ne 0 ]; then
    echo "❌ Error: Database migration failed"
    exit 1
fi

echo "✅ Database initialized"
echo ""

# Summary
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Setup Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. Review configuration in .env file"
echo ""
echo "2. Start the server:"
echo "   npm run dev     # Development mode with auto-reload"
echo "   npm start       # Production mode"
echo ""
echo "3. Test the server:"
echo "   curl http://localhost:3000/health"
echo ""
echo "4. Create a user:"
echo "   curl -X POST http://localhost:3000/api/auth/register \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"username\":\"admin\",\"email\":\"admin@example.com\",\"password\":\"admin123\"}'"
echo ""
echo "5. Configure Google Cloud (see GOOGLE_SETUP.md)"
echo ""
echo "6. Deploy to production (see README.md deployment section)"
echo ""
echo "Documentation:"
echo "  - README.md - Complete documentation"
echo "  - ESP32_INTEGRATION.md - ESP32 integration guide"
echo "  - GOOGLE_SETUP.md - Google Cloud setup guide"
echo ""
echo "═══════════════════════════════════════════════════════════════"
