// Test script for real-time voucher functionality
// This file demonstrates how to test the real-time voucher updates

import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

// Test data for voucher operations
const testVoucherData = {
  code: 'TEST2024',
  ownerId: 'test-owner-123',
  hotspotId: 'test-hotspot-456',
  type: 'discount',
  packageValue: 25,
  usageLimit: 50,
  usageCount: 0,
  status: 'active',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
  redeemedAt: null,
  redeemedBy: null,
  redeemedByPhone: null
};

// Test functions for real-time voucher operations
export const testVoucherRealTime = {
  
  // Create a test voucher
  async createTestVoucher() {
    try {
      console.log('Creating test voucher...');
      const docRef = await addDoc(collection(db, 'vouchers'), testVoucherData);
      console.log('Test voucher created with ID:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('Error creating test voucher:', error);
      throw error;
    }
  },

  // Update voucher status to simulate redemption
  async redeemTestVoucher(voucherId) {
    try {
      console.log('Redeeming test voucher...');
      await updateDoc(doc(db, 'vouchers', voucherId), {
        status: 'redeemed',
        redeemedAt: new Date().toISOString(),
        redeemedBy: '+256700000000',
        redeemedByPhone: '+256700000000',
        usageCount: 1
      });
      console.log('Test voucher redeemed successfully');
    } catch (error) {
      console.error('Error redeeming test voucher:', error);
      throw error;
    }
  },

  // Update voucher to simulate expiration
  async expireTestVoucher(voucherId) {
    try {
      console.log('Expiring test voucher...');
      await updateDoc(doc(db, 'vouchers', voucherId), {
        status: 'expired'
      });
      console.log('Test voucher expired successfully');
    } catch (error) {
      console.error('Error expiring test voucher:', error);
      throw error;
    }
  },

  // Delete test voucher
  async deleteTestVoucher(voucherId) {
    try {
      console.log('Deleting test voucher...');
      await deleteDoc(doc(db, 'vouchers', voucherId));
      console.log('Test voucher deleted successfully');
    } catch (error) {
      console.error('Error deleting test voucher:', error);
      throw error;
    }
  },

  // Run complete test sequence
  async runFullTest() {
    console.log('Starting real-time voucher test sequence...');
    
    try {
      // Step 1: Create voucher
      const voucherId = await this.createTestVoucher();
      
      // Wait 2 seconds to see the real-time update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 2: Redeem voucher
      await this.redeemTestVoucher(voucherId);
      
      // Wait 2 seconds to see the real-time update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 3: Expire voucher
      await this.expireTestVoucher(voucherId);
      
      // Wait 2 seconds to see the real-time update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Step 4: Clean up
      await this.deleteTestVoucher(voucherId);
      
      console.log('Real-time voucher test completed successfully!');
      console.log('Check the AdminDashboard sidebar voucher button for real-time updates');
      
    } catch (error) {
      console.error('Test failed:', error);
    }
  }
};

// Instructions for testing
export const testInstructions = `
REAL-TIME VOUCHER TESTING INSTRUCTIONS:

1. Open the AdminDashboard in your browser
2. Navigate to the Vouchers section
3. Open browser console (F12)
4. Run the following commands:

   // Import the test functions
   import { testVoucherRealTime } from './test-voucher-realtime.js';
   
   // Run the full test sequence
   await testVoucherRealTime.runFullTest();

5. Watch the sidebar voucher button for real-time updates:
   - Green badge shows active vouchers count
   - Red badge shows expired vouchers count
   - Numbers update instantly as vouchers are created/redeemed/expired

6. The VoucherManager component will also update in real-time:
   - Statistics cards update automatically
   - Voucher table refreshes instantly
   - No page refresh needed

EXPECTED BEHAVIOR:
- When voucher is created: Active count increases
- When voucher is redeemed: Active count decreases, total redemptions increase
- When voucher expires: Active count decreases, expired count increases
- All updates happen instantly without page refresh

TROUBLESHOOTING:
- Ensure Firebase is properly configured
- Check browser console for any errors
- Verify ownerId matches the test data
- Make sure you're logged in as the correct owner
`;

// Export for easy access in browser console
if (typeof window !== 'undefined') {
  window.testVoucherRealTime = testVoucherRealTime;
  window.testInstructions = testInstructions;
}

