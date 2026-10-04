# Phase 8.3 — RADIUS Profile, Discovery Allowlist and AAA Adapter

**Status:** IMPLEMENTATION + LOCAL TEST ONLY — production RADIUS is **not** operational
**Baseline commit:** `aae20771d3896ee521ae74c14ad4c23069e4af91`
**Governing document:** `backend/phase8-3-decision-lock.md`
**Predecessors:** `backend/phase8-2a-radius-architecture.md`, `backend/phase8-2c-radius-transport.md`

---

## 1. What Phase 8.3 Delivers

| Deliverable | Path |
|---|---|
| Public discovery field allowlist | `backend/services/roamingRegistryService.js` |
| Trusted profile abstraction | `backend/services/radiusProfiles/` |
| RADIUS AAA adapter | `backend/services/adapters/radiusRoamingAAAAdapter.js` |
| Server-derived session profile field | `backend/services/roamingSessionService.js` |
| Regression checker | `backend/scripts/check-roaming-phase8-3.js` |

Phase 8.3 contains **no production RADIUS path**. The adapter is not registered, no Firestore
profile store exists, no secret backend exists, and `ROAMING_RADIUS_ENABLED` is not set.

---

## 2. Architecture

```
                      ┌───────────────────────────────────────────┐
  unauthenticated     │ roamingRegistryService.discoverHotspots() │
  GET /discover  ───► │  explicit allowlist projection (D-2)      │
                      └───────────────────────────────────────────┘

                      ┌───────────────────────────────────────────┐
  createRoamingSession│ roamingSessionService                     │
  (trusted hotspot) ─│  resolveRadiusProfileId(hotspot)  (D-1)    │
                      │  four-condition predicate                 │
                      └───────────────┬───────────────────────────┘
                                      │ injected (inert by default)
                                      ▼
                      ┌───────────────────────────────────────────┐
                      │ radiusProfiles/radiusProfileService       │
                      │  getProfile(id) → profile | null          │
                      │  reuses 8.2C normalizeRadiusProfile      │
                      └───────────────┬───────────────────────────┘
                                      │ injected
                                      ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ adapters/radiusRoamingAAAAdapter      (extends RoamingAAAAdapter)│
   │  authenticate · authorize · checkHealth        (supported)        │
   │  provisionAccess · revokeAccess · disconnect · getUsage           │
   │      → 501 radius_method_not_supported          (fail closed)      │
   └───────────────┬──────────────────────────┬───────────────────────┘
                   │ profileService           │ secretResolver
                   ▼                          ▼
        ┌─────────────────────┐      ┌──────────────────────────┐
        │ radiusTransport/    │      │ resolveSecret(reference) │
        │  client.js          │      │  static test resolver    │
        │  transport.js (dgram)│     │  disabled production one │
        └──────────┬──────────┘      └──────────────────────────┘
                   ▼
        ┌─────────────────────┐
        │ radius/  (codec only)│
        └─────────────────────┘
```

### 2.1 Layer rules preserved

- `backend/services/radius/` remains a pure protocol codec with **no** networking.
- `backend/services/radiusTransport/` remains the **only** layer that opens sockets. The adapter
  reaches it exclusively through `radiusTransport/client` and never imports `transport.js`
  directly.
- `backend/services/radiusProfiles/` contains no Firestore, `.env` or filesystem access.

---

## 3. Dependency Injection

The adapter takes three constructor dependencies and degrades to inert when they are absent:

| Dependency | Injected value when absent |
|---|---|
| `profileService` | `createRadiusProfileService()` — inert, every lookup returns `null` |
| `secretResolver` | `createDisabledProductionSecretResolver()` — always fails closed |
| `transportClient` | created lazily from the Phase 8.2C `createRadiusClient` |

`checkHealth()` reports exactly which dependencies are missing and never throws. It performs no
network I/O and stores no state.

The profile store is required lazily inside `_getTransportClient()` so that constructing an adapter
for tests or health checks does not pull the UDP layer into the module graph.

---

## 4. Profile Resolution

### 4.1 Profile service

`getProfile(profileId)` returns a normalized, frozen profile or `null`.

- `null` is returned for an unknown id, a malformed id, a non-string id, and for any store error
  that signals "not configured". **An unknown profile never throws.**
- Structural problems with a *known* profile (bad port, bad timeout, bad retries, missing NAS
  identifier, a `secretReference` that looks like secret material, a literal secret field, or any
  field outside the allowed set) throw `RADIUS_CONFIG_INVALID`.
- Validation is **not** duplicated. Every rule comes from the Phase 8.2C
  `normalizeRadiusProfile`; the service only adds the allowlist, the literal-secret rejection and
  the type pre-check.
- `enabled` is reported, not enforced. Enablement is the adapter's decision, matching the Phase
  8.2C client flow of `getProfile()` followed by `assertProfileUsable()`.

### 4.2 Adapter resolution order

1. `radiusProfileId` must be a string matching `/^[a-z0-9][a-z0-9_-]{0,63}$/i`, else
   `RADIUS_PROFILE_NOT_FOUND` → `ADAPTER_NOT_CONFIGURED` / 404.
2. `profileService.getProfile()` — `null` becomes `RADIUS_PROFILE_NOT_FOUND` → 404.
3. `assertProfileUsable(profile)` — a disabled profile becomes `RADIUS_PROFILE_DISABLED` →
   `ADAPTER_DISABLED` / 503.

A profile object supplied by a caller is never trusted. The only accepted source is the injected
store.

### 4.3 Session propagation (D-1)

`roamingSessionService.resolveRadiusProfileId(hotspot)` applies the locked four-condition
predicate. All four must hold:

1. the stored value matches the id pattern;
2. the id resolves in the injected profile store, and the returned profile's own `profileId`
   matches;
3. `hotspot.enforcementMode === "radius"`;
4. `hotspot.aaaAdapterKey` is `"radius"` **and** an adapter with that key is present in the AAA
   adapter registry.

If any condition fails, `null` is returned and the session record omits the `radiusProfileId`
key entirely. The raw stored string is never persisted, never partially resolved and never
trusted. The resolver defaults to inert, and because `backend/server.js` registers no RADIUS
adapter, condition 4 fails in production — so the field cannot be activated before Phase 8.4.

---

## 5. Security Boundaries

| Boundary | Enforcement |
|---|---|
| Public discovery cannot leak infrastructure, credentials or internals | explicit field allowlist in `toPublicDiscoveryEntry`, nested `networkIdentity` re-projected field by field |
| No RADIUS infrastructure from clients | Phase 8.2A route guard, plus `assertNoClientSuppliedConfig` on every adapter context |
| No literal secrets in profiles | forbidden-field rejection plus the Phase 8.2C `secretReference` material check |
| No secret in adapter state | secret requested per call from the resolver; the adapter never assigns it to `this` |
| No secret in errors or logs | Phase 8.2C `sanitizeDetails` / `sanitizeMessage`; the adapter contains no `console.*` call at all |
| No firewall/portal/settlement semantics changed | adapter surface is AAA-only; no RAU, quota, wallet or captive-portal code was touched |

---

## 6. Supported and Unsupported Capabilities

| Method | Capability | 8.3 behaviour |
|---|---|---|
| `authenticate` | `true` | Access-Request through the Phase 8.2C client; Access-Accept → `authenticated: true`, Access-Reject → `authenticated: false` |
| `authorize` | `true` | Evaluates the received result and surfaces Session-Timeout / Filter-Id as **observations only** |
| `checkHealth` | `true` | Dependency and gate reporting; no network, no state |
| `provisionAccess` | `false` | 501 `radius_method_not_supported` |
| `revokeAccess` | `false` | 501 `radius_method_not_supported` |
| `disconnect` | `false` | 501 `radius_method_not_supported` |
| `getUsage` | `false` | 501 `radius_method_not_supported` |

The four unsupported methods never resolve and never report success. Their failure is
distinguishable from the base `ADAPTER_NOT_IMPLEMENTED` default so Phase 8.4 enforcement code
cannot mistake them for implemented behaviour.

### 6.1 Why the three-method limit is not enforceable yet

Nothing in the repository invokes `provisionAccess`, `revokeAccess`, `disconnect` or `getUsage`;
enforcement integration is Phase 8.4. Because the adapter is also not registered in
`backend/server.js`, the unimplemented surface is unreachable in production. This is recorded so
that a later phase does not read the 8.3 adapter as a finished `RoamingAAAAdapter`.

---

## 7. Authorization Semantics

RADIUS is an **authorization input**. YabaLink remains authoritative.

- `authorize()` derives `authorized` solely from Access-Accept versus Access-Reject.
- `authorized` never implies quota. The result carries `authoritativeForQuota: false`.
- `observedAttributes.appliedToSession` is always `false`: Session-Timeout, Filter-Id and Class
  semantics are deferred to Phase 8.4.
- No vendor-specific attribute is sent or required. Only the generic attributes the Phase 8.2B
  codec already supports are used.
- No entitlement, RAU, settlement, wallet or expiry code was modified.

---

## 8. Username Decision — Deferred to Phase 8.4

Phase 8.3 makes **no** username or pseudonym decision.

- `context.userName` is supplied by the trusted internal caller and is passed through unchanged.
- The adapter never derives a username from `userRef`, `phone`, `userId`, `jti`, `entitlementId`
  or any other subscriber identifier.
- No `roaming:{userId}` form, no jti-as-username and no HMAC pseudonym exists in this phase.

This is deliberate. `routes/roaming/auth.js` resolves `db.collection("users").doc(phone)` and
returns that document id as `userId`, and `roamingSessionService` stores the JWT `sub` in
`userRef.phone`. A username derived from that value could place a **phone number** in the
`User-Name` attribute sent to every visited RADIUS server. Phase 8.4 must pick a scheme, and it
needs a pseudonym key from the secret backend before it can.

---

## 9. Secret Management — Deferred to Phase 8.4

- Profiles carry `secretReference` only. A literal secret in a profile is rejected.
- The adapter requests the secret through `resolveSecret(secretReference)` at call time.
- The default resolver is `createDisabledProductionSecretResolver()`, which always fails closed.
- Tests use `createStaticTestSecretResolver` with a synthetic value.
- No production secret storage, `.env` entry, Firestore write or repository file was created.

Phase 8.4 owns the production secret backend.

---

## 10. Relationship to Phase 8.2C

Phase 8.3 consumes Phase 8.2C unchanged and adds no protocol or transport code:

- profile validation and normalization — `radiusTransport/profile.js`
- Access-Request exchange, identifier allocation, timeout, bounded retry, response validation —
  `radiusTransport/client.js` and `transport.js`
- error codes and the AAA error mapping — `radiusTransport/errors.js`
- the `ROAMING_RADIUS_ENABLED` gate — `radiusTransport/featureFlag.js`

The adapter's feature-flag handling is inherited: because `ROAMING_RADIUS_ENABLED` is unset, every
exchange fails closed with `RADIUS_DISABLED`. Phase 8.3 tests pass `testMode: true` explicitly.

---

## 11. Relationship to Phase 8.4

| Phase 8.4 must resolve | Current 8.3 state |
|---|---|
| Production profile store | injected only; no Firestore implementation exists |
| Production secret backend | fail-closed default resolver |
| Adapter registration in `server.js` | not registered; no flag activated |
| Username / pseudonym scheme | caller supplies `context.userName` |
| `provisionAccess` / `revokeAccess` | fail closed |
| `disconnect` / CoA | fail closed |
| `getUsage` / accounting reconciliation | fail closed |
| Session-Timeout, Filter-Id, Class semantics | surfaced as observations, never applied |

---

## 12. Explicit Non-Claims

- Production RADIUS is **not** operational.
- No RADIUS traffic can leave a YabaLink deployment from this phase.
- No live RADIUS server, NAS or vendor integration was contacted or simulated beyond a loopback
  test server in the checker.
- No Firestore collection, index, rule or data was added.
- `backend/server.js`, `backend/services/radius/`, `check-roaming-phase8-2a.js`,
  `check-roaming-phase8-2b.js` and `backend/package.json` are unmodified.

---

## Summary

**PHASE 8.3 — COMPLETE**

Discovery allowlist, trusted profile abstraction, three-method RADIUS AAA adapter and server-derived
session profile propagation implemented with dependency injection and fail-closed defaults.
Username derivation, secret backend, profile store and adapter registration remain Phase 8.4 work.
