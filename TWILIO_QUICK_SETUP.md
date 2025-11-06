# Twilio Verify API - Quick Setup

## Your Twilio Credentials

Based on the code you provided, here's what you need to set up:

### Step 1: Add to `backend/.env`

Create or update `backend/.env` with these values:

```env
TWILIO_ACCOUNT_SID=YOUR_ACCOUNT_SID_HERE
TWILIO_AUTH_TOKEN=[AuthToken]  # Replace [AuthToken] with your actual auth token
TWILIO_VERIFY_SERVICE_SID=VA6bfbc430452c62af7e2134e53c6bc371
```

**Important**: Replace `[AuthToken]` with your actual Twilio Auth Token from the Twilio Console.

### Step 2: Test Phone Number

The test phone number you provided: `+256789524557`

This will be automatically formatted by the service if needed.

### Step 3: How It Works

1. **User requests password reset** → `/api/users/forgot-password`

   - Backend sends verification code via Twilio Verify API
   - Code is sent to user's phone via SMS

2. **User enters code** → `/api/users/verify-reset-code`

   - Backend verifies the code using Twilio Verify API
   - If valid, marks as verified

3. **User sets new password** → `/api/users/reset-password`
   - Backend checks that verification was completed
   - Updates password in Firestore

### Step 4: Test It

1. Make sure your `.env` file has the correct credentials
2. Restart your backend server
3. Go to the Forgot Password page
4. Enter phone number: `0789524557` or `+256789524557`
5. Check your phone for the verification code
6. Enter the code to verify
7. Set your new password

### Notes

- Twilio Verify API handles OTP generation and expiration automatically
- No need to manually generate codes or check expiration
- More secure than manual code generation
- Works with trial accounts (can send to verified numbers)

### Troubleshooting

If you get errors:

1. Check that `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are correct
2. Check that `TWILIO_VERIFY_SERVICE_SID` matches your Verify Service SID
3. Check Twilio Console → Monitor → Logs for detailed error messages
4. Make sure your phone number is verified in Twilio (if on trial account)




