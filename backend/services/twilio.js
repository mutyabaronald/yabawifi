// backend/services/twilio.js
const twilio = require("twilio");

// Initialize Twilio client
const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Debug: Log what we're getting (without exposing full tokens)
  console.log("[Twilio Debug] Checking credentials:", {
    hasAccountSid: !!accountSid,
    hasAuthToken: !!authToken,
    accountSidPrefix: accountSid ? accountSid.substring(0, 5) : "N/A",
    authTokenPrefix: authToken ? authToken.substring(0, 5) : "N/A",
    allEnvKeys: Object.keys(process.env).filter(k => k.includes("TWILIO")).join(", "),
  });

  if (!accountSid || !authToken) {
    console.error(
      "❌ Twilio credentials not found. SMS functionality will be disabled."
    );
    console.error("Missing:", {
      accountSid: !accountSid ? "TWILIO_ACCOUNT_SID" : "",
      authToken: !authToken ? "TWILIO_AUTH_TOKEN" : "",
    });
    console.error("Current working directory:", process.cwd());
    console.error("NODE_ENV:", process.env.NODE_ENV);
    console.error("Please check your .env file in the backend directory.");
    console.error("Make sure the server was restarted after adding environment variables.");
    return null;
  }

  // Check if auth token has brackets (common mistake)
  if (authToken.startsWith("[") || authToken.endsWith("]")) {
    console.error(
      "⚠️  WARNING: Auth token appears to have brackets. Remove [ and ] from TWILIO_AUTH_TOKEN in .env"
    );
  }

  console.log("✅ Twilio client initialized successfully");
  return twilio(accountSid, authToken);
};

// Format phone number to E.164 format
const formatPhoneNumber = (phone) => {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, "");

  // If phone doesn't start with +, add country code
  if (!phone.startsWith("+")) {
    // Default to Uganda (+256) if no country code
    if (cleaned.length === 9 && cleaned.startsWith("0")) {
      // Remove leading 0 and add +256
      cleaned = "256" + cleaned.substring(1);
    } else if (cleaned.length === 9) {
      // Add +256 prefix
      cleaned = "256" + cleaned;
    }
    return "+" + cleaned;
  }

  return phone;
};

// Send password reset code using Twilio Verify API
const sendPasswordResetCode = async (phone) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      console.error("Twilio client not initialized. Check your credentials.");
      return { success: false, error: "SMS service not configured" };
    }

    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!serviceSid) {
      console.error("Twilio Verify Service SID not configured.");
      return { success: false, error: "Twilio Verify Service not configured" };
    }

    // Format phone number to E.164 format
    const formattedPhone = formatPhoneNumber(phone);

    // Create verification using Twilio Verify API
    const verification = await client.verify.v2
      .services(serviceSid)
      .verifications.create({
        to: formattedPhone,
        channel: "sms",
      });

    console.log(`Twilio Verification Response:`, {
      sid: verification.sid,
      status: verification.status,
      to: formattedPhone,
      serviceSid: serviceSid,
    });

    // Check if status is "pending" or "authenticate"
    if (verification.status === "pending") {
      // Success - code is being sent
      return {
        success: true,
        verificationSid: verification.sid,
        status: verification.status,
      };
    } else if (verification.status === "authenticate") {
      // Phone number needs verification (trial account)
      return {
        success: false,
        error:
          "Phone number needs verification. Please verify your phone number in Twilio Console first (trial account limitation).",
        status: verification.status,
        needsVerification: true,
      };
    } else {
      // Other status
      return {
        success: false,
        error: `Verification status: ${verification.status}. Please check Twilio Console for details.`,
        status: verification.status,
      };
    }
  } catch (error) {
    console.error("Error sending verification code via Twilio:", {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo,
      stack: error.stack,
    });

    // Provide more helpful error messages
    let errorMessage = "Failed to send verification code";

    if (error.code === 60200) {
      errorMessage = "Invalid phone number format. Please check the number.";
    } else if (error.code === 60203) {
      errorMessage =
        "Maximum verification attempts exceeded. Please try again later.";
    } else if (error.code === 20429) {
      errorMessage = "Too many requests. Please wait a moment and try again.";
    } else if (error.message) {
      errorMessage = error.message;
    }

    return {
      success: false,
      error: errorMessage,
      code: error.code,
    };
  }
};

// Verify password reset code using Twilio Verify API
const verifyPasswordResetCode = async (phone, code) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      console.error("Twilio client not initialized. Check your credentials.");
      return { success: false, error: "SMS service not configured" };
    }

    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!serviceSid) {
      console.error("Twilio Verify Service SID not configured.");
      return { success: false, error: "Twilio Verify Service not configured" };
    }

    // Format phone number to E.164 format
    const formattedPhone = formatPhoneNumber(phone);

    // Verify the code using Twilio Verify API
    const verificationCheck = await client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({
        to: formattedPhone,
        code: code,
      });

    if (verificationCheck.status === "approved") {
      console.log(`Verification code approved. SID: ${verificationCheck.sid}`);
      return {
        success: true,
        verified: true,
        verificationSid: verificationCheck.sid,
      };
    } else {
      return {
        success: false,
        verified: false,
        error: "Invalid or expired verification code",
      };
    }
  } catch (error) {
    console.error("Error verifying code via Twilio:", error);
    return {
      success: false,
      verified: false,
      error: error.message || "Failed to verify code",
    };
  }
};

module.exports = {
  sendPasswordResetCode,
  verifyPasswordResetCode,
  formatPhoneNumber,
};
