/**
 * Phase 7.6B — Owner Wallet Route Cleanup & Financial Architecture Verification.
 *
 * This mission ONLY cleaned shadowed duplicate owner-wallet routes and verified
 * the financial architecture. It MUST NOT:
 *  - move money, credit/debit wallets,
 *  - alter withdrawals, MTN payout, receipts, or the 25% local commission,
 *  - implement the 5% service fee / 5% withdrawal fee / roaming settlement.
 *
 * Run: node backend/scripts/check-roaming-phase7-6b.js
 */
const path = require("path");
const fs = require("fs");
const { buildCommercialSnapshot } = require("../services/roamingEntitlementBridgeService");

let passed = 0;
let failed = 0;
const errs = [];
function assert(cond, msg) {
  if (cond) { console.log(`✅ PASS: ${msg}`); passed++; }
  else { console.error(`❌ FAIL: ${msg}`); errs.push(msg); failed++; }
}
function assertEqual(a, b, m) {
  const ok = a === b;
  ok ? (console.log(`✅ PASS: ${m} (${a})`), passed++) : (console.error(`❌ FAIL: ${m} — expected ${b}, got ${a}`), errs.push(m), failed++);
}
function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");
}

function count(src, regex) {
  const m = src.match(regex);
  return m ? m.length : 0;
}

async function main() {
  console.log("=== Phase 7.6B: Owner Wallet Route Cleanup & Financial Verification ===\n");

  const ownersSrc = read("backend/routes/owners.js");

  console.log("--- 1. owners.js loads as an Express router ---");
  {
    let router = null, loadErr = null;
    try { router = require("../routes/owners"); } catch (e) { loadErr = e; }
    assert(!loadErr, "owners.js loads without throwing");
    assert(router && typeof router === "function" && Array.isArray(router.stack), "owner routes registered on an Express router");
  }

  console.log("\n--- 2. Active wallet routes remain registered (exactly once) ---");
  {
    assertEqual(count(ownersSrc, /router\.get\("\/:ownerId\/wallet\/balance"/g), 1, "GET wallet/balance registered exactly once");
    assertEqual(count(ownersSrc, /router\.get\("\/:ownerId\/wallet\/transactions"/g), 1, "GET wallet/transactions registered exactly once");
    assertEqual(count(ownersSrc, /router\.post\("\/:ownerId\/wallet\/withdraw"/g), 1, "POST wallet/withdraw registered exactly once");
    assertEqual(count(ownersSrc, /router\.get\("\/:ownerId\/reports\/export\/csv"/g), 1, "GET reports/export/csv registered exactly once");
  }

  console.log("\n--- 3. /logo route remains registered/reachable ---");
  {
    assertEqual(count(ownersSrc, /router\.get\("\/logo\/:ownerId"/g), 1, "GET /logo/:ownerId registered exactly once (reachable)");
  }

  console.log("\n--- 4. Payout-account route remains registered ---");
  {
    assertEqual(count(ownersSrc, /router\.get\("\/:ownerId\/payout-account"/g), 1, "GET payout-account registered exactly once");
    assertEqual(count(ownersSrc, /router\.post\("\/:ownerId\/payout-account"/g), 1, "POST payout-account registered exactly once");
  }

  console.log("\n--- 5. No accidental duplicate wallet routes remain ---");
  {
    const walletPaths = ["/:ownerId/wallet/balance", "/:ownerId/wallet/transactions", "/:ownerId/wallet/withdraw", "/:ownerId/reports/export/csv"];
    for (const p of walletPaths) {
      const c = count(ownersSrc, new RegExp(`router\\.(get|post)\\("${p}"`, "g"));
      assert(c === 1, `no duplicate for ${p} (count=${c})`);
    }
  }

  console.log("\n--- 6. Active withdrawal logic unchanged (full MTN payout, no fee) ---");
  {
    // Active handler must still deduct the FULL amount and call MTN disbursement.
    assert(ownersSrc.includes("balance: (data.balance || 0) - amount"), "withdrawal debits the full requested amount from balance");
    assert(ownersSrc.includes("res.status(400).json({ error: err.message || \"Withdrawal failed\" });"), "withdrawal error handler preserved");
    assert(ownersSrc.includes("disbursement/v1_0/transfer"), "MTN disbursement transfer call preserved");
    assert(!/serviceFee/i.test(ownersSrc), "no serviceFee term introduced in owners.js");
    assert(!/0\.05\b/.test(ownersSrc), "no 5% fee factor introduced");
  }

  console.log("\n--- 7. No roaming settlement code introduced ---");
  {
    assert(!/roaming_settlements/.test(ownersSrc), "no roaming_settlements collection reference");
    assert(!/wallets\/platform|wallets.doc\("platform"\)/.test(ownersSrc), "owner routes do not touch wallets/platform");
  }

  console.log("\n--- 8. No 5% service fee / withdrawal fee introduced ---");
  {
    assert(!/serviceFee/i.test(ownersSrc), "no serviceFee introduced in owners.js");
    assert(!/5%\s*\*\s*amount|amount\s*\*\s*0\.05/i.test(ownersSrc), "no 5% fee math introduced");
  }

  console.log("\n--- 9. wallets/{ownerId} vs wallets/platform remain separate ---");
  {
    assert(/wallets"\)\.doc\(ownerId\)/.test(ownersSrc), "owner wallet uses wallets/{ownerId}");
    assert(!/wallets"\)\.doc\("platform"\)/.test(ownersSrc), "owner routes never read/write wallets/platform");
  }

  console.log("\n--- 10. Receipt/payout/commission write paths untouched (static) ---");
  {
    const receipt = read("backend/routes/receiptRoutes.js");
    const mtn = read("backend/routes/mtn.js");
    const superR = read("backend/superRoutes.js");
    assert(/COMMISSION_PERCENTAGE\s*=\s*25/.test(receipt), "receiptRoutes 25% commission unchanged");
    assert(/COMMISSION_PERCENTAGE\s*=\s*25/.test(mtn), "mtn 25% commission unchanged");
    assert(/DEFAULT_RATE\s*=\s*25/.test(superR), "superRoutes DEFAULT_RATE=25 unchanged");
    assert(/wallets"\)\.doc\("platform"\)/.test(receipt), "platform wallet still credited on receipt (unchanged)");
    assert(/wallets"\)\.doc\("platform"\)/.test(superR), "platform wallet still read in super (unchanged)");
    assert(!/serviceFee/i.test(receipt) && !/serviceFee/i.test(mtn) && !/serviceFee/i.test(superR), "no serviceFee introduced on money paths");
    assert(!/roaming_settlements/i.test(receipt) && !/roaming_settlements/i.test(mtn) && !/roaming_settlements/i.test(superR), "no roaming settlement writes on money paths");
  }

  console.log("\n--- 11. Historical economics: price changes do not alter old snapshots ---");
  {
    // Point-in-time snapshot: two entitlements from the same package id but at
    // different package prices must record DIFFERENT originalPrice (no global rate).
    const pkg = { id: "p", ownerId: "o", roamingEligible: true, timeLimitMinutes: 60 };
    const snap1 = buildCommercialSnapshot({ ...pkg, price: 5000 }, 60);
    const snap2 = buildCommercialSnapshot({ ...pkg, price: 7000 }, 60);
    assert(snap1 && snap1.originalPrice === 5000, "snapshot 1 captures price 5000");
    assert(snap2 && snap2.originalPrice === 7000, "snapshot 2 captures price 7000 (point-in-time)");
    assert(snap1.originalPrice !== snap2.originalPrice, "no global/inherited rate; each snapshot is independent");
  }

  console.log("\n--- 12. originalPrice excludes future Service Fee ---");
  {
    // originalPrice comes from package.price (access price), NOT any "amount".
    // buildCommercialSnapshot has no amount param and ignores ctx-supplied amounts.
    const snap = buildCommercialSnapshot({ id: "p", ownerId: "o", roamingEligible: true, timeLimitMinutes: 60, price: 1000 }, 60);
    assertEqual(snap.originalPrice, 1000, "originalPrice = package price (1000), not a customer-total with fees");
    assertEqual(snap.rateNumerator, 1000, "rate numerator = package price only");
  }

  console.log("\n--- 13. Payout-account handler behavior preserved ---");
  {
    // Active (Block-1) payout POST: does NOT require all fields, uses merge.
    assert(/router\.post\("\/:ownerId\/payout-account", async \(req, res\) => \{[\s\S]*?resolvedType = accountType \|\| "Mobile Money"/.test(ownersSrc), "active payout-account POST uses defaults (no required-field gate)");
    assert(/set\(payload, \{ merge: true \}\)/.test(ownersSrc), "active payout-account POST uses merge (unchanged)");
  }

  console.log(`\n========================================`);
  console.log(`Phase 7.6B Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test harness crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
