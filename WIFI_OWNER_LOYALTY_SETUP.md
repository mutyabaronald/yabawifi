# WiFi Owner Loyalty Setup Guide

## Overview
WiFi owners now have complete control over their loyalty program. They can create custom loyalty reward packages that users can redeem with their accumulated points, instead of using hardcoded mock data.

## What WiFi Owners Can Configure

### 1. **WiFi Packages (Earning Points)**
When creating WiFi packages, owners can set:
- **Per-package points**: Points awarded for each package purchase
- **Per-amount points**: Points per 1000 UGX spent
- **Loyalty enabled/disabled**: Turn loyalty on/off per package

### 2. **Loyalty Reward Packages (Spending Points)**
Owners can create multiple loyalty reward packages:
- **Time-based access**: X minutes of WiFi access
- **Data-based access**: X MB of data
- **Unlimited access**: Unlimited WiFi for a period
- **Custom point costs**: How many points each reward costs

## Creating Loyalty Reward Packages

### **Step 1: Access Package Creation**
1. Go to WiFi Owner Dashboard
2. Navigate to "Packages" section
3. Click "Create New Package"
4. Select package type: **"loyalty_reward"**

### **Step 2: Configure Reward Details**
```javascript
{
  name: "1 Hour WiFi Access",
  type: "loyalty_reward",
  pointsRequired: 100,
  rewardType: "time_access",
  rewardValue: 60, // 60 minutes
  rewardDescription: "Get 1 hour of WiFi access using loyalty points"
}
```

### **Step 3: Reward Types Available**

#### **Time Access Rewards**
```javascript
{
  rewardType: "time_access",
  rewardValue: 30,        // 30 minutes
  rewardValue: 60,        // 1 hour
  rewardValue: 1440,      // 1 day (24 hours)
  rewardValue: 10080,     // 1 week
  rewardValue: 43200      // 1 month
}
```

#### **Data Access Rewards**
```javascript
{
  rewardType: "data_access",
  rewardValue: 100,       // 100 MB
  rewardValue: 1000,      // 1 GB
  rewardValue: 5000,      // 5 GB
  rewardValue: 10000      // 10 GB
}
```

#### **Unlimited Access Rewards**
```javascript
{
  rewardType: "unlimited",
  rewardValue: null,      // No specific limit
  rewardDescription: "Unlimited WiFi access for 24 hours"
}
```

## Example Loyalty Reward Configurations

### **Coffee Shop A - Conservative Approach**
```javascript
// 1. Quick Access
{
  name: "15 Min Quick Access",
  pointsRequired: 25,
  rewardType: "time_access",
  rewardValue: 15,
  description: "Perfect for checking emails"
}

// 2. Standard Session
{
  name: "1 Hour WiFi",
  pointsRequired: 75,
  rewardType: "time_access",
  rewardValue: 60,
  description: "Standard working session"
}

// 3. Extended Access
{
  name: "4 Hour Access",
  pointsRequired: 250,
  rewardType: "time_access",
  rewardValue: 240,
  description: "Extended work session"
}
```

### **Coffee Shop B - Premium Approach**
```javascript
// 1. Hourly Access
{
  name: "1 Hour Premium WiFi",
  pointsRequired: 100,
  rewardType: "time_access",
  rewardValue: 60,
  description: "High-speed WiFi access"
}

// 2. Daily Unlimited
{
  name: "Daily Unlimited",
  pointsRequired: 500,
  rewardType: "unlimited",
  rewardValue: null,
  description: "Unlimited WiFi all day"
}

// 3. Data Package
{
  name: "5 GB Data Package",
  pointsRequired: 300,
  rewardType: "data_access",
  rewardValue: 5000,
  description: "5 GB of data usage"
}
```

## Point Calculation Strategy

### **Recommended Point Ratios**

#### **Conservative (High Point Requirements)**
- **15 minutes**: 25-30 points
- **1 hour**: 75-100 points
- **4 hours**: 250-300 points
- **1 day**: 500-750 points

#### **Moderate (Balanced)**
- **15 minutes**: 20-25 points
- **1 hour**: 60-75 points
- **4 hours**: 200-250 points
- **1 day**: 400-500 points

#### **Aggressive (Low Point Requirements)**
- **15 minutes**: 15-20 points
- **1 hour**: 40-60 points
- **4 hours**: 150-200 points
- **1 day**: 300-400 points

### **Point Earning Rates (WiFi Packages)**
```javascript
// Example: Daily WiFi Package - 5000 UGX
{
  loyaltyPointsPerPackage: 50,      // 50 points per purchase
  loyaltyPointsPer1000UGX: 10,      // 10 points per 1000 UGX
  // Total points earned: 50 + (5 * 10) = 100 points
}
```

## User Experience Flow

### **1. User Buys WiFi Package**
```
User purchases "Daily WiFi" for 5000 UGX
→ Gets 100 loyalty points
→ Points stored at this specific hotspot
```

### **2. User Views Available Rewards**
```
User sees loyalty rewards created by WiFi owner:
- 15 Min Quick Access (25 points) ✅ Can afford
- 1 Hour WiFi (75 points) ✅ Can afford  
- 4 Hour Access (250 points) ❌ Not enough points
```

### **3. User Redeems Points**
```
User selects "1 Hour WiFi" (75 points)
→ System checks point balance
→ Deducts 75 points
→ Grants 1 hour WiFi access
→ Shows success message with remaining points
```

## Dashboard Management

### **Package Status Management**
- **Draft**: Package created but not visible to users
- **Launched**: Package visible and available for redemption
- **Paused**: Package temporarily unavailable
- **Archived**: Package removed from system

### **Analytics & Insights**
- **Redemption rates**: Which rewards are most popular
- **Point usage patterns**: How users spend their points
- **Revenue impact**: Effect of loyalty program on business
- **User engagement**: Loyalty program participation rates

## Best Practices

### **1. Start Small**
- Begin with 2-3 simple reward packages
- Test point requirements with your user base
- Adjust based on user feedback and redemption patterns

### **2. Balance Point Costs**
- Make rewards achievable but not too easy
- Consider your WiFi costs and profit margins
- Ensure points have real value to users

### **3. Clear Descriptions**
- Use descriptive names for rewards
- Explain what users get clearly
- Include any limitations or restrictions

### **4. Regular Updates**
- Monitor redemption patterns
- Adjust point requirements based on usage
- Add new reward types to keep users engaged

### **5. Seasonal Promotions**
- Create special rewards for holidays
- Offer bonus points during slow periods
- Run limited-time reward packages

## Troubleshooting

### **Common Issues**

#### **Users Can't See Rewards**
- Check if package status is "launched"
- Verify package type is "loyalty_reward"
- Ensure package belongs to correct hotspot

#### **Point Calculation Errors**
- Verify loyalty settings on WiFi packages
- Check if loyalty is enabled
- Ensure point values are positive numbers

#### **Redemption Failures**
- Check user point balance
- Verify reward package exists and is active
- Ensure user is connected to correct hotspot

## API Reference

### **Create Loyalty Reward Package**
```
POST /api/packages
{
  "name": "1 Hour WiFi",
  "type": "loyalty_reward",
  "ownerId": "owner_123",
  "pointsRequired": 75,
  "rewardType": "time_access",
  "rewardValue": 60,
  "rewardDescription": "1 hour of WiFi access"
}
```

### **Get Loyalty Rewards for Hotspot**
```
GET /api/packages/loyalty-rewards/:hotspotId
```

### **Update Loyalty Reward Package**
```
PUT /api/packages/:packageId
{
  "pointsRequired": 80,
  "rewardDescription": "Updated description"
}
```

## Conclusion

With this new system, WiFi owners have **complete control** over their loyalty programs:

✅ **Custom reward packages** instead of hardcoded options
✅ **Flexible point requirements** based on business needs  
✅ **Multiple reward types** (time, data, unlimited)
✅ **Real-time user feedback** on redemption success/failure
✅ **Business intelligence** on loyalty program effectiveness

This creates a **win-win situation** where owners can design loyalty programs that work for their business, while users get meaningful rewards that encourage continued engagement.
