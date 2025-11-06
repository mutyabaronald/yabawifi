# Twilio Verify API Integration Setup Guide

This guide will help you set up Twilio Verify API for password reset codes. Twilio Verify handles OTP generation and verification automatically, making it more secure and easier to use.

## Step 1: Create a Twilio Account

1. Go to [Twilio.com](https://www.twilio.com/)
2. Sign up for a free account
3. Verify your email address and phone number

## Step 2: Get Your Twilio Credentials

1. Log in to your [Twilio Console](https://console.twilio.com/)
2. Navigate to the **Dashboard**
3. You'll find:
   - **Account SID**: Your unique account identifier
   - **Auth Token**: Your authentication token (click "show" to reveal)

## Step 3: Create a Verify Service

1. In the Twilio Console, go to **Verify** → **Services**
2. Click **Create new Service**
3. Enter a friendly name (e.g., "YABAnect Password Reset")
4. Click **Create**
5. Copy the **Service SID** (starts with `VA...`) - you'll need this for your environment variables

**Note**: Twilio Verify API handles OTP generation and verification automatically. You don't need to buy a phone number separately.

## Step 4: Verify Phone Numbers (Trial Account Only)

If you're on a trial account:

1. Go to **Phone Numbers** → **Manage** → **Verified Caller IDs**
2. Click **Add a new Caller ID**
3. Enter the phone number you want to send SMS to
4. Verify it using the code sent via SMS or call

**Production**: Upgrade your account to send SMS to any phone number without verification.

## Step 5: Install Twilio Package

Run this command in your `backend` directory:

```bash
cd backend
npm install twilio
```

## Step 6: Configure Environment Variables

### For Local Development:

1. Open `backend/env.example`
2. Copy it to `backend/.env` (if it doesn't exist)
3. Add your Twilio credentials:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Important**: Replace with your actual values from Twilio Console.

### For Production (Render.com):

1. Go to your Render dashboard
2. Select your backend service
3. Go to **Environment** tab
4. Add these environment variables:
   - `TWILIO_ACCOUNT_SID` = Your Account SID
   - `TWILIO_AUTH_TOKEN` = Your Auth Token
   - `TWILIO_PHONE_NUMBER` = Your Twilio phone number (with + prefix, e.g., +1234567890)

## Step 7: Test the Integration

1. Start your backend server:

   ```bash
   cd backend
   npm start
   ```

2. Test the forgot password flow:
   - Go to your login page
   - Click "Forgot Password?"
   - Enter a phone number (verified if on trial account)
   - Check the console for any errors
   - Check your phone for the SMS with reset code

## Troubleshooting

### SMS Not Sending

1. **Check Twilio Credentials**:

   - Verify `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are correct
   - Make sure there are no extra spaces or quotes

2. **Check Phone Number Format**:

   - Twilio phone number should include country code: `+1234567890`
   - User phone numbers will be automatically formatted to E.164 format

3. **Check Twilio Console**:

   - Go to **Monitor** → **Logs** → **Messaging**
   - Check for any error messages

4. **Trial Account Limitations**:

   - Trial accounts can only send to verified numbers
   - Check if the recipient number is verified in Twilio Console

5. **Check Backend Logs**:
   - Look for error messages in your server console
   - In development mode, the code will be logged to console if SMS fails

### Phone Number Format Issues

The service automatically formats phone numbers:

- If phone starts with `0`, it removes the `0` and adds `+256` (Uganda)
- If phone has 9 digits, it adds `+256` prefix
- If phone already has `+`, it uses it as-is

**Example**:

- `078952455` → `+25678952455`
- `78952455` → `+25678952455`
- `+25678952455` → `+25678952455` (unchanged)

## Cost Considerations

- **Trial Account**: Free, but limited to verified numbers
- **Paid Account**:
  - Pay-as-you-go pricing
  - Approx. $0.01-0.05 per SMS (varies by country)
  - Check [Twilio Pricing](https://www.twilio.com/pricing) for exact rates

## Security Notes

1. **Never commit** `.env` file to git
2. **Never share** your Auth Token publicly
3. **Use environment variables** in production
4. **Rotate credentials** if compromised

## Next Steps

1. ✅ Twilio account created
2. ✅ Credentials added to environment variables
3. ✅ Package installed
4. ✅ Test SMS sending
5. 🔄 Upgrade to paid account for production (if needed)
6. 🔄 Set up SMS delivery monitoring/alerts

## Support

- [Twilio Documentation](https://www.twilio.com/docs)
- [Twilio Support](https://support.twilio.com/)
- Check backend logs for detailed error messages
