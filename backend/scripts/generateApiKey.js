const axios = require("axios");
require("dotenv").config();

const { MTN_API_USER, MTN_PRIMARY_KEY, MTN_BASE_URL } = process.env;

async function generateApiKey() {
  try {
    const res = await axios.post(
      `${MTN_BASE_URL}/v1_0/apiuser/${MTN_API_USER}/apikey`,
      {},
      {
        headers: {
          "Ocp-Apim-Subscription-Key": MTN_PRIMARY_KEY,
        },
      }
    );

    console.log("✅ Your API Key:", res.data.apiKey);
  } catch (err) {
    console.error(
      "❌ Failed to generate key:",
      err.response?.data || err.message
    );
  }
}

generateApiKey();
