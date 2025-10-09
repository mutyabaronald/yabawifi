# 🚀 WiFi Device Onboarding - Production Guide

**This guide contains everything you need to know for production deployment and ongoing maintenance.**

---

## 📋 Table of Contents

1. [Pre-Production Checklist](#pre-production-checklist)
2. [Environment Configuration](#environment-configuration)
3. [Security Hardening](#security-hardening)
4. [Deployment Steps](#deployment-steps)
5. [Monitoring & Maintenance](#monitoring--maintenance)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [API Reference](#api-reference)
8. [Database Schema](#database-schema)
9. [Performance Optimization](#performance-optimization)
10. [Backup & Recovery](#backup--recovery)

---

## ✅ Pre-Production Checklist

### Backend Requirements
- [ ] Node.js 16+ installed
- [ ] Firebase Admin SDK configured
- [ ] Environment variables set
- [ ] SSL certificate installed
- [ ] Firewall rules configured
- [ ] Database backups enabled

### Frontend Requirements
- [ ] React build optimized
- [ ] CDN configured (optional)
- [ ] Error tracking enabled
- [ ] Analytics configured
- [ ] Performance monitoring

### Network Requirements
- [ ] Public IP address
- [ ] Domain name configured
- [ ] DNS records updated
- [ ] Port 443 (HTTPS) open
- [ ] Load balancer configured (if needed)

---

## 🔧 Environment Configuration

### Production .env File

```bash
# Production Environment Variables
NODE_ENV=production
PORT=443

# Public URL (MUST be HTTPS in production)
APP_PUBLIC_URL=https://yourdomain.com

# Security (CHANGE THESE!)
CALLBACK_SECRET=your_super_secure_random_secret_here
JWT_SECRET=another_super_secure_random_secret

# Firebase Configuration
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Database
DB_CONNECTION_LIMIT=20
DB_ACQUIRE_TIMEOUT=60000

# Rate Limiting
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/wifi-onboarding/app.log
```

### Critical Security Variables

```bash
# Generate these using: openssl rand -hex 32
CALLBACK_SECRET=your_64_character_random_string
JWT_SECRET=your_64_character_random_string

# Never use defaults in production!
# Default values are for development only
```

---

## 🛡️ Security Hardening

### 1. API Security

```javascript
// Add to your server.js
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use(limiter);
app.use(helmet()); // Security headers
```

### 2. Device Token Security

```javascript
// In devices.js - enhance token generation
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 characters
}

// Add token expiration
const tokenExpiry = new Date();
tokenExpiry.setHours(tokenExpiry.getHours() + 24); // 24 hour expiry

// Store in device document
tokenExpiry: tokenExpiry
```

### 3. Callback Validation

```javascript
// Enhanced callback validation
router.get("/api/devices/connected", async (req, res) => {
  try {
    const { rId, secret, status, ip } = req.query;
    
    // Validate secret
    if (secret !== CALLBACK_SECRET) {
      console.warn(`Invalid callback attempt from IP: ${req.ip}`);
      return res.status(403).send("Forbidden");
    }
    
    // Validate device exists and token hasn't expired
    const device = await db.collection("devices").doc(rId).get();
    if (!device.exists) {
      return res.status(404).send("Device not found");
    }
    
    const deviceData = device.data();
    if (deviceData.tokenExpiry && new Date() > deviceData.tokenExpiry.toDate()) {
      return res.status(403).send("Token expired");
    }
    
    // Update device status
    await device.ref.update({
      status: status === "online" ? "online" : "offline",
      wanIp: ip || null,
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    return res.json({ success: true });
  } catch (err) {
    console.error("Device connected callback error:", err);
    res.status(500).json({ success: false });
  }
});
```

---

## 🚀 Deployment Steps

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Create application user
sudo useradd -m -s /bin/bash wifiapp
sudo usermod -aG sudo wifiapp
```

### 2. Application Deployment

```bash
# Clone/update your repository
cd /home/wifiapp
git clone https://github.com/yourusername/wifi-automation.git
cd wifi-automation

# Install dependencies
npm install --production

# Set up environment
cp backend/env.example backend/.env
# Edit .env with production values

# Build frontend
cd frontend
npm run build
cd ..

# Start with PM2
pm2 start backend/server.js --name "wifi-backend"
pm2 startup
pm2 save
```

### 3. Nginx Configuration

```nginx
# /etc/nginx/sites-available/wifi-onboarding
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Frontend
    location / {
        root /home/wifiapp/wifi-automation/frontend/dist;
        try_files $uri $uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # Backend API
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Device provisioning endpoints
    location /provisioning/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4. SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

---

## 📊 Monitoring & Maintenance

### 1. PM2 Monitoring

```bash
# View logs
pm2 logs wifi-backend

# Monitor processes
pm2 monit

# Restart application
pm2 restart wifi-backend

# View status
pm2 status
```

### 2. Log Management

```javascript
// Enhanced logging in devices.js
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'device-onboarding' },
  transports: [
    new winston.transports.File({ filename: '/var/log/wifi-onboarding/error.log', level: 'error' }),
    new winston.transports.File({ filename: '/var/log/wifi-onboarding/combined.log' })
  ]
});

// Use in your routes
logger.info('Device created', { deviceId, ownerId, serviceType });
logger.error('Device creation failed', { error: err.message, stack: err.stack });
```

### 3. Health Check Endpoint

```javascript
// Add to devices.js
router.get("/health", async (req, res) => {
  try {
    // Check database connection
    const dbCheck = await db.collection("devices").limit(1).get();
    
    // Check system resources
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
        total: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB"
      },
      uptime: Math.round(uptime) + "s",
      version: process.env.npm_package_version || "1.0.0"
    });
  } catch (err) {
    res.status(500).json({
      status: "unhealthy",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});
```

---

## 🔍 Troubleshooting Guide

### Common Issues & Solutions

#### 1. Device Not Connecting

**Symptoms:**
- Device shows "pending" status
- No callback received
- Script execution fails

**Diagnosis:**
```bash
# Check backend logs
pm2 logs wifi-backend

# Check device in database
# Verify token hasn't expired
# Check network connectivity
```

**Solutions:**
- Verify `APP_PUBLIC_URL` is correct
- Check firewall allows outbound HTTPS
- Ensure device has internet access
- Verify callback secret matches

#### 2. MikroTik Script Errors

**Common Errors:**
```
Error: interface not found
Error: address already exists
Error: pool already exists
```

**Solutions:**
```bash
# Add error handling to bootstrap script
:if ([/interface find name=${iface}] = "") do={
  :put "Interface ${iface} not found, using ether2"
  :set iface "ether2"
}

# Check for existing configurations
:if ([/ip address find interface=${iface}] = "") do={
  /ip address add address=10.10.10.1/24 interface=${iface} comment="YABA Hotspot"
}
```

#### 3. Database Connection Issues

**Symptoms:**
- API calls fail
- Device creation errors
- Timeout errors

**Solutions:**
```javascript
// Add connection retry logic
const connectWithRetry = async () => {
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await db.collection("devices").limit(1).get();
      console.log("Database connected successfully");
      break;
    } catch (err) {
      console.log(`Database connection attempt ${i + 1} failed:`, err.message);
      if (i === maxRetries - 1) {
        console.error("Max retries reached, exiting");
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};
```

---

## 📚 API Reference

### Device Management Endpoints

#### Create Device
```http
POST /api/devices
Content-Type: application/json

{
  "ownerId": "string",
  "deviceName": "string",
  "deviceType": "mikrotik|tp-link|ubiquiti|other",
  "serviceType": "hotspot|pppoe",
  "interfaces": ["string"]
}

Response:
{
  "success": true,
  "device": {...},
  "provisioningScriptUrl": "string"
}
```

#### Get Owner Devices
```http
GET /api/devices/owner/:ownerId

Response:
{
  "success": true,
  "devices": [...]
}
```

#### Update Device
```http
PUT /api/devices/:id
Content-Type: application/json

{
  "deviceName": "string",
  "interfaces": ["string"]
}
```

#### Delete Device
```http
DELETE /api/devices/:id

Response:
{
  "success": true,
  "message": "Device unlinked successfully"
}
```

### Provisioning Endpoints

#### Get Provisioning Script
```http
GET /api/provisioning/script?deviceId=string

Response: Plain text MikroTik script
```

#### Bootstrap Script
```http
GET /provisioning/bootstrap?rId=string&token=string

Response: Plain text configuration script
```

### Status Endpoints

#### Device Status
```http
GET /api/devices/status/:id

Response:
{
  "success": true,
  "status": "online|offline|pending|unknown",
  "device": {...}
}
```

#### Health Check
```http
GET /health

Response:
{
  "status": "healthy|unhealthy",
  "timestamp": "ISO string",
  "database": "connected|disconnected",
  "memory": {...},
  "uptime": "number",
  "version": "string"
}
```

---

## 🗄️ Database Schema

### Devices Collection

```javascript
{
  "deviceId": "uuid-string",
  "ownerId": "string",
  "deviceName": "string",
  "deviceType": "mikrotik|tp-link|ubiquiti|other",
  "serviceType": "hotspot|pppoe",
  "interfaces": ["string"],
  "status": "pending|online|offline|unknown",
  "token": "hex-string",
  "tokenExpiry": "timestamp",
  "wanIp": "string|null",
  "lastSeen": "timestamp",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  
  // Optional fields for future use
  "location": {
    "lat": "number",
    "lng": "number",
    "address": "string"
  },
  "metadata": {
    "model": "string",
    "firmware": "string",
    "serialNumber": "string"
  },
  "performance": {
    "uptime": "number",
    "activeUsers": "number",
    "bandwidth": "number"
  }
}
```

### Indexes (Create these in Firestore)

```javascript
// Required indexes for performance
db.collection("devices").createIndex({
  "ownerId": 1,
  "createdAt": -1
});

db.collection("devices").createIndex({
  "status": 1,
  "updatedAt": -1
});

db.collection("devices").createIndex({
  "token": 1
});
```

---

## ⚡ Performance Optimization

### 1. Database Optimization

```javascript
// Batch operations for multiple devices
const batch = db.batch();
devices.forEach(device => {
  const docRef = db.collection("devices").doc(device.id);
  batch.update(docRef, { status: "offline" });
});
await batch.commit();

// Use pagination for large datasets
const getDevicesPaginated = async (ownerId, limit = 20, startAfter = null) => {
  let query = db.collection("devices")
    .where("ownerId", "==", ownerId)
    .orderBy("createdAt", "desc")
    .limit(limit);
    
  if (startAfter) {
    query = query.startAfter(startAfter);
  }
  
  return await query.get();
};
```

### 2. Caching Strategy

```javascript
// Add Redis caching for frequently accessed data
const redis = require('redis');
const client = redis.createClient();

const getCachedDevice = async (deviceId) => {
  const cached = await client.get(`device:${deviceId}`);
  if (cached) {
    return JSON.parse(cached);
  }
  
  const device = await db.collection("devices").doc(deviceId).get();
  if (device.exists) {
    const data = device.data();
    await client.setex(`device:${deviceId}`, 300, JSON.stringify(data)); // 5 min cache
    return data;
  }
  return null;
};
```

### 3. API Response Optimization

```javascript
// Selective field projection
const getDeviceSummary = async (deviceId) => {
  const doc = await db.collection("devices").doc(deviceId).get();
  if (!doc.exists) return null;
  
  const data = doc.data();
  // Only return essential fields
  return {
    deviceId: data.deviceId,
    deviceName: data.deviceName,
    status: data.status,
    serviceType: data.serviceType,
    lastSeen: data.lastSeen
  };
};
```

---

## 💾 Backup & Recovery

### 1. Database Backup

```bash
# Firestore backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/firestore"

# Create backup directory
mkdir -p $BACKUP_DIR

# Export devices collection
gcloud firestore export gs://your-bucket/backups/$DATE \
  --collection-ids=devices \
  --project=your-project-id

echo "Backup completed: $DATE"
```

### 2. Application Backup

```bash
# Backup application files
tar -czf /backups/app/app_$DATE.tar.gz \
  /home/wifiapp/wifi-automation \
  /etc/nginx/sites-available/wifi-onboarding \
  /home/wifiapp/.env

# Backup PM2 configuration
pm2 save
cp ~/.pm2/dump.pm2 /backups/pm2/pm2_$DATE.pm2
```

### 3. Recovery Procedures

```bash
# Database recovery
gcloud firestore import gs://your-bucket/backups/$DATE \
  --project=your-project-id

# Application recovery
cd /home/wifiapp
tar -xzf /backups/app/app_$DATE.tar.gz

# Restore PM2
pm2 resurrect /backups/pm2/pm2_$DATE.pm2
```

---

## 🚨 Emergency Procedures

### 1. System Down

```bash
# Quick restart
pm2 restart all

# Check logs
pm2 logs

# Verify services
systemctl status nginx
systemctl status pm2-wifiapp
```

### 2. Database Issues

```bash
# Check Firebase status
# https://status.firebase.google.com/

# Verify credentials
gcloud auth list
gcloud config list

# Test connection
node -e "
const admin = require('firebase-admin');
admin.initializeApp();
admin.firestore().collection('test').limit(1).get()
  .then(() => console.log('DB OK'))
  .catch(err => console.error('DB Error:', err));
"
```

### 3. Security Breach

```bash
# Immediate actions
pm2 stop all
systemctl stop nginx

# Rotate secrets
# Update .env file
# Regenerate all device tokens

# Restart services
systemctl start nginx
pm2 start all
```

---

## 📞 Support Contacts

### Internal Team
- **System Administrator**: [Contact Info]
- **Database Administrator**: [Contact Info]
- **Network Engineer**: [Contact Info]

### External Services
- **Firebase Support**: https://firebase.google.com/support
- **Domain Provider**: [Contact Info]
- **SSL Certificate**: Let's Encrypt Community

### Monitoring Tools
- **PM2 Monitoring**: `pm2 monit`
- **Nginx Status**: `systemctl status nginx`
- **System Resources**: `htop`, `iotop`
- **Network**: `netstat -tulpn`

---

## 📝 Maintenance Schedule

### Daily
- [ ] Check PM2 status
- [ ] Review error logs
- [ ] Monitor system resources

### Weekly
- [ ] Review device connection logs
- [ ] Check database performance
- [ ] Update security patches
- [ ] Verify backup completion

### Monthly
- [ ] Performance review
- [ ] Security audit
- [ ] Update dependencies
- [ ] Capacity planning

### Quarterly
- [ ] Full system backup
- [ ] Disaster recovery test
- [ ] Security penetration test
- [ ] Performance optimization review

---

## 🎯 Success Metrics

### Key Performance Indicators (KPIs)

1. **Device Onboarding Success Rate**
   - Target: >95%
   - Measurement: Successful connections / Total attempts

2. **System Uptime**
   - Target: >99.9%
   - Measurement: Available time / Total time

3. **API Response Time**
   - Target: <200ms (95th percentile)
   - Measurement: Response time distribution

4. **Device Connection Stability**
   - Target: >98% devices stay connected
   - Measurement: Devices online / Total devices

### Monitoring Alerts

```javascript
// Example alert thresholds
const ALERTS = {
  deviceOnboardingSuccess: 0.95, // 95%
  systemUptime: 0.999, // 99.9%
  apiResponseTime: 200, // 200ms
  deviceConnectionRate: 0.98 // 98%
};

// Alert when thresholds are exceeded
if (currentMetric < ALERTS[metricName]) {
  sendAlert(`ALERT: ${metricName} below threshold`);
}
```

---

## 🔮 Future Enhancements

### Phase 2 Features
1. **Real-time Device Monitoring**
   - WebSocket connections
   - Live status updates
   - Performance metrics

2. **Advanced Device Types**
   - TP-Link configuration
   - Ubiquiti setup
   - Generic device templates

3. **Network Analytics**
   - Bandwidth monitoring
   - User session tracking
   - Traffic analysis

4. **Automated Troubleshooting**
   - Connection diagnostics
   - Configuration validation
   - Self-healing systems

### Technical Debt
1. **Code Refactoring**
   - Separate business logic
   - Improve error handling
   - Add comprehensive tests

2. **Infrastructure**
   - Containerization (Docker)
   - CI/CD pipeline
   - Auto-scaling

---

**📋 This guide should be reviewed and updated regularly as your system evolves. Keep it accessible to your team and update it with any new procedures or lessons learned.**

**🚀 Good luck with your production deployment!**
