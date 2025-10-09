# WiFi Device Onboarding System

This system allows WiFi owners to easily onboard and manage their MikroTik routers (and other devices) through a simple 3-step wizard.

## 🚀 Features

- **3-Step Device Onboarding Wizard**
  - Step 1: Device Information (name, type, service, interfaces)
  - Step 2: Provisioning Script (copy-paste into device)
  - Step 3: Connection Status (real-time monitoring)

- **Device Management**
  - View all connected devices
  - Monitor device status (online/offline)
  - Edit device configurations
  - Unlink devices

- **Multi-Device Support**
  - MikroTik (primary support)
  - TP-Link (placeholder)
  - Ubiquiti (placeholder)
  - Other devices (manual setup)

## 🛠️ Backend Setup

### 1. Install Dependencies

The system uses existing dependencies from your project:
- `express` - Web framework
- `firebase-admin` - Firebase integration
- `crypto` - Token generation
- `uuid` - Device ID generation

### 2. Environment Variables

Create a `.env` file in the backend directory:

```bash
# Copy from env.example
cp backend/env.example backend/.env
```

Required variables:
- `APP_PUBLIC_URL` - Public URL reachable by routers
- `CALLBACK_SECRET` - Secret for device callbacks

### 3. Routes Integration

The device routes are automatically integrated into your `server.js`:

```javascript
// Already added to server.js
app.use("/", devicesRoutes);
```

## 🔌 API Endpoints

### Device Management
- `POST /api/devices` - Create new device
- `GET /api/devices/owner/:ownerId` - Get owner's devices
- `PUT /api/devices/:id` - Update device
- `DELETE /api/devices/:id` - Unlink device

### Provisioning
- `GET /api/provisioning/script?deviceId=xxx` - Get copy-paste script
- `GET /provisioning/bootstrap?rId=xxx&token=xxx` - Bootstrap script for router

### Status & Callbacks
- `GET /api/devices/status/:id` - Check device status
- `GET /api/devices/connected` - Router callback endpoint

## 🎯 Frontend Integration

### 1. New Components Created

- `frontend/owner/Devices.jsx` - Main devices page
- `frontend/owner/AddDeviceWizard.jsx` - 3-step onboarding wizard
- `frontend/owner/OwnerNav.jsx` - Navigation sidebar

### 2. Routes Added

```javascript
// Added to main.jsx
<Route path="/devices" element={<Devices />} />

<Route path="/owner/profile" element={<OwnerProfile />} />
<Route path="/owner/packages" element={<OwnerPackages />} />
<Route path="/owner/notifications" element={<OwnerNotifications />} />
<Route path="/owner/admins" element={<OwnerAdmins />} />
```

### 3. Navigation

The system includes a sidebar navigation for owners with:
- Dashboard
- Devices (new!)
- Packages
- Profile
- Notifications
- Admins

## 📱 How It Works

### For WiFi Owners:

1. **Navigate to Devices**
   - Click "Devices" in the sidebar
   - Click "Add New Device"

2. **Step 1: Device Info**
   - Enter device name
   - Select device type (MikroTik, TP-Link, etc.)
   - Choose service type (Hotspot or PPPoE)
   - Select network interfaces

3. **Step 2: Provisioning Script**
   - Copy the generated script
   - Paste into your device terminal
   - Wait for configuration to complete

4. **Step 3: Connection Status**
   - System automatically checks connection
   - Shows success/failure status
   - Device appears in your devices list

### For Developers:

1. **Device Creation Flow**
   ```
   Frontend → POST /api/devices → Firestore → Response with deviceId
   ```

2. **Script Generation Flow**
   ```
   Frontend → GET /api/provisioning/script → MikroTik script
   ```

3. **Bootstrap Flow**
   ```
   MikroTik → GET /provisioning/bootstrap → Configuration script
   MikroTik → GET /api/devices/connected → Status update
   ```

4. **Status Monitoring Flow**
   ```
   Frontend → GET /api/devices/status/:id → Real-time status
   ```

## 🔧 MikroTik Integration

### Bootstrap Script Features

The system generates MikroTik scripts that:

1. **Enable API Service**
   - Opens API access for management
   - Creates billing API user

2. **Configure Hotspot/PPPoE**
   - Sets up network interfaces
   - Configures DHCP pools
   - Enables hotspot or PPPoE server

3. **Callback Integration**
   - Reports back to your server
   - Updates device status automatically

### Example Generated Script

```bash
/tool fetch url="http://localhost:5000/provisioning/bootstrap?rId=DEVICE123&token=ABC456" dst-path=bootstrap.rsc
/delay 2
/import file-name=bootstrap.rsc
```

## 🚨 Security Considerations

1. **Token-Based Authentication**
   - Each device gets a unique token
   - Tokens are validated on callbacks

2. **Secret Validation**
   - Callback endpoint validates shared secret
   - Prevents unauthorized status updates

3. **Interface Restrictions**
   - Only specified interfaces are configured
   - Safe defaults for network configuration

## 🧪 Testing

### Local Development

1. Start backend: `cd backend && npm start`
2. Start frontend: `cd frontend && npm run dev`
3. Navigate to `/devices` to test the system

### Device Testing

1. Use a MikroTik device or emulator
2. Follow the onboarding wizard
3. Check device status updates

## 🔮 Future Enhancements

### Planned Features

1. **Real MikroTik API Integration**
   - Live device monitoring
   - Active user counts
   - Uptime statistics

2. **Advanced Device Types**
   - TP-Link configuration
   - Ubiquiti setup
   - Generic device templates

3. **Network Management**
   - Bandwidth monitoring
   - User session management
   - Traffic analytics

4. **Automated Troubleshooting**
   - Connection diagnostics
   - Configuration validation
   - Error resolution guides

## 📞 Support

For issues or questions:

1. Check the browser console for errors
2. Verify environment variables are set
3. Ensure Firebase credentials are correct
4. Check device network connectivity

## 🎉 Getting Started

1. **Backend**: Ensure `.env` file is configured
2. **Frontend**: Navigate to `/devices` page
3. **Device**: Have a MikroTik router ready
4. **Network**: Ensure backend is reachable by device

The system is designed to be plug-and-play - WiFi owners just copy-paste a script once, and the dashboard manages everything afterward!
