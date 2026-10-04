# Phase 8.2C — RADIUS Transport / Client Foundation

**Status:** IMPLEMENTATION + LOCAL TEST ONLY — no production RADIUS, no commit, no push
**Baseline commit:** `58dec9715965272cb551faa131e3840221fed656`
**Date:** 2026-10-03

---

## 1. Architectural Decision — Transport Layer Location

> Phase 8.2B established `backend/services/radius/` as a pure protocol layer with a
> no-live-networking invariant. Phase 8.2C therefore places UDP transport/client
> functionality in the sibling `backend/services/radiusTransport/` layer. The existing
> Phase 8.2B regression test remains unchanged.

### 1.1 Why the decision was required

The Phase 8.2C specification originally requested the transport/client layer be created
"under `backend/services/radius/`". That location conflicts with a committed,
independently verified Phase 8.2B invariant.

`backend/scripts/check-roaming-phase8-2b.js` §9 ("No Live Networking") enumerates every
entry in `backend/services/radius/` and fails the suite if any entry contains
`require("dgram")`, `require("net")`, or `require("radius")`.

Both readings of "under `backend/services/radius/`" were tested empirically in a throwaway
harness outside the repository (no repository file was modified):

| Attempted layout | Outcome against the 8.2B §9 check |
|---|---|
| `radius/transport.js` containing `require("dgram")` | Suite reports `failed=1` — **regression** |
| `radius/transport/` subdirectory | `fs.readdirSync` yields the directory, then `fs.readFileSync()` throws `EISDIR` — **suite crashes** |

Phase 8.2C was also required to keep Phase 8.2B green and was forbidden from weakening it.
The conflict was therefore reported and resolved before any code was written.

### 1.2 Decision

| Layer | Path | Responsibility | Networking |
|---|---|---|---|
| Protocol / codec | `backend/services/radius/` | packet encode/decode, attributes, authenticators, password hiding (RFC 2865 §5.2), accounting normalization | **None** — invariant preserved |
| Transport / client | `backend/services/radiusTransport/` | UDP socket handling, profile validation, secret resolution, timeout/retry, request/response correlation, Access-Request + Accounting-Request transport, deterministic errors | Node `dgram` only, inside this layer |

The transport imports the protocol layer with `require("../radius")`. No cryptographic or
packet logic is duplicated: `generateRequestAuthenticator`, `computeResponseAuthenticator`,
`validateResponseAuthenticator`, `buildAccessRequestPacket`, `buildAccountingRequestPacket`,
`decodePacket` and the accounting normalization helpers are all consumed from Phase 8.2B.

### 1.3 Invariants explicitly preserved

- `check-roaming-phase8-2b.js` — **not modified**
- `check-roaming-phase8-2a.js` — **not modified**
- No file added, moved, or edited inside `backend/services/radius/`
- No `dgram`, `net`, or `radius` import inside `backend/services/radius/`
- `backend/services/radius/transport/` — **not created**
- No `package.json` dependency added (`dgram` is a Node built-in)

### 1.4 Interpretation of the 8.2A architecture statement

Phase 8.2A §18 lists "RADIUS protocol implementation — UDP socket layer" as an 8.2B
prerequisite. This is read as the *overall RADIUS subsystem*, with the protocol codec and the
transport separated into their respective layers. The 8.2A architecture document was **not**
amended to force the original wording. 8.2A §18's other prerequisites remain open: Secret
Manager wiring, the `radius_profiles` Firestore collection and its registration API, and the
`server.js` adapter-registration gate are all still deferred.

---

## 2. Layer Contents

```
backend/services/radius/            (unchanged — pure protocol, no networking)
    constants.js  authenticator.js  passwordHiding.js
    attributes.js packet.js         accounting.js  index.js

backend/services/radiusTransport/   (new — network/client layer)
    index.js        public facade
    errors.js       deterministic transport error model + AAA error mapping
    featureFlag.js  ROAMING_RADIUS_ENABLED boundary (default false)
    profile.js      RADIUS profile validation/normalization + in-memory store
    secrets.js      radiusSecretResolver abstraction (test impl + disabled prod impl)
    transport.js    UDP transport: correlation, timeout/retry, socket lifecycle
    client.js       sendAccessRequest / sendAccountingRequest structured results
```

---

## 3. Transport Design

### 3.1 RADIUS profile (Phase 8.2A §8 model)

Validated and frozen by `normalizeRadiusProfile`. Aliases accepted for the 8.2A field
names (`authServer`, `authPort`); canonical output uses `serverHost` /
`authenticationPort`.

| Field | Rule | Default |
|---|---|---|
| `profileId` | non-empty string | required |
| `nasIdentifier` | non-empty string | required |
| `nasIpAddress` | valid IPv4 or `"auto"` | `auto` |
| `serverHost` | valid IPv4 or hostname | required |
| `accountingHost` | valid IPv4 or hostname | `= serverHost` |
| `authenticationPort` | integer 1–65535 | `1812` |
| `accountingPort` | integer 1–65535 | `1813` |
| `coaPort` | integer 1–65535 | `3799` (unused in 8.2C) |
| `secretReference` | non-empty; rejected if it looks like secret material | required |
| `timeoutMs` | integer 100–30000 | `5000` |
| `retries` | integer 0–10 | `3` |
| `enabled` | boolean | `true` |

A numeric dotted-quad that is not a valid IPv4 (`999.1.1.1`, `1.2.3`) is rejected rather
than silently accepted as a hostname.

### 3.2 Secret handling

`radiusSecretResolver` is the only path to a shared secret. Three implementations:

| Implementation | Mode | Behaviour |
|---|---|---|
| `createStaticTestSecretResolver` | `static_test` | Synthetic in-memory map; refuses unregistered references |
| `createDisabledProductionSecretResolver` | `disabled_production` | Always fails `RADIUS_SECRET_UNAVAILABLE` |
| `createRadiusSecretResolver` | `custom` | Adapter for a future Secret Manager backend |

**The production implementation is intentionally disabled.** 8.2A §7 planned to reuse
`getProductionSecret()`, but that helper reads a single `process.env` variable and returns
a development fallback when `NODE_ENV !== "production"` — unsuitable for per-profile
RADIUS secrets. Rather than invent a production secret store, 8.2C ships the abstraction
and a disabled production stub. Secret Manager wiring stays an open 8.2A §18 prerequisite
and no `radius_profiles` Firestore collection or registration API was created.

### 3.3 Correlation and validation

Per exchange: one socket, bound to an ephemeral port, closed exactly once on every path.

A received datagram is accepted only if **all** hold:

1. source address equals the resolved destination IPv4 **and** source port equals the destination port — otherwise silently discarded (never resolves the request);
2. `decodePacket` succeeds — otherwise `RADIUS_PACKET_DECODE_FAILED`;
3. `identifier` matches the request — otherwise discarded;
4. `code` is in `expectedCodes` — otherwise `RADIUS_UNEXPECTED_PACKET`;
5. `validateResponseAuthenticator` (Phase 8.2B, RFC 2865 §3, `timingSafeEqual`) passes — otherwise `RADIUS_AUTHENTICATOR_INVALID`.

Identifiers come from `crypto.randomInt(0, 256)` and are held in an in-flight set so two
concurrent requests to one profile cannot share an identifier. **The identifier passed to
the transport is the same value baked into the packet** — an earlier revision allocated a
second random identifier for the transport, which silently discarded every valid response;
this is now covered by the acceptance tests.

Retransmission resends byte-identical packets (same identifier, same Request
Authenticator), which is RFC 2865 duplicate-detection behaviour. Retry never multiplies
sends: a single guarded attempt counter and a single re-armed timer bound the total to
`retries + 1`.

### 3.4 Error model

`RadiusTransportError` carries a `RADIUS_*` code and maps onto **existing Phase 8.1 codes
only** — no competing error system and no new production codes (8.2A §13).

| Transport code | AAA code | Status |
|---|---|---|
| `RADIUS_PROFILE_NOT_FOUND` | `ADAPTER_NOT_CONFIGURED` | 404 |
| `RADIUS_PROFILE_DISABLED` / `RADIUS_DISABLED` | `ADAPTER_DISABLED` | 503 |
| `RADIUS_NETWORK_ERROR` | `ADAPTER_UNAVAILABLE` | 503 |
| `RADIUS_UNSUPPORTED_OPERATION` | `ADAPTER_NOT_IMPLEMENTED` | 501 |
| `RADIUS_TIMEOUT`, `RADIUS_RETRY_EXHAUSTED`, `RADIUS_SECRET_UNAVAILABLE`, `RADIUS_CONFIG_INVALID`, `RADIUS_INVALID_RESPONSE`, `RADIUS_AUTHENTICATOR_INVALID`, `RADIUS_UNEXPECTED_PACKET`, `RADIUS_PACKET_DECODE_FAILED`, `RADIUS_DUPLICATE_IN_FLIGHT` | `ADAPTER_FAILURE` | 502 |

`RadiusTransportError.toAAAError()` produces a `RoamingAAAAdapterError`-shaped error for a
later AAA integration phase. `sanitizeDetails` redacts any key matching
`secret|password|passphrase|credential|token|authenticator|key`, and `toLogSafe()` is the
only representation intended for output.

---

## 4. Scope Boundaries Held

| Boundary | Status |
|---|---|
| `backend/services/radius/` modified | No — zero diff vs the 8.2B commit |
| `check-roaming-phase8-2b.js` / `check-roaming-phase8-2a.js` modified | No |
| `roamingEnforcementService` / `roamingSessionService` / Phase 6 flow modified | No |
| Any Phase 7 accounting, RAU, settlement, wallet, residual, expiry, payment, voucher, MTN, package file modified | No — `git diff HEAD` is empty for all tracked files |
| `package.json` dependency added | No |
| Production RADIUS enabled | No — `ROAMING_RADIUS_ENABLED` default `false`, read only inside `radiusTransport` |
| `ROAMING_RADIUS_ENABLED` in `server.js` or `.env` | No |
| RADIUS adapter registered in `server.js` | No |
| External / MikroTik / UniFi / TP-Link / Cisco / ISP RADIUS contacted | No — loopback test server only |
| CoA / Disconnect implemented | No — rejected as `RADIUS_UNSUPPORTED_OPERATION` |
| Passpoint / EAP / 802.1X | No |
| Firestore data created or modified | No |
| Mock AAA fallback | No — the layer has no reference to the mock adapter or the AAA registry |
| Commit / push | No |

---

## 5. Test Results

All executed from the repository root `C:\Users\user\wifi-automation`.

### Phase 8.2C

`node backend/scripts/check-roaming-phase8-2c.js` → **110 passed, 0 failed**
(repeatable: 3 consecutive identical runs).

| Group | Coverage |
|---|---|
| Layer separation | sibling layer exists, no `radius/transport/`, protocol layer free of `dgram` |
| Configuration | valid profile, invalid port/timeout/retries/host/NAS id, missing secret, secret-material rejection, 1812/1813 defaults, unknown profile |
| Boundaries | disabled profile, missing secret, disabled production resolver, flag off, test mode refused under `NODE_ENV=production`, zero sockets opened while disabled |
| Access-Request | accept, reject, authenticator validation, invalid authenticator, wrong identifier, malformed, unexpected code |
| Retry | timeout detection, retry count honoured (3 sends for `retries=2`), `retries=0` single attempt, recovery on attempt 2, no duplicate sends |
| Unavailable server | deterministic transport-level rejection |
| Accounting | Start / Interim / Stop transmitted and acknowledged, Accounting-Response validated, unsupported status type rejected |
| Security | no RAU/settlement/wallet/residual/Firestore/AAA coupling, secret absent from errors, password never returned, 7 client-supplied infra fields rejected, zero logging |
| Resource safety | socket closed exactly once after success, timeout, malformed response; construction exception mapped; no orphaned sockets; servers closed cleanly |

### Regression

| Suite | Result |
|---|---|
| Phase 8.2B | 113 passed, 0 failed |
| Phase 8.2A | 62 passed, 0 failed |
| Phase 8.1 | 88 passed, 0 failed |
| Phase 6 | 166 passed, 0 failed |
| Phase 7.3 | 69 passed, 0 failed |
| Phase 7.4 | 46 passed, 0 failed |
| Phase 7.5 | 25 passed, 0 failed |
| Phase 7.6A | 56 passed, 0 failed |
| Phase 7.6B | 38 passed, 0 failed |
| Phase 7.6C | 59 passed, 0 failed |
| Phase 7.6D | 101 passed, 0 failed |
| Phase 7.6E | 180 passed, 0 failed |
| Phase 7.6F.2 | 93 passed, 0 failed |
| Phase 7.6F.3 | 85 passed, 0 failed |
| Phase 7.6F.4 | 76 passed, 0 failed |
| Phase 7.7 | 101 passed, 0 failed |
| Phase 7.2B bridge-wire | 37 passed, 0 failed |
| Phase 7.2/7.2A rau-bridge | 61 passed, 0 failed |
| RAU calculation | 26 passed, 0 failed |
| Phase 4 | 175 passed, 0 failed |
| Phase 5 | 186 passed, 0 failed |
| Phase 2, Phase 3 | exit 0 |

**Total: 0 failed, 0 timed out. No test required Firestore.**

---

## 6. Out of Scope / Next

- AAA adapter integration (`radiusRoamingAAAAdapter`) — deferred, per instruction §14
- Secret Manager wiring for per-profile secrets — deferred
- `radius_profiles` Firestore collection and registration API — deferred
- `server.js` registration gate behind `ROAMING_RADIUS_ENABLED` — deferred
- MikroTik / UniFi / TP-Link / Cisco adapters, Passpoint/EAP, CoA/Disconnect — later phases
- Phase 8.3 — not started