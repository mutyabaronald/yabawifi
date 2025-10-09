# Contact Information Setup for Admin Login

This document explains how to set up and manage the contact information that appears in the "Need Help?" section of the Admin Login page.

## Overview

The contact information (phone, WhatsApp, and email) is now dynamically fetched from the backend instead of being hardcoded. This allows the superadmin/app owner to easily update their contact details without changing the code.

## Backend Endpoints

### Public Endpoint (No Authentication Required)
- `GET /api/super/contact-info` - Fetches contact information for display on the login page

### Protected Endpoints (Require Superadmin Authentication)
- `GET /api/super/contact-info/manage` - Fetches current contact information for editing
- `POST /api/super/contact-info/manage` - Updates contact information

## Database Structure

Contact information is stored in Firestore at:
```
settings/super_contact_info
```

Document structure:
```json
{
  "phone": "07xxxxxxxxxx",
  "whatsapp": "07xxxxxxxxxx", 
  "email": "ronaldmutyaba256@gmail.com",
  "updatedAt": "2025-01-XX..."
}
```

## Setup Instructions

### 1. Initial Setup
Run the setup script to create the initial contact information:

```bash
cd backend
node scripts/setContactInfo.js
```

### 2. Update Contact Information
Edit the `setContactInfo.js` script with your actual contact details:

```javascript
const contactInfo = {
  phone: "07xxxxxxxxxx", // Your actual phone number
  whatsapp: "07xxxxxxxxxx", // Your actual WhatsApp number  
  email: "your-email@gmail.com", // Your actual email
  updatedAt: new Date().toISOString(),
};
```

Then run the script again:
```bash
node scripts/setContactInfo.js
```

### 3. Via API (Recommended for Production)
Use the protected endpoints to manage contact information through your admin interface:

```bash
# Get current contact info
curl -H "Authorization: Bearer YOUR_SUPERADMIN_TOKEN" \
  http://localhost:5000/api/super/contact-info/manage

# Update contact info
curl -X POST \
  -H "Authorization: Bearer YOUR_SUPERADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"07xxxxxxxxxx","whatsapp":"07xxxxxxxxxx","email":"your-email@gmail.com"}' \
  http://localhost:5000/api/super/contact-info/manage
```

## Frontend Integration

The AdminLogin component automatically fetches contact information when it mounts and displays it in the "Need Help?" section. The phone and WhatsApp numbers are clickable:

- **Phone**: Clicking opens the phone dialer
- **WhatsApp**: Clicking opens WhatsApp with the number pre-filled
- **Email**: Clicking opens the default email client

## Fallback Values

If the API fails or no contact information is set, the system will display default values:
- Phone: 07xxxxxxxxxx
- WhatsApp: 07xxxxxxxxxx  
- Email: ronaldmutyaba256@gmail.com

## Security Notes

- The public endpoint (`/api/super/contact-info`) is intentionally unauthenticated so it can be accessed from the login page
- The management endpoints require superadmin authentication
- Contact information is stored in the settings collection, which should be restricted to superadmin access

## Troubleshooting

### Contact Info Not Loading
1. Check if the backend server is running
2. Verify the `/api/super/contact-info` endpoint is accessible
3. Check browser console for any fetch errors
4. Ensure the `super_contact_info` document exists in the settings collection

### Permission Errors
1. Verify your superadmin JWT token is valid
2. Check that the token has the correct role ("superadmin")
3. Ensure the JWT_SECRET environment variable is set correctly

### Database Issues
1. Check Firestore connection
2. Verify the settings collection exists
3. Check Firestore security rules for the settings collection

