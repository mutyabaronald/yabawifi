# WiFi Automation - Render.com Deployment Guide

## Overview
This guide will help you deploy your WiFi automation app to Render.com for public access and review.

## Prerequisites
- GitHub repository (already set up)
- Render.com account
- Firebase project configured
- Environment variables ready

## Deployment Steps

### 1. Prepare Your Repository
✅ All configuration files are already created:
- `package.json` (root)
- `render.yaml` (Render configuration)
- `env.template` (environment variables template)

### 2. Deploy to Render.com

#### Backend Service
1. Go to [Render.com](https://render.com) and sign in
2. Click "New +" → "Web Service"
3. Connect your GitHub repository: `mutyabaronald/yabawifi`
4. Configure the backend service:
   - **Name**: `wifi-automation-backend`
   - **Environment**: `Node`
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Plan**: Free (or paid if needed)

#### Frontend Service
1. Click "New +" → "Static Site"
2. Connect the same GitHub repository
3. Configure the frontend service:
   - **Name**: `wifi-automation-frontend`
   - **Build Command**: `cd frontend && npm install && npm run build`
   - **Publish Directory**: `frontend/dist`

### 3. Environment Variables
Set these in Render.com dashboard for the backend service:

**Required Variables:**
```
NODE_ENV=production
PORT=5000
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_CLIENT_ID=your-client-id
JWT_SECRET=your-jwt-secret
```

**Optional Variables:**
```
MTN_SUBSCRIPTION_KEY=your-mtn-key
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 4. Frontend Environment Variables
Set these in Render.com dashboard for the frontend service:

```
VITE_API_URL=https://wifi-automation-backend.onrender.com
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

### 5. Deploy
1. Click "Create Web Service" for backend
2. Click "Create Static Site" for frontend
3. Wait for deployment to complete (5-10 minutes)

## URLs After Deployment
- **Frontend**: `https://wifi-automation-frontend.onrender.com`
- **Backend API**: `https://wifi-automation-backend.onrender.com`
- **Health Check**: `https://wifi-automation-backend.onrender.com/api/health`

## Troubleshooting

### Common Issues
1. **Build Fails**: Check environment variables are set correctly
2. **Frontend Can't Connect**: Verify `VITE_API_URL` points to backend URL
3. **Firebase Errors**: Ensure all Firebase environment variables are set
4. **CORS Issues**: Backend already has CORS enabled

### Logs
- Check Render.com dashboard for build and runtime logs
- Backend logs: Service → Logs tab
- Frontend logs: Service → Logs tab

## Security Notes
- Never commit `.env` files to GitHub
- Use Render.com's environment variable system
- Keep your Firebase service account key secure
- Consider using Render.com's paid plans for production

## Next Steps
1. Test all functionality on the deployed app
2. Share the frontend URL with reviewers
3. Monitor logs for any issues
4. Set up custom domains if needed
