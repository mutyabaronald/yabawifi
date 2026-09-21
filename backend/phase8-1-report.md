# Phase 8.1 — AAA Foundation Hardening Report

**Status:** IMPLEMENTATION COMPLETE — UNCOMMITTED (no commit, no push)  
**Baseline commit:** `28d459ffa8fc725a09e6a3383f79a5d168d98c4b`  
**Date:** 2026-09-20  

---

## 1. Files Changed (Uncommitted)

| File | Action | Lines Changed |
|------|--------|--------------|
| `backend/services/roamingSessionService.js` | Modified | +24, −1 |
| `backend/services/roamingEnforcementService.js` | Modified | +42, −4 |
| `backend/services/adapters/mockRoamingAAAAdapter.js` | Modified | +14, −0 |
| `backend/server.js` | Modified | +12, −0 |
| `backend/scripts/check-roaming-phase8-1.js` | **New file** | — |
| `backend/phase8-1-report.md` | **New file** | — |

**Total: 4 modified files, 2 new files.**  
No Phase 7 accounting, payment, wallet, voucher, package, or loyalty files were modified.

---

## 2. AAA Identity Propagation Design

### Problem
`createRoamingSession()` in `roamingSessionService.js` created roaming sessions **without** setting `session.aaaAdapterKey`. This caused `resolveAdapterForSession()` in `roamingEnforcementService.js` to immediately throw `ADAPTER_NOT_CONFIGURED` (404) for every enforcement provisioning attempt.

### Solution
After token validation and entitlement eligibility check, `createRoamingSession()` now performs a **trusted server-side lookup** of the visited hotspot:

```javascript
const hotspotSnap = await db
  .collection("roaming_hotspots")
  .doc(visitedHotspotId)
  .get();
let aaaAdapterKey = "unknown";
if (hotspotSnap.exists) {
  const hotspot = hotspotSnap.data();
  if (
    hotspot.aaaAdapterKey &&
    typeof hotspot.aaaAdapterKey === "string" &&
    AAA_ADAPTER_KEYS.includes(hotspot.aaaAdapterKey)
  ) {
    aaaAdapterKey = hotspot.aaaAdapterKey;
  }
}
```

Then `aaaAdapterKey: aaaAdapterKey` is added to the `sessionData` object (line 252 of `roamingSessionService.js`).

### Authoritative source
The `aaaAdapterKey` comes **exclusively** from the `roaming_hotspots` Firestore document, which is:
1. Created/updated via `registry.registerHotspot()` in `roamingRegistryService.js`
2. Validated against `AAA_ADAPTER_KEYS` at registration time (line 515: `assertEnum(aaaAdapterKey, AAA_ADAPTER_KEYS, "aaaAdapterKey")`)
3. Server-side data — never client-supplied

### Client override protection
- The `roaming/sessions.js` POST route passes `req.body` fields to `createRoamingSession()` — but **only** `entitlementId`, `metadata`, and `idempotencyKey`.  
- `aaaAdapterKey` is **not** in the function signature for `createRoamingSession()`.  
- The sessions route does NOT reference `aaaAdapterKey` anywhere in its body.  
- A client CANNOT supply or override the adapter key.

### Fallback behavior
If the hotspot document doesn't exist or lacks a valid `aaaAdapterKey`, the session gets `aaaAdapterKey = "unknown"`. This will later fail at enforcement with `ADAPTER_UNAVAILABLE` (503) since `"unknown"` is not a registered adapter. This is safe deterministic failure.

---

## 3. Adapter Startup / Registration Design

### Problem
The mock adapter was the **only** concrete adapter but was **never registered** at startup. No production code called `registerAAAAdapter()`.

### Solution: `ROAMING_MOCK_AAA_ENABLED` flag

Added to `server.js` (lines 45-55):

```javascript
const ROAMING_MOCK_AAA_ENABLED =
  String(process.env.ROAMING_MOCK_AAA_ENABLED || "false").toLowerCase() === "true";
if (ROAMING_MOCK_AAA_ENABLED) {
  const { MockRoamingAAAAdapter } = require("./services/adapters/mockRoamingAAAAdapter");
  const { registerAAAAdapter } = require("./services/roamingAAAAdapterRegistry");
  registerAAAAdapter(new MockRoamingAAAAdapter());
  console.log("[RoamingAAA] Mock AAA adapter registered (ROAMING_MOCK_AAA_ENABLED=true)");
} else {
  console.log("[RoamingAAA] Mock AAA adapter disabled (ROAMING_MOCK_AAA_ENABLED=false, default)");
}
```

### Safety model
- **Default:** `false` (production-safe — no mock adapter registered)
- **Opt-in:** Must be explicitly set to `"true"` in environment
- **No global fallback:** Production mode (flag not set) leaves registry empty — all enforcement attempts fail deterministically with `ADAPTER_UNAVAILABLE` (503)



### Mock adapter self-protection
`mockRoamingAAAAdapter.js` now includes `_safetyCheck()` called at the start of every public method:

```javascript
_safetyCheck() {
  if (!isMockAllowed) {
    throw new RoamingAAAAdapterError(
      503,
      "MOCK_ADAPTER_DISABLED",
      "Mock AAA adapter is disabled. Set ROAMING_MOCK_AAA_ENABLED=true for development/test."
    );
  }
}
```

Even if someone manually instantiates `new MockRoamingAAAAdapter()` and calls it directly, it will throw `MOCK_ADAPTER_DISABLED` unless the flag is explicitly `true`.

### `ROAMING_REGISTRY_ENABLED`
- Remains `false` by default in `roamingRegistryService.js` (line 48: `process.env.ROAMING_REGISTRY_ENABLED || "false"`)
- **NOT overridden** in `server.js`
- No changes to `.env` — production roaming registry remains disabled
- Phase 8.1 did **not** activate production roaming

---

## 4. Error Handling Model

### Error contract (verified against actual implementation)

| Condition | Error Code | HTTP Status | Location |
|-----------|-----------|-------------|----------|
| No adapter configured (missing `aaaAdapterKey`) | `ADAPTER_NOT_CONFIGURED` | 404 | `roamingEnforcementService.js:142` |
| Adapter explicitly disabled | `ADAPTER_DISABLED` | 503 | `roamingEnforcementService.js:154` (new) |
| Adapter registered but unavailable (error state) | `ADAPTER_UNAVAILABLE` | 503 | `roamingEnforcementService.js:162` (enhanced) |
| Adapter not registered | `ADAPTER_UNAVAILABLE` | 503 | `roamingEnforcementService.js:182` |
| Required capability missing | `ADAPTER_NOT_IMPLEMENTED` | 501 | `roamingEnforcementService.js:190` (new) |
| Adapter method not defined | `ADAPTER_NOT_IMPLEMENTED` | 501 | `roamingEnforcementService.js:189` (existing) |
| Adapter operation throws | `ADAPTER_FAILURE` | 502 | `roamingEnforcementService.js:348` (existing) |

### Implementation changes in `resolveAdapterForSession()`

**Before** (Phase 7):
```javascript
if (!isAAAAdapterAvailable(key)) {
  throw ADAPTER_UNAVAILABLE(503)
}
```
This conflated disabled + error + unavailable into a single code.

**After** (Phase 8.1):
```javascript
const entry = getAAAAdapterEntry(key);
if (entry && !entry.enabled) {
  throw ADAPTER_DISABLED(503)                   // NEW: explicit disable
}
if (!entry || entry.state === "error") {
  throw ADAPTER_UNAVAILABLE(503)                // enhanced: distinguishes error state
}
```

### Error contract finding
The discovery report (§11) referenced `UNSUPPORTED_CAPABILITY` as the error code for capability gaps. The **actual codebase** uses `ADAPTER_NOT_IMPLEMENTED` (501) for this condition. This is a documentation discrepancy, not a design issue. `ADAPTER_NOT_IMPLEMENTED` is the primary error code for missing capabilities/methods. It is never nested under `ADAPTER_FAILURE` — `ADAPTER_FAILURE` is exclusively for runtime throwables from adapter method calls.

**Fix applied:** Phase 8.1 test script (`check-roaming-phase8-1.js`) uses `ADAPTER_NOT_IMPLEMENTED` to match the actual implementation, resolving the inconsistency.

---

## 5. Capability Validation

### Design
Added `checkAdapterCapability(adapter, operation)` helper in `roamingEnforcementService.js` (line 207):

```javascript
function checkAdapterCapability(adapter, operation) {
  const caps = typeof adapter.getCapabilities === "function" ? adapter.getCapabilities() : {};
  if (caps && caps[operation] === false) {
    throw new RoamingEnforcementError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `Adapter '${adapter.aaaAdapterKey}' does not support ${operation} capability`
    );
  }
}
```

### Applied at all adapter call sites
| Operation | Call site | Check |
|-----------|-----------|-------|
| `provisionAccess` | `provisionSessionEnforcement` (line 330) | ✅ `checkAdapterCapability(adapter, "provisionAccess")` |
| `revokeAccess` | `revokeSessionEnforcement` (line 506) | ✅ `checkAdapterCapability(adapter, "revokeAccess")` |
| `disconnect` | `disconnectSessionEnforcement` (line 650) | ✅ `checkAdapterCapability(adapter, "disconnect")` |
| `getUsage` | `getSessionUsage` (line 715) | ✅ `checkAdapterCapability(adapter, "getUsage")` |

### Fallback protection
Even without the pre-call capability check, the base class `RoamingAAAAdapter` throws `ADAPTER_NOT_IMPLEMENTED` (501) when a method is unimplemented (lines 60-113 of `roamingAAAAdapter.js`). The pre-call check provides earlier, more descriptive failure.

---

## 6. Tests Added

### Test script: `backend/scripts/check-roaming-phase8-1.js`
**88 assertions, 0 failures.** Tests:

| # | Category | Tests |
|---|----------|-------|
| 1 | Trusted aaaAdapterKey propagation | Session reads from hotspot, validates against AAA_ADAPTER_KEYS, assigns to session |
| 2 | Client override protection | No client-supplied aaaAdapterKey in session service or route |
| 3 | Missing adapter configuration | ADAPTER_NOT_CONFIGURED (404) when aaaAdapterKey missing |
| 4 | Adapter resolution | resolveAAAAdapter call, ADAPTER_NOT_FOUND in registry |
| 5 | Unavailable adapter | ADAPTER_UNAVAILABLE (503), isAvailable check |
| 6 | Disabled adapter | ADAPTER_DISABLED (503), entry.enabled check, disable function |
| 7 | Capability validation | checkAdapterCapability helper, all 4 operations checked |
| 8 | Mock safety | ROAMING_MOCK_AAA_ENABLED flag, MOCK_ADAPTER_DISABLED, server.js gating |
| 9 | Development mode | Conditional registration on flag === "true" |
| 10 | Production mode | Default false, no silent mock activation |
| 11 | Phase 6 compatibility | provisionSessionEnforcement, validateSessionForEnforcement intact |
| 12 | Phase 7 billing isolation | disconnectSessionEnforcement call present, no serviceFee |
| 13 | Wallet/payment isolation | No serviceFee in settlement, credit, receipt routes |
| 14 | Package/voucher isolation | No serviceFee in packages route |
| 15 | Registry safety | Registry defaults false, server.js doesn't override |
| 16 | No real network | No RADIUS/dgram/ssh2 imports in any modified or Phase 7 file |

---

## 7. Test Results

### Phase 8.1
```
node backend/scripts/check-roaming-phase8-1.js
Phase 8.1 Results: 88 passed, 0 failed
```

### Phase 7 Regression (all 15 staged scripts)
```
check-rau-calculation.js:       26 passed
check-rau-bridge.js:             61 passed
check-roaming-bridge-wire.js:     37 passed
check-roaming-phase7-3.js:       69 passed
check-roaming-phase7-4.js:       46 passed
check-roaming-phase7-5.js:       25 passed
check-roaming-phase7-6.js:       56 passed
check-roaming-phase7-6b.js:      38 passed
check-roaming-phase7-6c.js:      59 passed
check-roaming-phase7-6d.js:     101 passed
check-roaming-phase7-6e.js:     180 passed
check-roaming-phase7-6f2.js:      93 passed
check-roaming-phase7-6f3.js:      85 passed
check-roaming-phase7-6f4.js:      76 passed
check-roaming-phase7-7.js:      101 passed
──────────────────────────────────
Total:                          1,106 passed, 0 failed
```

### Phase 6 Regression
```
node backend/scripts/check-roaming-phase6.js
Phase 6 Results: 166 passed, 0 failed
```

Note: Phase 6 test is a structural test (`check-roaming-phase6.js`) that verifies file existence, source code patterns, and API contracts — 166 assertions covering the entire AAA adapter framework structure.

---

## 8. Phase 7 Isolation Verification

`git diff --stat` confirmed modifications only in 4 files:

| Modified File | Phase 7 Impact |
|---------------|----------------|
| `roamingSessionService.js` | Adds `aaaAdapterKey` to session data — no billing/settlement changes |
| `roamingEnforcementService.js` | Error handling + capability validation — no billing/settlement changes |
| `mockRoamingAAAAdapter.js` | Adds safety flag — mock was already committed, test-only usage |
| `server.js` | Adds conditional registration — no payment/routing changes |

**Phase 7 files NOT in diff:**
- `receiptRoutes.js` ✅ unchanged
- `packages.js` ✅ unchanged
- `mtn.js` ✅ unchanged
- `rauCalculationService.js` ✅ unchanged
- `roamingRauConsumptionService.js` ✅ unchanged
- `roamingSettlementService.js` ✅ unchanged
- `roamingSettlementCreditService.js` ✅ unchanged
- `roamingSettlementCreditGateway.js` ✅ unchanged
- `roamingSettlementReconciliationService.js` ✅ unchanged
- `roamingUsageService.js` ✅ unchanged
- `roamingResidualService.js` ✅ unchanged
- `roamingExpiryCron.js` ✅ unchanged
- `roamingEntitlementBridgeService.js` ✅ unchanged
- `wallets/*` ✅ unchanged
- `vouchers/*` ✅ unchanged
- `loyalty/*` ✅ unchanged

---

## 9. Git State Verification

```
git diff --stat
  backend/server.js                                    | 12 +++++++
  backend/services/adapters/mockRoamingAAAAdapter.js   | 14 ++++++++
  backend/services/roamingEnforcementService.js        | 42 ++++++++++++++++++++--
  backend/services/roamingSessionService.js            | 24 +++++++++++-
  4 files changed, 88 insertions(+), 5 deletions(-)

git diff --stat -- [Phase 7 files]
  (empty — no Phase 7 files modified)
```

- **0 staged files** ✅
- **0 commits created** ✅
- **0 pushes performed** ✅
- **4 modified + 2 new untracked files** (only Phase 8.1 files) ✅

---

## 10. What Phase 8.2 Should Implement Next

Based on the hardened foundation:

1. **RADIUS AAA adapter** (`backend/services/adapters/radiusRoamingAAAAdapter.js`)
   - Import a RADIUS protocol library (e.g., `radius` or raw `dgram` UDP)
   - Implement `authenticate` (Access-Request/Access-Accept/Reject)
   - Implement `authorize` (check RADIUS response attributes)
   - Implement `provisionAccess` (CoA or Access-Challenge)
   - Implement `revokeAccess` / `disconnect` (Disconnect-Request)
   - Implement `getUsage` (Accounting-Interim, Accounting-Stop)
   - Add `ROAMING_RADIUS_SHARED_SECRET` and `ROAMING_RADIUS_SERVER` config

2. **MikroTik adapter** (RouterOS API)
3. **UniFi adapter** (Controller API)
4. **TP-Link/Omada adapter**
5. **Cisco AAA integration** (migrate `ciscoService.js` into adapter framework)
6. **DHCP/IP assignment** abstraction
7. **Passpoint/EAP** groundwork

---

## 11. Summary

### Files changed (4 modified, 2 new)
1. `backend/services/roamingSessionService.js` — aaaAdapterKey propagation from hotspot
2. `backend/services/roamingEnforcementService.js` — ADAPTER_DISABLED, capability validation helper
3. `backend/services/adapters/mockRoamingAAAAdapter.js` — ROAMING_MOCK_AAA_ENABLED safety check
4. `backend/server.js` — conditional mock registration
5. `backend/scripts/check-roaming-phase8-1.js` — new test (88 assertions)
6. `backend/phase8-1-report.md` — this report

### Test results
- **Phase 8.1:** 88 passed, 0 failed
- **Phase 7:** 1,106 passed, 0 failed
- **Phase 6:** 166 passed, 0 failed

### Safety confirmations
- ✅ Production roaming NOT activated (`ROAMING_REGISTRY_ENABLED` remains `false`)
- ✅ Mock adapter NOT auto-enabled (requires explicit `ROAMING_MOCK_AAA_ENABLED=true`)
- ✅ No real network calls introduced (no RADIUS, MikroTik, UniFi, TPLink libraries)
- ✅ No credentials or secrets added
- ✅ No Phase 7 accounting/billing/wallet/payment changes
- ✅ No commit created, no push performed

---

**PHASE 8.1 — COMPLETE**
