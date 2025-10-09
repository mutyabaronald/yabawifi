const axios = require("axios");
require("dotenv").config();

const API_USER = process.env.MTN_API_USER;
const BASE_URL = process.env.MTN_BASE_URL;
const PRIMARY_KEY = process.env.MTN_PRIMARY_KEY;

async function createApiUser() {
  try {
    const res = await axios.post(
      `${BASE_URL}/v1_0/apiuser`,
      { providerCallbackHost: "https://webhook.site/your-fake-callback" },
      {
        headers: {
          "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
          "X-Reference-Id": API_USER,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ API user created:", API_USER);
  } catch (err) {
    console.error("❌ Error creating user:", err.response?.data || err.message);
  }
}

createApiUser();
