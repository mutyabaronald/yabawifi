# 🔥 Firebase Index Setup for Loyalty Program

## 🚨 **URGENT: Required for Loyalty Program to Work**

Your loyalty program is currently failing because Firebase needs composite indexes. Follow these steps to fix it.

## 📋 **Required Indexes**

### 1. **hotspot_loyalty_transactions** (Most Important - Fixes Current Error)
- **Collection ID**: `hotspot_loyalty_transactions`
- **Fields**: 
  - `userPhone` (Ascending)
  - `createdAt` (Descending)
- **Query scope**: Collection

### 2. **hotspot_loyalty**
- **Collection ID**: `hotspot_loyalty`
- **Fields**:
  - `hotspotId` (Ascending)
  - `userPhone` (Ascending)
- **Query scope**: Collection

### 3. **loyalty_rewards**
- **Collection ID**: `loyalty_rewards`
- **Fields**:
  - `hotspotId` (Ascending)
  - `status` (Ascending)
  - `pointsRequired` (Ascending)
- **Query scope**: Collection

### 4. **loyalty_earning_methods**
- **Collection ID**: `loyalty_earning_methods`
- **Fields**:
  - `hotspotId` (Ascending)
  - `status` (Ascending)
- **Query scope**: Collection

### 5. **loyalty_redemptions**
- **Collection ID**: `loyalty_redemptions`
- **Fields**:
  - `userId` (Ascending)
  - `hotspotId` (Ascending)
  - `redeemedAt` (Descending)
- **Query scope**: Collection

## 🚀 **Quick Setup (Recommended)**

### **Option 1: Direct Link (Easiest)**
Click this link to create the main index that's causing the current error:
```
https://console.firebase.google.com/v1/r/project/yabawifiadmin/firestore/indexes?create_composite=CmJwcm9qZWN0cy95YWJhd2lmaWFkbWluL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9ob3RzcG90X2xveWFsdHlfdHJhbnNhY3Rpb25zL2luZGV4ZXMvXxABGg0KCXVzZXJQaG9uZRABGg0KCWNyZWF0ZWRBdBACGgwKCF9fbmFtZV9fEAI
```

### **Option 2: Manual Setup**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **yabawifiadmin**
3. Go to **Firestore Database** > **Indexes** tab
4. Click **"Create Index"**
5. Use the configurations above

## ⏱️ **Timeline**
- **Index creation**: 1-5 minutes each
- **You can create multiple simultaneously**
- **Monitor progress in Firebase Console**

## ✅ **After Setup**
Once all indexes are created:
1. Your loyalty program will work perfectly
2. Real-time data will load without errors
3. All API endpoints will function properly

## 🔍 **Verify Setup**
Check that all indexes show **"Enabled"** status in Firebase Console.

## 🆘 **Need Help?**
- Run: `node backend/scripts/create-all-loyalty-indexes.js`
- Check Firebase Console for index status
- Look for any error messages in your backend logs

---

**Note**: These indexes are essential for the loyalty program queries to work. Without them, you'll get the "query requires an index" error you're currently seeing.
