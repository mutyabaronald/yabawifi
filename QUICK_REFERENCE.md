# 🚀 WiFi Device Onboarding - Quick Reference

**Essential commands and information for daily operations**

---

## 🖥️ Server Management

### PM2 Commands
```bash
# View status
pm2 status

# View logs
pm2 logs wifi-backend

# Restart application
pm2 restart wifi-backend

# Monitor processes
pm2 monit

# Stop all
pm2 stop all

# Start all
pm2 start all
```

### System Commands
```bash
# Check nginx status
systemctl status nginx

# Restart nginx
sudo systemctl restart nginx

# Check system resources
htop
df -h
free -h

# Check network
netstat -tulpn
```

---

## 🔧 Environment Variables

### Critical Variables (Check these first!)
```bash
# Must be HTTPS in production
APP_PUBLIC_URL=https://yourdomain.com

# Generate with: openssl rand -hex 32
CALLBACK_SECRET=your_64_char_secret
JWT_SECRET=your_64_char_secret

# Never use defaults in production!
```

---

## 📊 Health Checks

### API Endpoints
```bash
# Health check
curl https://yourdomain.com/health

# Device status
curl https://yourdomain.com/api/devices/status/DEVICE_ID

# List devices
curl https://yourdomain.com/api/devices/owner/OWNER_ID
```

### Database Check
```bash
# Test Firebase connection
node -e "
const admin = require('firebase-admin');
admin.initializeApp();
admin.firestore().collection('devices').limit(1).get()
  .then(() => console.log('✅ DB OK'))
  .catch(err => console.error('❌ DB Error:', err));
"
```

---

## 🚨 Emergency Procedures

### System Down
```bash
# 1. Quick restart
pm2 restart all

# 2. Check logs
pm2 logs

# 3. Verify services
systemctl status nginx
systemctl status pm2-wifiapp
```

### Database Issues
```bash
# 1. Check Firebase status
# https://status.firebase.google.com/

# 2. Verify credentials
gcloud auth list

# 3. Test connection (see above)
```

### Security Breach
```bash
# 1. Stop services
pm2 stop all
systemctl stop nginx

# 2. Rotate secrets in .env
# 3. Regenerate device tokens
# 4. Restart services
```

---

## 📝 Daily Checklist

- [ ] Check PM2 status: `pm2 status`
- [ ] Review error logs: `pm2 logs wifi-backend`
- [ ] Monitor system resources: `htop`
- [ ] Verify nginx is running: `systemctl status nginx`
- [ ] Check health endpoint: `curl /health`

---

## 📝 Weekly Checklist

- [ ] Review device connection logs
- [ ] Check database performance
- [ ] Update security patches: `sudo apt update && sudo apt upgrade`
- [ ] Verify backup completion
- [ ] Check SSL certificate expiry: `certbot certificates`

---

## 🔍 Troubleshooting

### Device Not Connecting
1. Check backend logs: `pm2 logs wifi-backend`
2. Verify `APP_PUBLIC_URL` is correct
3. Check device has internet access
4. Verify callback secret matches

### MikroTik Script Errors
1. Check interface names exist
2. Verify no conflicting configurations
3. Check RouterOS version compatibility

### API Errors
1. Check database connection
2. Verify environment variables
3. Check rate limiting
4. Review error logs

---

## 📚 Common URLs

- **Frontend**: `https://yourdomain.com`
- **Devices Page**: `https://yourdomain.com/devices`
- **Health Check**: `https://yourdomain.com/health`
- **API Base**: `https://yourdomain.com/api`
- **Provisioning**: `https://yourdomain.com/provisioning`

---

## 🗄️ Database Queries

### Firestore Commands
```javascript
// Get all devices for owner
db.collection("devices")
  .where("ownerId", "==", "OWNER_ID")
  .orderBy("createdAt", "desc")
  .get()

// Get device by ID
db.collection("devices").doc("DEVICE_ID").get()

// Update device status
db.collection("devices").doc("DEVICE_ID").update({
  status: "online",
  lastSeen: admin.firestore.FieldValue.serverTimestamp()
})
```

---

## 📞 Support Contacts

- **System Admin**: [Contact Info]
- **Firebase Support**: https://firebase.google.com/support
- **Emergency**: [Phone Number]

---

## 🚀 Quick Start Commands

```bash
# Start application
pm2 start backend/server.js --name "wifi-backend"

# View logs
pm2 logs wifi-backend

# Monitor
pm2 monit

# Restart
pm2 restart wifi-backend

# Stop
pm2 stop wifi-backend
```

---

**💡 Keep this reference card handy for quick access to essential commands and procedures!**
