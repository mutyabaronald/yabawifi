# Phase 8.3 - Decision Lock (RADIUS Profile, Session Propagation, Discovery Allowlist, AAA Adapter)

**Status:** DECISION LOCK ONLY - no code changes, no commit, no push
**Baseline commit:** `aae20771d3896ee521ae74c14ad4c23069e4af91` (`feat(roaming): add radius transport foundation`, pushed)
**Date:** 2026-10-04
**Predecessor documents:** `backend/phase8-2a-radius-architecture.md`, `backend/phase8-2c-radius-transport.md`

This document locks the Phase 8.3 decisions and records the evidence each one rests on. No
repository file other than this document was created, modified, or deleted.

---

## 1. Scope of This Lock

### 1.1 In scope (locked)

1. Trusted RADIUS profile abstraction and resolution
2. `radiusProfileId` propagation where required
3. Public hotspot discovery response allowlisting
4. `radiusRoamingAAAAdapter` supporting only `authenticate`, `authorize`, `checkHealth`
5. Dependency-injected profile store and secret resolver for tests
6. Security and regression coverage

### 1.2 Out of scope (locked out)

- `backend/server.js` changes or adapter registration
- Enforcement integration
- CoA
- `provisionAccess`, `revokeAccess`, `disconnect`, `getUsage`
- Firestore changes (including creation of a `radius_profiles` collection)
- Phase 8.4 work

---

## 2. D-1: `radiusProfileId` Propagation - OFF by Default, Phase-Gated, Allowlist-Driven

### 2.1 Verified current behavior

| Fact | Evidence |
|---|---|
| `radiusProfileId` is accepted from the **owner** registration payload as an arbitrary string, with no validation against any known profile | `roamingRegistryService.js:554-555` |
| `radiusProfileId` is **not** propagated into the roaming session record at all | `roamingSessionService.js:239-262` - the session record carries `aaaAdapterKey` but no `radiusProfileId` field |
| `aaaAdapterKey`, by contrast, **is** validated and **is** propagated | validated against `AAA_ADAPTER_KEYS` at `roamingSessionService.js:160-164`; written into the session at `roamingSessionService.js:252` |
| `radiusProfileId` **is** exposed to anonymous callers | see D-2 / DEFECT-8.3-01 |
| Client-supplied RADIUS config is already blocked on the session-creation path | `check-roaming-phase8-2a.js` section 12 fails the suite if the sessions route references `radiusProfileId`, `authServer`, `nasIdentifier`, `sharedSecret`, `nasIp` |
| No RADIUS profile registry exists | no profile module and no `radius_profiles` collection; `radius_profiles` exists only as a forward-looking table in `phase8-2a-radius-architecture.md` section 8 |

### 2.2 Decision

`radiusProfileId` propagation is **OFF by default in Phase 8.3**. The profile store is
dependency-injected only. No production profile store is created, because Firestore changes and
production wiring are both locked out of 8.3.

Consequence: in production after 8.3, every hotspot resolves to no profile override, and the
adapter falls back to the profile's own configured default. This is the intended and safe state.

### 2.3 Resolution predicate

A hotspot `radiusProfileId` is resolved into a session profile override only when **all four**
conditions hold:

1. The value is a string matching `/^[a-z0-9][a-z0-9_-]{0,63}$/i`
2. The value is present in the injected profile store
3. The hotspot `enforcementMode` is `radius`
4. The hotspot `aaaAdapterKey` resolves to a registered RADIUS adapter

If any condition fails, the override is **omitted entirely**. There is no partial resolution, no
passthrough of the raw string, and no fallback to an unvalidated value.

The resolved value is written to the session record as a server-resolved field. It is never read
from a client request body.

### 2.4 Why fail-open to the profile default

Failing **closed** would break every RADIUS-mode session until Phase 8.4 ships the real profile
registry, because no profile would ever resolve. Failing **open to the profile default** is safe:
the default is operator-chosen, server-side, and not attacker-influenced. The only thing the
unresolved path gives up is per-hotspot profile selection, which is a feature, not a security
boundary.

The four conditions above are the security boundary. Each one is independently sufficient to
prevent an attacker-chosen profile id from selecting infrastructure.

### 2.5 Security constraints

- No shared secret may appear in a profile store entry; only a `secretReference` is permitted
- No profile value may originate from a client request body
- No RADIUS shared secret may be written to `.env` or any repository file
- The profile store must be inert when not injected

---

## 3. D-2: Public Hotspot Discovery - Strict Server-Side Field Allowlist

### 3.1 Verified current behavior

`GET /api/roaming/hotspots/discover` is served by `routes/roaming/hotspots.js:9-16`. It applies
**no authentication**. It calls `roamingRegistryService.js:616-636`, which pushes
`{ id: doc.id, ...data }` - the entire raw `roaming_hotspots` document - into the response array.

### 3.2 DEFECT-8.3-01 (confirmed, must be fixed in 8.3)

The unauthenticated discovery response currently returns raw hotspot documents, which can include:

- `radiusProfileId` (raw operator-supplied string)
- `radiusNas` / `nasIdentifier` and other RADIUS infrastructure fields
- `ssid`, `bssid`, `wifiConfig`
- owner-controlled `networkIdentity` and `location` sub-objects in full
- `createdAt` / `updatedAt` / `lastIdempotencyKey` internal bookkeeping

This is a live information-disclosure surface and is the reason D-2 is in 8.3 scope rather than
deferred.

### 3.3 Consumer evidence

The only consumer is `frontend/src/components/SuperRoamingPanel.jsx:232-247`, which reads exactly:

| Field | Use |
|---|---|
| `hotspotId` | list key fallback and detail line |
| `id` | list key fallback |
| `ownerId` | detail line |
| `aaaAdapterKey` | detail line |
| `enforcementMode` | detail line |
| `networkIdentity.venueName` | display title |

The frontend also reads `discoverData.hotspots` and `discoverData.message` at lines 46 and 60.

### 3.4 Decision

Enforce a server-side allowlist. `discoverHotspots()` must project each document through an
explicit field list rather than spreading the raw doc.

**Keep:**

| Field | Note |
|---|---|
| `id` | frontend list-key fallback |
| `hotspotId` | |
| `ownerId` | |
| `aaaAdapterKey` | |
| `enforcementMode` | |
| `networkIdentity.venueName` | allowlisted sub-field only |
| `isDiscoverable` | |
| `partnerStatus` | |

**Drop (explicitly):**

| Field | Reason |
|---|---|
| `radiusProfileId` | raw operator config; also removed by D-1 |
| `radiusNas`, `nasIdentifier`, `authServer`, `authPort`, `accountingServer`, `accountingPort`, `coaPort` | RADIUS infrastructure |
| `ssid`, `bssid`, `wifiConfig`, `password` | network credential surface |
| `phone`, `email` | personal data |
| `secretReference`, `sharedSecret` | must never exist client-side |
| `createdAt`, `updatedAt`, `lastIdempotencyKey`, `disabledBy`, `disabledReason` | internal bookkeeping |
| any `networkIdentity` sub-field other than `venueName` | nested objects are not flattened |

`networkIdentity` is nested and must be re-projected explicitly; a shallow copy would leak
`venueAddress`, `contact`, or any future sub-field.

### 3.5 Enforcement

- The allowlist lives in one exported constant consumed by `discoverHotspots()`
- The 8.3 checker script asserts the response shape for a fixture containing every dropped field,
  proving none survive
- Existing suites are unaffected: the only reference to `discover` in any check script is
  `check-roaming-phase2.js:37`, which asserts the route name exists, not the payload shape

---

## 4. D-3: `radiusRoamingAAAAdapter` - Three Supported Methods, Four Explicit Fail-Closed

### 4.1 Verified contract

`roamingAAAAdapter.js` defines seven methods. Its base implementations all fail closed by
throwing `not_implemented`. `backend/services/adapters/mockRoamingAAAAdapter.js` is the only
concrete adapter and implements all seven. `roamingAAAAdapterRegistry.js` is an in-memory,
fail-closed Map, and `server.js:46-54` registers only the mock, gated by `ROAMING_MOCK_AAA_ENABLED`.

### 4.2 Decision

| Method | 8.3 status |
|---|---|
| `authenticate` | supported |
| `authorize` | supported |
| `checkHealth` | supported |
| `provisionAccess` | explicit fail-closed, `radius_method_not_supported` |
| `revokeAccess` | explicit fail-closed, `radius_method_not_supported` |
| `disconnect` | explicit fail-closed, `radius_method_not_supported` |
| `getUsage` | explicit fail-closed, `radius_method_not_supported` |

Fail-closed must be **explicit and distinguishable**. Silently returning success for an
unsupported method would let 8.4 enforcement code believe provisioning occurred.

### 4.3 Non-enforceability finding (not a defect)

The three-method limit **cannot be enforced in 8.3**, by design:

- Enforcement integration is locked out, and no in-repository caller invokes
  `provisionAccess`, `revokeAccess`, `disconnect`, or `getUsage`
- The four methods map to Phase 8.4 concerns: session provisioning and termination, CoA
  disconnect, and usage/quota reconciliation against the entitlement quota
  (`maxMinutes`, `maxMegabytes`, `usedMinutes`, `remainingMinutes` in
  `roamingEntitlementService.js`)
- Because `server.js` registration is also locked out, no production path can reach the RADIUS
  adapter in 8.3, so the unimplemented surface is unreachable in practice

This is recorded so that a later phase does not read 8.3's adapter as a finished
`roamingAAAAdapter` implementation.

### 4.4 Required tests

- Conformance test asserting exactly three methods succeed in principle and exactly four fail with
  `radius_method_not_supported`
- Test that the failure is never reported as success
- Test that no RADIUS shared secret value appears in any error message, log line, or thrown error
- Test that the adapter performs no networking outside `backend/services/radiusTransport/`

---

## 5. D-4: Injected Profile Store and Secret Resolver

### 5.1 Decision

Both dependencies are constructor-injected and default to inert. There is no module-level
fallback that reads Firestore, `.env`, or the filesystem.

| Dependency | Contract |
|---|---|
| Profile store | `getProfile(profileId)` returning a validated profile or `null`. Never throws for an unknown id. Never returns a profile containing a literal secret. |
| Secret resolver | `resolveSecret(secretReference)` returning a secret at call time. The reference is stored; the secret is not. |

### 5.2 Constraints

- `backend/services/radius/` remains a pure codec with **no** networking; UDP transport stays in
  `backend/services/radiusTransport/`
- The adapter consumes transport via injection, so it introduces no `dgram` import
- `check-roaming-phase8-2b.js` and `check-roaming-phase8-2a.js` must not be modified or weakened
- No `package.json` dependency is added

---

## 6. Carried-Forward Open Decisions (8.2A section 20) and 8.3 Disposition

| # | Decision | 8.3 disposition |
|---|---|---|
| 1 | RADIUS username format | **Deferred, and not blocking.** 8.2C's `sendAccessRequest({ userName, ... })` takes `User-Name` from the caller, so the adapter can be built and tested without a pseudonym. See the risk note below. |
| 2 | Session-Timeout semantics | Deferred to 8.4. Note `DEFAULT_SESSION_TTL_HOURS = 24` at `roamingSessionService.js:29`, overridden by entitlement expiry at `:135-144`. |
| 3 | Filter-Id / Class format | Deferred. 8.2B already carries opaque correlation data in `Class`. |
| 4 | Vendor-specific attributes | Deferred; 8.3 uses generic RADIUS attributes only. |
| 5 | Access-Reject mapping | Deferred; 8.3 maps to existing Phase 8.1 error codes, adds no new codes for auth. |
| 6 | Coexistence with mock | Deferred to 8.4. 8.3 does not register the RADIUS adapter at all. |
| 7 | Accounting interim interval | Deferred to 8.4 with accounting. |
| 8 | CoA vs Disconnect | Deferred to 8.4. |

### 6.1 Risk note on decision 1 (new evidence, not in 8.2A)

Two findings change the risk framing of the username decision and must be recorded before 8.4
picks an option:

1. **`sub` can be a phone number.** `routes/roaming/auth.js:74-113` resolves
   `db.collection("users").doc(phone)` and returns `userDoc.id` as `userId`. The data model
   agrees: `roamingSessionService.js:241-245` writes `userRef.phone = claims.sub` and
   `userRef.authType = claims.sub`. So option 1, `roaming:{userId}`, does not merely make the
   subscriber "traceable" as 8.2A described - it may place a **phone number** in the
   `User-Name` attribute sent to every visited RADIUS server.
2. **`jti` is single-use and short-lived.** `jti` is `crypto.randomBytes(16)` hex
   (`roamingAuthService.js:69-70`) with a default 180s TTL (`:23-24`), and token consumption marks
   it used for replay protection (`:522-606`). Using `jti` as the username is unlinkable but
   destroys roaming and accounting continuity, since every session presents a different identity.

Direction of travel, not yet locked: a stable HMAC pseudonym keyed on `(userId, homeOwnerId)` is
non-reversible, carries no PII, and stays stable across visited hotspots, which is what roaming and
accounting continuity require. Per-session uniqueness belongs in `Acct-Session-Id`, which already
exists. This requires a pseudonym key from the same unresolved secret backend, so it is deferred
with the secret work rather than decided here.

---

## 7. Correction to the Prior Phase Summary

The pre-8.3 working summary stated that `roamingSessionService.js` "stores string
`payload.radiusProfileId` values". That is **incorrect**. `radiusProfileId` appears in exactly two
places in the codebase:

- `roamingRegistryService.js:554-555` - written from the owner payload onto the hotspot document
- `check-roaming-phase8-2a.js:431` - a field name in the blocked-client-field list

It is not written into any roaming session record. The propagation gap in 8.3 is therefore a
**new** field on the session record, not a modification of an existing one.

---

## 8. Invariants Preserved

- `backend/server.js` unchanged - no adapter registration in 8.3
- `backend/services/radius/` unchanged - no networking, pure codec
- No `radius/transport/` subdirectory created
- `check-roaming-phase8-2a.js` and `check-roaming-phase8-2b.js` unmodified and green
- No Firestore schema or collection changes
- No `dgram`, `net`, `radius`, or `freeradius` dependency added
- No RADIUS shared secret in `.env` or any tracked file

---

## 9. Blockers and Phase 8.4 Exit Criteria

| Blocker | Blocks | Resolved by |
|---|---|---|
| No secret backend for `secretReference` | production registration, secret resolution | 8.4 secret manager wiring |
| No `radius_profiles` store | profile resolution beyond injected fixtures | 8.4 Firestore work |
| No `server.js` registration | any production RADIUS traffic | 8.4, gated by `ROAMING_RADIUS_ENABLED` |
| Username/pseudonym undecided (section 6.1) | production `User-Name` derivation | 8.4, needs the pseudonym key |

Phase 8.4 exit criteria, implied by this lock: D-1 turns on against a real profile store; D-2 is
verified against production data; D-3 gains the remaining four methods or a documented permanent
fail-closed contract; section 6 decisions are resolved.

---

## Summary

**PHASE 8.3 - DECISIONS LOCKED**

- `radiusProfileId` propagation: **off by default**, phase-gated, resolved only through an
  injected allowlisted store, four-condition predicate, omitted otherwise
- Public discovery: **strict server-side field allowlist**, closing DEFECT-8.3-01
- RADIUS adapter: **three methods supported, four explicitly fail-closed**, non-enforceability
  recorded as by-design
- Profile store and secret resolver: **constructor-injected, inert by default**
- All eight 8.2A open decisions carried forward with an explicit 8.3 disposition
- One confirmed information-disclosure defect and one correction to the prior phase summary
  recorded

No production files changed. No commit. No push.
