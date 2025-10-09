# Hotspot-Specific Loyalty System

## Overview
The new loyalty system ensures that **loyalty points are tied to specific WiFi hotspots**, preventing users from cheating by using points earned at one location to get free access at another. Each WiFi owner can configure their own loyalty rates, and points are tracked per hotspot per user.

**Important**: Loyalty points are **ONLY awarded to users who login with their phone number and purchase packages online**. Offline voucher redemptions do not earn loyalty points since they cannot be tracked.

## Key Features

### 🔒 **Hotspot Isolation**
- **Points are NOT transferable** between different WiFi hotspots
- **Each hotspot has its own loyalty balance** for each user
- **Users can only use points** at the hotspot where they earned them
- **No cross-hotspot point sharing** or cheating possible

### ⚙️ **Owner-Configurable Loyalty Rates**
- **Per-package points**: Set specific points for each package type
- **Per-amount points**: Set points per 1000 UGX spent
- **Flexible configuration**: Mix and match both approaches
- **Owner control**: Each WiFi owner sets their own rates

### 📍 **Location-Based Tracking**
- **Points tied to hotspot ID**: Not just phone number
- **SSID-based isolation**: Even if same network, different hotspots = different points
- **Geographic separation**: Physical location determines point isolation

### 📱 **Online-Only Loyalty**
- **Phone login required**: Users must login with their phone number
- **Online purchases only**: Only mobile money payments earn loyalty points
- **No voucher points**: Offline paper vouchers cannot earn loyalty points
- **Trackable transactions**: All loyalty-earning activities are logged and auditable

## Database Schema

### Collection: `hotspot_loyalty`
```javascript
{
  // Document ID: `${userPhone}_${hotspotId}`
  userPhone: "256771234567",
  hotspotId: "hotspot_123",
  points: 150,                    // Current balance
  totalEarned: 300,              // Total points earned at this hotspot
  totalRedeemed: 150,            // Total points used at this hotspot
  lastEarned: "2024-01-15T10:00:00Z",
  lastRedeemed: "2024-01-15T15:30:00Z",
  createdAt: "2024-01-15T10:00:00Z",
  updatedAt: "2024-01-15T15:30:00Z"
}
```

### Collection: `packages` (Updated)
```javascript
{
  // ... existing fields ...
  loyaltyPointsPerPackage: 50,    // Points awarded per package purchase
  loyaltyPointsPer1000UGX: 10,    // Points per 1000 UGX spent
  loyaltyEnabled: true            // Whether loyalty is enabled for this package
}
```

### Collection: `hotspot_loyalty_transactions`
```javascript
{
  userPhone: "256771234567",
  hotspotId: "hotspot_123",
  type: "earned",                 // "earned" or "redeemed"
  points: 50,                     // Points amount (positive for earned, negative for redeemed)
  reason: "WiFi package purchase: Daily Unlimited",
  packageName: "Daily Unlimited",
  packagePrice: 5000,
  timestamp: "2024-01-15T10:00:00Z"
}
```

## How It Works

### 1. **Package Configuration (WiFi Owner)**
```javascript
// WiFi owner sets loyalty rates for their packages
{
  name: "Daily Unlimited",
  price: 5000,
  loyaltyPointsPerPackage: 50,    // 50 points per purchase
  loyaltyPointsPer1000UGX: 10,    // 10 points per 1000 UGX
  loyaltyEnabled: true
}
```

### 2. **Point Awarding (Online Users Only)**
```javascript
// When user logs in with phone and buys package for 5000 UGX:
// - Package points: 50
// - Amount points: Math.floor(5000/1000) * 10 = 50
// - Total: 100 points awarded to THIS hotspot only
// - User must be logged in with phone number to earn points
```

### 3. **Point Usage (Hotspot-Specific)**
```javascript
// User can ONLY use points at the hotspot where they earned them
// - Points earned at "Coffee Shop A" → Can only use at "Coffee Shop A"
// - Points earned at "Coffee Shop B" → Can only use at "Coffee Shop B"
// - NO cross-transfer possible
```

### 4. **Voucher Redemptions (No Loyalty Points)**
```javascript
// Offline voucher redemptions:
// - User gets free WiFi access
// - NO loyalty points awarded
// - Cannot be tracked for loyalty system
// - Only online mobile money purchases earn points
```

## API Endpoints

### Award Points (Hotspot-Specific)
```
POST /api/users/:phone/loyalty/:hotspotId/award
```
**Body:**
```javascript
{
  points: 100,
  reason: "WiFi package purchase: Daily Unlimited",
  packageName: "Daily Unlimited",
  packagePrice: 5000
}
```

### Redeem Points (Hotspot-Specific)
```
POST /api/users/:phone/loyalty/:hotspotId/redeem
```
**Body:**
```javascript
{
  points: 100,
  packageName: "Daily Unlimited",
  packageValue: 5000
}
```

### Get Loyalty Balance (Hotspot-Specific)
```
GET /api/users/:phone/loyalty/:hotspotId
```

### Get All Loyalty Balances
```
GET /api/users/:phone/loyalty
```

## Business Logic Examples

### Example 1: Coffee Shop A (Online Purchase)
```javascript
// User logs in with phone number
// Package: "Hourly WiFi" - 1000 UGX
// Loyalty: 20 points per package + 15 points per 1000 UGX
// User buys package: 20 + 15 = 35 points earned at Coffee Shop A
```

### Example 2: Coffee Shop B (Online Purchase)
```javascript
// User logs in with phone number
// Package: "Daily WiFi" - 5000 UGX  
// Loyalty: 100 points per package + 20 points per 1000 UGX
// User buys package: 100 + (5 * 20) = 200 points earned at Coffee Shop B
```

### Example 3: Coffee Shop C (Voucher Redemption)
```javascript
// User redeems offline paper voucher
// Package: "Daily WiFi" - 5000 UGX
// Loyalty: 100 points per package + 20 points per 1000 UGX
// User gets: 0 points (vouchers don't earn loyalty points)
// Reason: Cannot track offline voucher redemptions
```

### Example 4: Point Usage
```javascript
// User has:
// - 35 points at Coffee Shop A (from online purchase)
// - 200 points at Coffee Shop B (from online purchase)
// - 0 points at Coffee Shop C (from voucher redemption)

// User can:
// - Use 35 points at Coffee Shop A ✅
// - Use 200 points at Coffee Shop B ✅
// - Use Coffee Shop A points at Coffee Shop B ❌ (Impossible)
// - Use Coffee Shop B points at Coffee Shop A ❌ (Impossible)
// - Use any points at Coffee Shop C ❌ (No points earned there)
```

## Security Features

### 🔐 **Point Isolation**
- **Database-level separation**: Points stored in separate documents per hotspot
- **API-level validation**: All operations require specific hotspotId
- **No cross-referencing**: Impossible to transfer points between hotspots

### 🛡️ **Owner Control**
- **Configurable rates**: Each owner sets their own loyalty structure
- **Package-specific**: Different packages can have different loyalty rates
- **Enable/disable**: Owners can turn loyalty on/off per package

### 📊 **Audit Trail**
- **Complete transaction history**: Every point earned/spent is logged
- **Hotspot tracking**: All transactions include hotspotId
- **User verification**: Points can only be used by the user who earned them
- **Online-only tracking**: All loyalty activities are logged and auditable

### 📱 **Online Verification**
- **Phone login required**: Users must be logged in to earn points
- **Mobile money only**: Only online payments earn loyalty points
- **No offline loopholes**: Vouchers and offline methods cannot earn points

## Frontend Integration

### UserDashboard Updates
- **Hotspot-specific display**: Shows points for current connected hotspot
- **Real-time updates**: Loyalty balance updates when connected
- **Contextual information**: Shows which hotspot the points belong to
- **Online status**: Only shows loyalty for online users

### HotspotsMap Integration
- **Session checking**: Prevents double billing with loyalty points
- **Hotspot-specific loyalty**: Shows loyalty status for each hotspot
- **Smart UI**: Different states for hotspots with/without loyalty
- **Login requirement**: Loyalty features only available to logged-in users

## Benefits

### 🎯 **For WiFi Owners**
1. **No cross-hotspot cheating**: Users can't use points from competitors
2. **Customizable loyalty**: Set rates that work for your business
3. **Customer retention**: Loyalty points keep users coming back to YOUR hotspot
4. **Revenue protection**: Points only usable at your location
5. **Online focus**: Loyalty system encourages online payments over offline vouchers

### 🎯 **For Users**
1. **Fair system**: Points earned where you spend money online
2. **Clear tracking**: See exactly where your points are
3. **No confusion**: Points clearly tied to specific hotspots
4. **Rewarding experience**: Earn and use points at your favorite locations
5. **Online convenience**: Login with phone to earn loyalty points

### 🎯 **For Platform**
1. **Prevents abuse**: No cross-hotspot point manipulation
2. **Owner satisfaction**: Each owner controls their own loyalty
3. **Data integrity**: Clean, isolated loyalty tracking
4. **Scalable system**: Works for any number of hotspots
5. **Online ecosystem**: Encourages digital payments and user accounts

## Migration Notes

### Existing Data
- **Old loyalty system**: Will continue to work during transition
- **New system**: Gradually replaces old system
- **Data migration**: Can be done incrementally

### Backward Compatibility
- **API endpoints**: New endpoints don't break existing functionality
- **Frontend**: Gradual rollout of new loyalty features
- **Database**: New collections don't affect existing data

## Future Enhancements

### 🔮 **Potential Features**
1. **Loyalty tiers**: Bronze, Silver, Gold levels per hotspot
2. **Point expiration**: Time-based point validity
3. **Referral bonuses**: Extra points for bringing friends
4. **Special events**: Bonus points during promotions
5. **Cross-hotspot partnerships**: Special agreements between owners

### 🔮 **Advanced Analytics**
1. **Loyalty effectiveness**: Track which rates work best
2. **User behavior**: Understand loyalty point usage patterns
3. **Revenue impact**: Measure loyalty program ROI
4. **Competitive analysis**: Compare loyalty rates across hotspots
5. **Online vs offline**: Track conversion from vouchers to online payments

## Conclusion

The hotspot-specific loyalty system provides a **fair, secure, and scalable** way to reward loyal customers while preventing abuse. By isolating points per hotspot and requiring online phone login, we ensure that:

- ✅ **Users earn points where they spend money online**
- ✅ **Points can only be used at the earning location**
- ✅ **WiFi owners control their own loyalty programs**
- ✅ **No cross-hotspot cheating is possible**
- ✅ **System scales to any number of hotspots**
- ✅ **Online ecosystem is encouraged over offline methods**

This creates a **win-win-win** situation for users, WiFi owners, and the platform itself, while maintaining the integrity of the loyalty system through online verification.
