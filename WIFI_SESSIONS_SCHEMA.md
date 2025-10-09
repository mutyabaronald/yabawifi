# WiFi Sessions Database Schema

## Overview
The WiFi Sessions system tracks user connections to WiFi hotspots, preventing double billing and enabling seamless reconnection when users return to the same hotspot.

## Database Collection: `wifi_sessions`

### Document Structure
```javascript
{
  // User identification
  userPhone: "256771234567",           // User's phone number
  hotspotId: "hotspot_123",            // Hotspot ID (optional)
  hotspotName: "Coffee Shop WiFi",     // Human-readable hotspot name
  
  // Package information
  packageId: "package_456",            // Package ID from packages collection
  packageName: "Daily Unlimited",      // Package name
  
  // Payment information
  paymentMethod: "Mobile Money",       // "Mobile Money", "voucher", "loyalty_points"
  paymentReference: "receipt_789",     // Reference to payment receipt
  
  // Session timing
  startTime: "2024-01-15T10:00:00Z",  // When session started
  expiresAt: "2024-01-16T10:00:00Z",  // When session expires
  lastConnected: "2024-01-15T15:30:00Z", // Last connection time
  
  // Session status
  status: "active",                    // "active", "connected", "disconnected", "expired"
  dataUsed: 52428800,                 // Data used in bytes
  
  // Metadata
  createdAt: "2024-01-15T10:00:00Z",  // Document creation time
  updatedAt: "2024-01-15T15:30:00Z",  // Last update time
  disconnectedAt: null                 // When session was disconnected (if applicable)
}
```

## Session Status Flow

### 1. Session Creation
- **Trigger**: Successful payment (mobile money, voucher, loyalty points)
- **Status**: `"active"`
- **Action**: Creates new session document

### 2. Session Connection
- **Trigger**: User connects to WiFi
- **Status**: `"connected"`
- **Action**: Updates `lastConnected` timestamp

### 3. Session Disconnection
- **Trigger**: User disconnects from WiFi
- **Status**: `"disconnected"`
- **Action**: Updates `disconnectedAt` timestamp

### 4. Session Expiration
- **Trigger**: Time limit reached or data limit exceeded
- **Status**: `"expired"`
- **Action**: Automatic status update

### 5. Session Resumption
- **Trigger**: User reconnects to same hotspot
- **Status**: `"connected"`
- **Action**: Resumes existing session (no new billing)

## API Endpoints

### Check Session Status
```
GET /api/users/:phone/session-status/:hotspotId
```
**Response**: 
```javascript
{
  hasActiveSession: true,
  session: {
    id: "session_123",
    packageName: "Daily Unlimited",
    timeRemaining: 120,        // minutes
    dataRemaining: 500,        // MB
    startTime: "2024-01-15T10:00:00Z",
    expiresAt: "2024-01-16T10:00:00Z"
  }
}
```

### Create/Resume Session
```
POST /api/users/:phone/sessions
```
**Body**:
```javascript
{
  hotspotId: "hotspot_123",
  hotspotName: "Coffee Shop WiFi",
  packageId: "package_456",
  packageName: "Daily Unlimited",
  paymentMethod: "Mobile Money",
  paymentReference: "receipt_789"
}
```

### Update Data Usage
```
PUT /api/users/:phone/sessions/:sessionId/usage
```
**Body**:
```javascript
{
  dataUsed: 104857600  // bytes
}
```

### Disconnect Session
```
PUT /api/users/:phone/sessions/:sessionId/disconnect
```

## Business Logic

### Double Billing Prevention
1. **Session Check**: Before allowing purchase, check for existing active session
2. **Session Resumption**: If session exists and is valid, resume instead of creating new
3. **Status Validation**: Automatically expire sessions that exceed time/data limits

### WiFi Range Validation
1. **Distance Check**: Only allow connections within 500m of hotspot
2. **Range Warning**: Show clear message when user is out of range
3. **Smart UI**: Different UI states for in-range vs out-of-range hotspots

### Automatic Session Management
1. **Background Monitoring**: Check session status every 30 seconds
2. **Status Updates**: Real-time updates to connection status
3. **Expiration Handling**: Automatic cleanup of expired sessions

## Integration Points

### Payment Systems
- **Mobile Money**: Creates session on successful payment
- **Vouchers**: Creates session on voucher redemption
- **Loyalty Points**: Creates session on points redemption

### Frontend Components
- **HotspotsMap**: Shows session status and prevents double billing
- **UserDashboard**: Displays current session information
- **Packages**: Integrates with session management

### Router Integration
- **Captive Portal**: Can check session status before allowing access
- **Data Tracking**: Updates session data usage in real-time
- **Connection Management**: Handles connect/disconnect events

## Benefits

1. **No Double Billing**: Users can't accidentally purchase multiple packages
2. **Seamless Reconnection**: Automatic session resumption when returning
3. **Real-time Status**: Live updates of connection status and remaining time/data
4. **Smart Validation**: WiFi range checking prevents invalid purchases
5. **Session History**: Complete tracking of all WiFi usage
6. **Loyalty Integration**: Points awarded automatically with purchases

## Security Features

1. **User Isolation**: Users can only access their own sessions
2. **Status Validation**: Server-side validation of session status
3. **Payment Verification**: Sessions only created after payment confirmation
4. **Range Enforcement**: Server-side distance validation
5. **Session Expiration**: Automatic cleanup of expired sessions

## Monitoring and Analytics

1. **Session Metrics**: Track connection duration, data usage, reconnection rates
2. **User Behavior**: Understand how users interact with WiFi hotspots
3. **Revenue Protection**: Prevent revenue loss from double billing
4. **Performance Metrics**: Monitor session creation and management performance
