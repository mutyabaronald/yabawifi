# 🚀 WiFi Payment App - Referral System

A complete viral referral system that allows WiFi owners to create referral campaigns and users to earn rewards by inviting friends.

## ✨ Features

### 🔑 Owner Side (WiFi Business Owners)
- **Campaign Management**: Create, pause, and end referral campaigns
- **Flexible Rewards**: Choose from wallet credits, discount coupons, or free WiFi time
- **Reward Modes**: Reward referrer only, referee only, or both users
- **Campaign Analytics**: Track referrals, costs, and conversion rates
- **Full Control**: Set campaign duration, limits, and minimum purchase amounts

### 👥 User Side (WiFi Users)
- **Unique Referral Codes**: Get personalized 8-character referral codes
- **Easy Sharing**: Share via WhatsApp, SMS, or copy to clipboard
- **Progress Tracking**: View referral statistics and earned rewards
- **Reward History**: See recent referrals and their status

### 🛡️ Anti-Fraud & Security
- **Self-Referral Prevention**: Users cannot refer themselves
- **Referral Limits**: Configurable maximum referrals per user
- **Idempotent Processing**: Prevents duplicate reward distribution
- **Payment Validation**: Ensures minimum purchase amounts are met

## 🏗️ Architecture

### Backend Structure
```
backend/
├── routes/
│   └── referrals.js          # Main referral API endpoints
├── server.js                 # Server with referral routes
└── firebase.js              # Firebase configuration
```

### Frontend Components
```
frontend/
├── owner/
│   ├── OwnerReferrals.jsx   # Owner campaign management
│   └── OwnerReferrals.css   # Owner interface styling
└── src/
    └── components/
        ├── UserReferrals.jsx        # User referral interface
        ├── UserReferrals.css        # User interface styling
        ├── ReferralCodeInput.jsx    # Checkout referral input
        └── ReferralCodeInput.css    # Input component styling
```

## 🚀 Quick Start

### 1. Backend Setup

The referral system is already integrated into your server. The routes are available at `/api/referrals/*`.

**Available Endpoints:**
- `POST /api/referrals/campaigns` - Create referral campaign
- `GET /api/referrals/campaigns/:ownerId` - Get owner's campaigns
- `PATCH /api/referrals/campaigns/:ownerId/:campaignId` - Update campaign
- `POST /api/referrals/generate-code` - Generate user referral code
- `GET /api/referrals/user/:userId` - Get user's referral data
- `POST /api/referrals/process` - Process referral during payment
- `GET /api/referrals/analytics/:ownerId` - Get referral analytics

### 2. Frontend Integration

#### For WiFi Owners
Add the referral management component to your owner dashboard:

```jsx
import OwnerReferrals from './owner/OwnerReferrals';

// In your owner dashboard component
<OwnerReferrals ownerId={currentOwnerId} />
```

#### For WiFi Users
Add the referral interface to your user dashboard:

```jsx
import UserReferrals from './components/UserReferrals';

// In your user dashboard component
<UserReferrals userId={currentUserId} ownerId={currentOwnerId} />
```

#### For Checkout/Payment
Add referral code input to your payment flow:

```jsx
import ReferralCodeInput from './components/ReferralCodeInput';

// In your checkout component
<ReferralCodeInput 
  onCodeEntered={handleReferralCode}
  onCodeRemoved={removeReferralCode}
  initialCode={savedReferralCode}
/>
```

## 📊 Database Schema

### Firestore Collections

#### 1. Referral Campaigns
```javascript
owners/{ownerId}/referralCampaigns/{campaignId}
{
  ownerId: string,
  name: string,
  rewardType: 'wallet_credit' | 'discount_coupon' | 'entitlement',
  rewardValue: number,
  rewardMode: 'referrer' | 'referee' | 'both',
  startDate: timestamp,
  endDate: timestamp,
  maxReferralsPerUser: number,
  minPurchaseAmount: number,
  description: string,
  status: 'active' | 'paused' | 'ended',
  totalReferrals: number,
  totalCost: number,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### 2. User Referral Codes
```javascript
users/{userId}/referralCodes/{codeId}
{
  code: string,
  ownerId: string,
  createdAt: timestamp,
  referralsCount: number,
  rewardsEarned: number
}
```

#### 3. Referral Fulfillments
```javascript
referralFulfillments/{fulfillmentId}
{
  paymentId: string,
  referralCode: string,
  referrerUserId: string,
  newUserId: string,
  ownerId: string,
  campaignId: string,
  paymentAmount: number,
  rewardType: string,
  rewardValue: number,
  rewardMode: string,
  status: 'pending' | 'completed',
  createdAt: timestamp
}
```

#### 4. User Referral Stats
```javascript
users/{userId}
{
  // ... existing user data
  referralStats: {
    totalReferrals: number,
    totalRewardsEarned: number,
    lastReferralDate: timestamp
  }
}
```

## 🎯 Usage Examples

### Creating a Referral Campaign

```javascript
// Owner creates a campaign
const campaignData = {
  ownerId: "owner123",
  name: "Summer Referral Bonus",
  rewardType: "wallet_credit",
  rewardValue: 1000, // UGX 1000
  rewardMode: "both", // Both referrer and referee get rewards
  startDate: "2024-06-01",
  endDate: "2024-08-31",
  maxReferralsPerUser: 5,
  minPurchaseAmount: 500,
  description: "Invite friends and both get UGX 1000 wallet credit!"
};

const response = await axios.post('/api/referrals/campaigns', campaignData);
```

### Processing a Referral

```javascript
// During payment processing
const referralData = {
  referralCode: "ABC12345",
  newUserId: "user456",
  ownerId: "owner123",
  paymentAmount: 1000,
  paymentId: "payment789"
};

const response = await axios.post('/api/referrals/process', referralData);
```

### Generating User Referral Code

```javascript
// Generate referral code for user
const codeData = {
  userId: "user123",
  ownerId: "owner456"
};

const response = await axios.post('/api/referrals/generate-code', codeData);
// Returns: { referralCode: "XYZ78901" }
```

## 🔧 Configuration Options

### Campaign Settings
- **Reward Types**: Wallet credits, discount coupons, free WiFi time
- **Reward Modes**: Referrer only, referee only, or both users
- **Campaign Duration**: Start and end dates
- **User Limits**: Maximum referrals per user
- **Purchase Requirements**: Minimum amount for referral to qualify

### Reward Examples
- **Wallet Credit**: "Invite a friend, both get UGX 1000 wallet credit"
- **Discount Coupon**: "Refer friends and get 20% off your next purchase"
- **Free WiFi**: "Invite 3 friends, earn 1 hour free WiFi"

## 🚨 Anti-Fraud Measures

1. **Self-Referral Prevention**: Users cannot refer themselves
2. **Referral Limits**: Configurable maximum referrals per user
3. **Payment Validation**: Minimum purchase amounts enforced
4. **Idempotent Processing**: Prevents duplicate rewards
5. **Campaign Status Checks**: Only active campaigns process referrals

## 📱 Mobile-First Design

All components are fully responsive and optimized for mobile devices:
- Touch-friendly buttons and inputs
- Mobile-optimized sharing (WhatsApp, SMS)
- Responsive grid layouts
- Mobile-friendly modals and forms

## 🔄 Integration Points

### Payment Flow Integration
1. User enters referral code during checkout
2. Code is validated against active campaigns
3. After successful payment, referral is processed
4. Rewards are distributed to eligible users

### User Dashboard Integration
1. Users can view their referral codes
2. Track referral progress and rewards
3. Share codes via multiple channels
4. View referral history and statistics

### Owner Dashboard Integration
1. Create and manage referral campaigns
2. Monitor campaign performance
3. View analytics and costs
4. Control campaign status and settings

## 🧪 Testing

### Test Scenarios
- ✅ Valid referral code → successful reward distribution
- ❌ Self-referral → blocked with error message
- ❌ Invalid code → error message displayed
- ❌ Expired campaign → referral not processed
- ❌ User limit reached → referral blocked
- ❌ Insufficient purchase amount → referral blocked

### Testing Checklist
- [ ] Campaign creation and management
- [ ] Referral code generation
- [ ] Code validation and processing
- [ ] Reward distribution
- [ ] Anti-fraud measures
- [ ] Mobile responsiveness
- [ ] Error handling
- [ ] Analytics and reporting

## 🚀 Deployment

### Prerequisites
- Node.js backend with Express
- Firebase Firestore database
- React frontend
- Axios for API calls

### Environment Variables
Ensure your backend has access to:
- Firebase service account credentials
- Database connection settings

### Security Considerations
- Protect referral endpoints with authentication
- Validate owner permissions for campaign management
- Implement rate limiting for code generation
- Monitor for suspicious referral patterns

## 📈 Performance & Scalability

### Database Indexes
Create Firestore indexes for:
- `referralCodes` collection: `code` + `ownerId`
- `referralFulfillments` collection: `paymentId`
- `referralCampaigns` collection: `ownerId` + `status` + `startDate` + `endDate`

### Caching Strategy
- Cache active campaigns in memory
- Cache user referral codes
- Implement Redis for high-traffic scenarios

### Monitoring
- Track referral conversion rates
- Monitor campaign costs and ROI
- Alert on suspicious referral patterns
- Performance metrics for API endpoints

## 🤝 Contributing

### Code Style
- Use consistent naming conventions
- Include error handling for all async operations
- Add JSDoc comments for complex functions
- Follow React best practices

### Testing
- Write unit tests for utility functions
- Test API endpoints with various scenarios
- Validate frontend component behavior
- Test mobile responsiveness

## 📞 Support

For questions or issues with the referral system:
1. Check the API documentation
2. Review error logs in the backend
3. Test with the provided examples
4. Verify database schema and indexes

## 🎉 Success Metrics

Track these KPIs to measure referral system success:
- **Referral Conversion Rate**: % of codes that result in new users
- **Cost per Acquisition**: Total referral costs / new users acquired
- **User Engagement**: % of users who generate referral codes
- **Campaign ROI**: Revenue from referred users - referral costs
- **Viral Coefficient**: Average referrals per user

---

**Built with ❤️ for WiFi business growth and user engagement**
