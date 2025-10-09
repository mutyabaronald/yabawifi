# WiFi Hotspot Rating & Review System

## Overview

This document describes the comprehensive rating and review system implemented for WiFi hotspots. The system allows users to rate and review hotspots after purchasing packages, enables hotspot owners to manage and respond to reviews, and provides a public display of reviews on the captive portal.

## Features

### 🎯 **Core Functionality**
- **User Reviews**: Rate (1-5 stars) and review hotspots after package purchases
- **Admin Management**: Hotspot owners can view, manage, and respond to reviews
- **Privacy Protection**: User phone numbers are masked for public display
- **Owner Control**: Hotspot owners can enable/disable the review system
- **Real-time Updates**: Live review counts and ratings on captive portal
- **Notification System**: Admins get notified of new reviews, users get notified of admin replies

### 🔒 **Privacy & Security**
- User phone numbers masked as `xxxxxxxx357` in public views
- Admin-only access to full user information
- Owner verification for all admin operations
- Soft delete for review management

### 📱 **User Experience**
- Post-payment review popup
- Animated review display on captive portal
- User review history and admin replies
- Mobile-responsive design

## System Architecture

### **Database Collections**

#### 1. `hotspot_reviews`
```javascript
{
  id: "auto-generated",
  hotspotId: "hotspot_id",
  userPhone: "+256123456789",
  rating: 5, // 1-5 stars
  review: "Great WiFi service!",
  packageName: "Premium Package",
  packagePrice: "5000",
  date: "2024-01-15", // YYYY-MM-DD format
  createdAt: "2024-01-15T10:30:00Z",
  status: "active", // active, deleted
  adminReply: {
    reply: "Thank you for your feedback!",
    createdAt: "2024-01-15T14:00:00Z"
  },
  adminReplyDate: "2024-01-15T14:00:00Z"
}
```

#### 2. `admin_notifications`
```javascript
{
  id: "auto-generated",
  ownerId: "owner_id",
  hotspotId: "hotspot_id",
  type: "new_review",
  title: "New Review Received",
  message: "A user rated your hotspot 5/5 stars",
  reviewId: "review_id",
  userPhone: "+256123456789",
  rating: 5,
  review: "Great WiFi service!",
  isRead: false,
  createdAt: "2024-01-15T10:30:00Z"
}
```

#### 3. `user_notifications`
```javascript
{
  id: "auto-generated",
  userPhone: "+256123456789",
  hotspotId: "hotspot_id",
  type: "admin_reply",
  title: "Admin Replied to Your Review",
  message: "The hotspot admin replied to your review",
  reviewId: "review_id",
  adminReply: "Thank you for your feedback!",
  isRead: false,
  createdAt: "2024-01-15T14:00:00Z"
}
```

### **API Endpoints**

#### **Reviews Management**
- `POST /api/reviews/hotspots/:hotspotId/reviews` - Submit a review
- `GET /api/reviews/hotspots/:hotspotId/reviews/public` - Get public reviews (captive portal)
- `GET /api/reviews/hotspots/:hotspotId/reviews/admin` - Get admin reviews (with full user info)
- `POST /api/reviews/reviews/:reviewId/reply` - Admin reply to review
- `GET /api/reviews/users/:userPhone/reviews` - Get user review history
- `PUT /api/reviews/hotspots/:hotspotId/reviews/toggle` - Toggle reviews on/off
- `DELETE /api/reviews/reviews/:reviewId` - Soft delete review
- `GET /api/reviews/hotspots/:hotspotId/stats` - Get review statistics

#### **Notifications**
- `GET /api/notifications/admin/:ownerId` - Get admin notifications
- `GET /api/notifications/user/:userPhone` - Get user notifications
- `PUT /api/notifications/admin/:notificationId/read` - Mark admin notification as read
- `PUT /api/notifications/user/:notificationId/read` - Mark user notification as read
- `PUT /api/notifications/admin/:ownerId/read-all` - Mark all admin notifications as read
- `PUT /api/notifications/user/:userPhone/read-all` - Mark all user notifications as read
- `DELETE /api/notifications/admin/:notificationId` - Delete admin notification
- `DELETE /api/notifications/user/:notificationId` - Delete user notification
- `GET /api/notifications/counts/:userId` - Get unread notification counts

## Frontend Components

### **1. ReviewPopup.jsx**
- **Purpose**: Post-payment review popup for users
- **Features**: 
  - 5-star rating system
  - Optional text review
  - Package information display
  - Success/error messaging
  - Skip option

### **2. AdminReviewsDashboard.jsx**
- **Purpose**: Admin dashboard for managing reviews
- **Features**:
  - Review statistics (total, average rating, recent)
  - Toggle reviews on/off
  - View all reviews with user info
  - Reply to reviews
  - Phone number masking for privacy

### **3. UserReviewsHistory.jsx**
- **Purpose**: User view of their review history
- **Features**:
  - Personal review statistics
  - Review history with admin replies
  - Status tracking (pending reply/replied)

### **4. AnimatedReviewsDisplay.jsx**
- **Purpose**: Public review display on captive portal
- **Features**:
  - Auto-rotating reviews
  - Real-time statistics
  - Privacy-protected user info
  - Smooth animations
  - Call-to-action for new reviews

## Implementation Flow

### **1. User Purchase Flow**
```
User buys package → Payment successful → ReviewPopup appears → User rates/reviews → Points awarded → Admin notified
```

### **2. Admin Review Management**
```
Admin receives notification → Views review in dashboard → Can reply to review → User gets notified → User sees reply in history
```

### **3. Public Display**
```
Captive portal loads → Checks if reviews enabled → Fetches public reviews → Displays animated review carousel → Shows real-time stats
```

## Setup Instructions

### **1. Backend Setup**
1. Ensure all routes are registered in `server.js`
2. Create necessary Firebase indexes for queries
3. Set up notification collections in Firestore

### **2. Frontend Integration**
1. Import components where needed
2. Add ReviewPopup to post-payment flow
3. Integrate AdminReviewsDashboard into admin panel
4. Add UserReviewsHistory to user dashboard
5. Include AnimatedReviewsDisplay on captive portal

### **3. Database Configuration**
1. Add `reviewsEnabled: true` to hotspot documents
2. Ensure `loyaltyConfig` exists for point awarding
3. Set up proper Firestore security rules

## Configuration Options

### **Hotspot Settings**
```javascript
// In hotspot document
{
  reviewsEnabled: true, // Enable/disable review system
  loyaltyConfig: {
    enabled: true,
    defaultPoints: {
      review: 10, // Points for submitting a review
      // ... other point values
    }
  }
}
```

### **Review Limits**
- One review per user per hotspot per day
- Reviews are soft-deleted (status: 'deleted')
- Admin replies are permanent

## Security Considerations

### **Access Control**
- Admin routes require owner verification
- User routes require phone number verification
- Public routes only show masked information

### **Data Protection**
- Phone numbers masked in public views
- Admin access limited to hotspot owners
- Soft delete prevents data loss

## Testing

### **Test Scenarios**
1. **User Review Submission**
   - Submit review after package purchase
   - Verify points are awarded
   - Check admin notification

2. **Admin Management**
   - View reviews in admin dashboard
   - Reply to reviews
   - Toggle review system on/off

3. **Public Display**
   - Check captive portal review display
   - Verify privacy protection
   - Test animations and auto-rotation

4. **Notifications**
   - Admin receives new review notifications
   - User receives admin reply notifications
   - Mark notifications as read

## Troubleshooting

### **Common Issues**

#### **Reviews Not Appearing**
- Check if `reviewsEnabled` is true in hotspot config
- Verify Firebase indexes are created
- Check console for API errors

#### **Admin Access Denied**
- Ensure `ownerId` matches hotspot owner
- Verify authentication tokens
- Check Firestore security rules

#### **Notifications Not Working**
- Verify notification collections exist
- Check notification creation in review submission
- Ensure proper error handling

### **Debug Steps**
1. Check browser console for errors
2. Verify API endpoints are accessible
3. Check Firestore for data consistency
4. Verify Firebase indexes are properly configured

## Future Enhancements

### **Planned Features**
- Review moderation system
- Review analytics and insights
- Review response templates
- Bulk review management
- Review export functionality

### **Performance Optimizations**
- Review caching for public display
- Pagination for large review lists
- Real-time updates using WebSockets
- Image uploads for review attachments

## Support

For technical support or questions about the review system:
1. Check this documentation first
2. Review the API endpoints and error messages
3. Check Firebase console for database issues
4. Verify all required indexes are created

---

**Last Updated**: January 2024
**Version**: 1.0.0
**Author**: WiFi Automation System
