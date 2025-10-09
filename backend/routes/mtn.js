const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
require("dotenv").config();
const { db } = require("../firebase");
const crypto = require("crypto");

// 🔐 Get Access Token
async function getAccessToken() {
  const { MTN_API_USER, MTN_API_KEY, MTN_BASE_URL, MTN_PRIMARY_KEY } =
    process.env;

  const res = await axios.post(`${MTN_BASE_URL}/collection/token/`, null, {
    headers: {
      "Ocp-Apim-Subscription-Key": MTN_PRIMARY_KEY,
      Authorization:
        "Basic " +
        Buffer.from(`${MTN_API_USER}:${MTN_API_KEY}`).toString("base64"),
    },
  });

  return res.data.access_token;
}

// 🔐 Get Disbursement Access Token
async function getDisbursementAccessToken() {
  const { MTN_API_USER, MTN_API_KEY, MTN_BASE_URL, MTN_PRIMARY_KEY } =
    process.env;

  const res = await axios.post(`${MTN_BASE_URL}/disbursement/token/`, null, {
    headers: {
      "Ocp-Apim-Subscription-Key": MTN_PRIMARY_KEY,
    },
    auth: {
      username: MTN_API_USER,
      password: MTN_API_KEY,
    },
  });

  return res.data.access_token;
}

function normalizeMsisdn(rawPhone) {
  const digitsOnly = String(rawPhone || "").replace(/\D/g, "");
  if (!digitsOnly) return "";
  if (digitsOnly.startsWith("256")) return digitsOnly;
  if (digitsOnly.startsWith("0")) return `256${digitsOnly.slice(1)}`;
  return digitsOnly;
}

// 💰 POST /api/pay/mtn
router.post("/pay/mtn", async (req, res) => {
  try {
    const { phone, amount, packageName, ownerId, voucherQuote } = req.body;
    if (!phone || !amount || !packageName) {
      return res
        .status(400)
        .json({ success: false, message: "Missing phone, amount, packageName" });
    }

    const msisdn = normalizeMsisdn(phone);
    if (!/^\d{9,15}$/.test(msisdn)) {
      return res.status(400).json({ success: false, message: "Invalid phone" });
    }

    let amountNumber = Number(amount);
    // If a voucher quote is provided, validate signature and override amount
    if (voucherQuote && voucherQuote.payload && voucherQuote.signature) {
      try {
        const secret = process.env.VOUCHER_SECRET || "dev_voucher_secret";
        const json = JSON.stringify(voucherQuote.payload);
        const computed = crypto.createHmac("sha256", secret).update(json).digest("hex");
        if (computed !== voucherQuote.signature) {
          return res.status(400).json({ success: false, message: "Invalid voucher signature" });
        }
        // Basic payload checks
        if (
          voucherQuote.payload.ownerId !== ownerId ||
          voucherQuote.payload.packageName !== packageName
        ) {
          return res.status(400).json({ success: false, message: "Voucher quote mismatch" });
        }
        amountNumber = Number(voucherQuote.payload.amountToCharge);
        if (!Number.isFinite(amountNumber) || amountNumber < 0) {
          return res.status(400).json({ success: false, message: "Invalid discounted amount" });
        }
        // If amount is 0, do not charge; instead mark as voucher-only and short-circuit
        if (amountNumber === 0) {
          return res.status(400).json({ success: false, message: "Amount is 0; use /api/vouchers/redeem" });
        }
      } catch (e) {
        return res.status(400).json({ success: false, message: "Voucher quote validation failed" });
      }
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const accessToken = await getAccessToken();
    const referenceId = uuidv4();
    const currency = (process.env.MTN_ENV || "sandbox") === "sandbox" ? "EUR" : "UGX";

    await axios.post(
      `${process.env.MTN_BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: amountNumber.toString(),
        currency,
        externalId: `YABA-${Date.now()}`,
        payer: {
          partyIdType: "MSISDN",
          partyId: msisdn,
        },
        payerMessage: packageName,
        payeeNote: "Yaba WiFi Access",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Target-Environment": process.env.MTN_ENV || "sandbox",
          "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
          "X-Reference-Id": referenceId,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ MTN requesttopay sent:", referenceId);
    // Record payment intent (for later settlement)
    try {
      const numericAmount = Number(amountNumber) || 0;
      const COMMISSION_PERCENTAGE = 25;
      const commission = Math.round((numericAmount * COMMISSION_PERCENTAGE) / 100);
      const netAmount = numericAmount - commission;
      await db.collection("payments").doc(referenceId).set({
        referenceId,
        ownerId: ownerId || null,
        phone: msisdn,
        amount: numericAmount,
        packageName,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        commissionRate: COMMISSION_PERCENTAGE,
        commissionAmount: commission,
        netAmount,
      });
    } catch (e) {
      console.error("Failed to record payment intent:", e.message);
    }

    res.json({ success: true, referenceId });
  } catch (err) {
    console.error("❌ MTN Payment error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Payment failed" });
  }
});

// 🔎 GET /api/mtn/status/:referenceId
router.get("/mtn/status/:referenceId", async (req, res) => {
  try {
    const { referenceId } = req.params;
    const accessToken = await getAccessToken();

    const statusRes = await axios.get(
      `${process.env.MTN_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Target-Environment": process.env.MTN_ENV || "sandbox",
          "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({ success: true, data: statusRes.data });
  } catch (err) {
    console.error("❌ MTN Status error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to fetch status" });
  }
});

// Shared settlement function with idempotency
async function settleReference(referenceId) {
  const accessToken = await getAccessToken();

  const statusRes = await axios.get(
    `${process.env.MTN_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Target-Environment": process.env.MTN_ENV || "sandbox",
        "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  const status = (statusRes.data?.status || "").toUpperCase();
  const paymentDoc = await db.collection("payments").doc(referenceId).get();
  if (!paymentDoc.exists) {
    throw new Error("Payment not found");
  }
  const payment = paymentDoc.data();
  if (payment.settled) {
    return { alreadySettled: true, payment };
  }

  if (status !== "SUCCESSFUL") {
    await paymentDoc.ref.set({ status }, { merge: true });
    return { pending: true, status };
  }

  // Fetch payout accounts
  const platformDoc = await db.collection("settings").doc("super_payout_account").get();
  const ownerAccountDoc = payment.ownerId ? await db.collection("owner_payout_accounts").doc(payment.ownerId).get() : null;
  const platformNumber = platformDoc.exists ? platformDoc.data().accountNumber : null;
  let ownerNumber = ownerAccountDoc && ownerAccountDoc.exists ? ownerAccountDoc.data().accountNumber : null;
  // Fallback: if dedicated payout MoMo number is not set, use owner's profile phone
  if (!ownerNumber && payment.ownerId) {
    try {
      const ownerDoc = await db.collection("owners").doc(payment.ownerId).get();
      if (ownerDoc.exists && ownerDoc.data()?.ownerPhone) {
        ownerNumber = ownerDoc.data().ownerPhone;
      }
    } catch {}
  }

      // Write receipt and wallets
    let receiptData = null;
    try {
      const base = `http://localhost:${process.env.PORT || 5000}`;
      const receiptResponse = await axios.post(`${base}/api/receipts/save`, {
        phone: payment.phone,
        amount: payment.amount,
        packageName: payment.packageName,
        ownerId: payment.ownerId || null,
      });
      receiptData = receiptResponse.data;
    } catch (e) {
      console.error("Failed to write receipt:", e?.response?.data || e.message);
    }

  // Idempotency: if transfers doc exists and has settledAt, don't run again
  try {
    const existingTransfer = await db.collection("payout_transfers").doc(referenceId).get();
    if (existingTransfer.exists && existingTransfer.data()?.settledAt) {
      await paymentDoc.ref.set({ status: "SUCCESSFUL", settled: true }, { merge: true });
      return { alreadySettled: true };
    }
  } catch {}

  // Disbursements with simple retry on failure
  const disbToken = await getDisbursementAccessToken();
  const currency = (process.env.MTN_ENV || "sandbox") === "sandbox" ? "EUR" : "UGX";
  const results = [];
  async function transfer(toMsisdn, amount, note, attempt = 1) {
    const externalId = `${referenceId}-${note}-${attempt}`;
    const payload = {
      amount: String(amount),
      currency,
      externalId,
      payee: { partyIdType: "MSISDN", partyId: toMsisdn },
      payerMessage: note,
      payeeNote: note,
    };
    try {
      await axios.post(`${process.env.MTN_BASE_URL}/disbursement/v1_0/transfer`, payload, {
        headers: {
          "X-Reference-Id": externalId,
          "X-Target-Environment": process.env.MTN_ENV || "sandbox",
          "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
          Authorization: `Bearer ${disbToken}`,
          "Content-Type": "application/json",
        },
      });
      return { ok: true, externalId };
    } catch (e) {
      if (attempt < 2) {
        // one retry
        return transfer(toMsisdn, amount, note, attempt + 1);
      }
      return { ok: false, error: e?.response?.data || e.message, externalId };
    }
  }

  if (platformNumber) {
    const r = await transfer(platformNumber, payment.commissionAmount, "commission");
    results.push({ type: "commission", ...r });
  }
  if (ownerNumber && payment.netAmount > 0) {
    const r = await transfer(ownerNumber, payment.netAmount, "owner_net");
    results.push({ type: "owner_net", ...r });
  }

  await db.collection("payout_transfers").doc(referenceId).set({
    referenceId,
    ownerId: payment.ownerId || null,
    amount: payment.amount,
    commissionAmount: payment.commissionAmount,
    netAmount: payment.netAmount,
    results,
    settledAt: new Date().toISOString(),
  }, { merge: true });

  await paymentDoc.ref.set({ status: "SUCCESSFUL", settled: true, settledAt: new Date().toISOString() }, { merge: true });
  return { settled: true, results };
}

// ⚖️ Settle via GET (manual)
router.get("/mtn/settle/:referenceId", async (req, res) => {
  try {
    const { referenceId } = req.params;
    const outcome = await settleReference(referenceId);
    res.json({ success: true, ...outcome });
  } catch (err) {
    console.error("❌ MTN settle error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Settlement failed" });
  }
});

// 📥 MTN Webhook callback (configure in MTN portal to point here)
router.post("/mtn/webhook", async (req, res) => {
  try {
    // Optional signature verification
    const providedSig = req.headers["x-webhook-signature"] || req.headers["x-signature"];
    const secret = process.env.MTN_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
    if (secret) {
      try {
        const bodyString = JSON.stringify(req.body || {});
        const computed = crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
        if (!providedSig || providedSig !== computed) {
          return res.status(401).json({ message: "Invalid signature" });
        }
      } catch (e) {
        return res.status(401).json({ message: "Signature verification failed" });
      }
    }

    const referenceId = req.headers["x-reference-id"] || req.body?.referenceId;
    if (!referenceId) return res.status(400).json({ message: "Missing referenceId" });
    const outcome = await settleReference(referenceId);
    res.json({ success: true, ...outcome });
  } catch (e) {
    res.status(500).json({ message: "Webhook processing failed" });
  }
});

module.exports = router;
