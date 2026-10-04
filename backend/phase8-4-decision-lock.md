# Phase 8.4 — Decision Lock (RADIUS Production Integration)

**Status:** DECISION LOCK PREPARATION ONLY — no code, no Firestore, no dependencies, no registration, no flag changes, no commit, no push
**Baseline commit:** `a6f5469234e1cbb67850b4ed77527ef29a9a9dda` (Phase 8.3 Decision Lock)
**Implementation baseline:** `7a345c4d91040e50ad272a51d40d8bde7666cc31` (`feat(roaming): add radius AAA adapter foundation`)
**Source of truth:** `backend/phase8-4-radius-production-architecture-discovery.md`
**Predecessor locks:** `backend/phase8-3-decision-lock.md`
**Date:** 2026-10-04

Nothing in this document is approved. Nothing in this document is implemented. This document exists so that Phase 8.4 decisions can be reviewed and approved *before* any code is written.

---

## Tag vocabulary

Every statement below carries one of four tags:

| Tag | Meaning |
|---|---|
| **FACT** | Verified in the repository at the baseline commit, with file:line evidence |
| **ARCHITECTURAL RECOMMENDATION** | A position proposed for approval. Not in effect. |
| **OPEN DECISION** | Cannot be safely decided from repository evidence alone |
| **DECISION REQUIRED BEFORE IMPLEMENTATION** | No implementation of the affected sub-phase may begin until this is resolved and approved |

### REC numbering cross-reference

**This document renumbers the recommendations relative to the discovery report.** The mapping is recorded here so the two documents are not confused:

| This document | Discovery report | Subject |
|---|---|---|
| REC-1 | REC-1 | Enforcement capability model |
| REC-2 | §21 8.4H | Adapter lifecycle / registration |
| REC-3 | §14 | Production activation boundary |
| REC-4 | REC-3 | Profile ownership model |
| REC-5 | OD-4 / §4H | Secret backend provider |
| REC-6 | REC-5 | Secret reference / NAS-key model |
| REC-7 | REC-7 / OD-1 | EAP/802.1X vs PAP |
| REC-8 | §5 | Identity model |
| REC-9 | §6 | Credential lifecycle |
| REC-10 | REC-2 | Session correlation |
| REC-11 | REC-8 | Accounting / RAU authority |
| REC-12 | REC-10, REC-11 | CoA / Disconnect / `getUsage` scope |

Two discovery-report locks have no REC number in this document because they are not Phase 8.4 decisions:

| Discovery report | Subject | Where it is handled here |
|---|---|---|
| **REC-4** | Profile store holds configuration only, never secret material | Folded into REC-5 §7.2 and REC-6 §8.1 as an invariant |
| **REC-9** | No phone number, `userId` or `sub` ever reaches RADIUS | Folded into REC-8 §10.2 as a hard rule |
| **REC-12** | Rotate the Firebase service-account key and purge it from history before any production RADIUS claim | §22 — pre-existing credential hygiene, **not a Phase 8.4 decision** |

Sections 15–24 are topical consolidation, not additional RECs.

---

## 1. Status / Baseline

- **FACT.** `HEAD` and `origin/main` are both `a6f5469234e1cbb67850b4ed77527ef29a9a9dda`.
- **FACT.** The working tree is identical to that commit for all tracked files. No application file is modified.
- **FACT.** Phase 8.3 shipped: a RADIUS protocol codec, a UDP transport, a profile abstraction, and a three-method AAA adapter. 234 assertions pass in `check-roaming-phase8-3.js`.
- **FACT.** The RADIUS adapter is **implemented, unregistered, and production-disabled**.
- **FACT.** No RADIUS traffic can leave a YabaLink deployment. `ROAMING_RADIUS_ENABLED` defaults `false` (`backend/services/radiusTransport/featureFlag.js:4`), and `assertRadiusTransportEnabled` throws `RADIUS_DISABLED` (`featureFlag.js:16–28`).
- **FACT.** Production RADIUS remains disabled and must remain disabled until §17 is satisfied and approved.

---

## 2. Scope of Phase 8.4

### 2.1 In scope (proposed)

1. Enforcement capability model correction (REC-1)
2. Adapter lifecycle and registration sequencing (REC-2)
3. Production activation boundary and gate (REC-3)
4. RADIUS profile ownership model (REC-4)
5. Production secret backend and secret reference model (REC-5, REC-6)
6. EAP/802.1X vs PAP determination (REC-7 / OD-1)
7. RADIUS identity model (REC-8)
8. Credential lifecycle (REC-9)
9. Session correlation contract (REC-10)
10. Accounting/RAU authority confirmation (REC-11)
11. CoA / Disconnect / `getUsage` scope determination (REC-12)
12. Observability and audit fields
13. Rollback and migration procedure

### 2.2 Explicitly out of scope

- Passpoint / Hotspot 2.0
- 802.1X, EAP, WPA2/WPA3-Enterprise, ANQP
- SIM-based or certificate-based authentication
- Any change to package, payment, MTN, voucher, wallet, commission or loyalty logic
- Any change to the captive portal or `wifi_sessions`
- Any change to Phase 7 RAU, settlement, credit or residual authority
- Any new npm dependency, unless a sub-phase explicitly requires and justifies one
- Production activation

### 2.3 The honest position

- **FACT.** The discovery report concluded: *"Phases 8.1–8.3 built a complete, well-tested, unreachable RADIUS stack. The gap between 'the code exists' and 'production RADIUS works' is not more RADIUS code — it is a secret backend, an identity model, a credential model, one enforcement-model change, and a set of security remediations that predate RADIUS entirely."*
- **FACT.** Of the 12 production blockers recorded in the discovery report, 10 are decisions or infrastructure rather than implementation.
- **ARCHITECTURAL RECOMMENDATION.** Phase 8.4 should be treated as a decision-and-infrastructure phase, not a code phase. The only unambiguous code change identified is REC-1.

---

## 3. REC-1 — Enforcement Capability Model

### 3.1 Current structural behaviour

- **FACT.** `resolveAdapterForSession` at `backend/services/roamingEnforcementService.js:139` is the single resolution gate for all four enforcement operations: `provisionSessionEnforcement` (`:218`), `revokeSessionEnforcement` (`:436`), `disconnectSessionEnforcement` (`:572`) and `getSessionUsage` (`:700`).
- **FACT.** That gate contains an unconditional requirement for the `provisionAccess` capability:

```js
187:   if (typeof adapter.provisionAccess !== "function") {
188:     throw new RoamingEnforcementError(
189:       501,
190:       "ADAPTER_NOT_IMPLEMENTED",
191:       `Adapter '${key}' does not implement required enforcement methods`
192:     );
193:   }
194:
195:   const caps = typeof adapter.getCapabilities === "function" ? adapter.getCapabilities() : {};
196:   if (caps && caps.provisionAccess === false) {
197:     throw new RoamingEnforcementError(
198:       501,
199:       "ADAPTER_NOT_IMPLEMENTED",
200:       `Adapter '${key}' does not support provisionAccess capability`
201:     );
202:   }
```

- **FACT.** The Phase 8.3 RADIUS adapter declares `provisionAccess: false` by contract (`backend/services/adapters/radiusRoamingAAAAdapter.js:80–88`, `provisionAccess: false` at `:83`), enforced by the checker at `check-roaming-phase8-3.js` section 4.
- **FACT — the consequence.** Adapter capability requirements structurally prevent operation-specific use when the adapter does not implement every enforcement method. Because the gate is adapter-scoped rather than operation-scoped, a `provisionAccess: false` adapter cannot reach `revokeAccess`, `disconnect` or `getUsage` either — even for operations it could legitimately support.
- **FACT.** This has never been exercised: `server.js` registers only the mock adapter, and only under `ROAMING_MOCK_AAA_ENABLED` (default `false`). The mock implements all seven methods, so it always passes the gate.
- **FACT.** All enforcement routes are live HTTP and mounted (`server.js:236`; `routes/roaming/enforcement.js:111`, `:149`, `:192`, `:223`, `:254`). None is dead code.
- **FACT.** `checkEnforcementHealth` (`:769`) resolves the adapter at `:788` and does **not** gate on capability, so health reporting is the one enforcement path that could function with the RADIUS adapter.

### 3.2 Proposed alternative

- **ARCHITECTURAL RECOMMENDATION.** Enforcement should evaluate capability **per operation**, using the capability-check mechanism that already exists in the same file — `checkAdapterCapability` (`roamingEnforcementService.js:207–216`) — rather than requiring unrelated capabilities at adapter resolution time.
- **FACT.** `checkAdapterCapability` is already defined and already used for per-operation checks. Relaxing `:187–202` would make the existing mechanism the single gate instead of a second, broader one.
- **ARCHITECTURAL RECOMMENDATION.** `backend/services/roamingAAAAdapter.js` should not be modified. The seven-method interface and its fail-closed base defaults are correct and were deliberately locked in Phase 8.3.
- **ARCHITECTURAL RECOMMENDATION.** Alternatives were considered and are recorded for completeness:
  - *(b)* Implement `provisionAccess` on the RADIUS adapter — **rejected**, contradicts the Phase 8.3 lock and is semantically wrong, because an Access-Accept already constitutes provisioning.
  - *(c)* Introduce a second "authorize-only" adapter contract — **not recommended**, adds interface surface and a second thing to keep in sync, for no behavioural gain.

### 3.3 Security implications of each choice

| Choice | Security implication |
|---|---|
| **Keep current gate** | Maximum fail-closed safety for the mock adapter. But it makes a legitimate authorize-only adapter structurally unusable, which will pressure a future phase into either weakening the gate ad hoc or faking `provisionAccess: true`. **The pressure to fake success is the actual risk.** |
| **Per-operation gate (recommended)** | Fail-closed semantics are preserved exactly: an operation the adapter does not support still returns 501 `ADAPTER_NOT_IMPLEMENTED`, via the existing `checkAdapterCapability`. The change is that an unsupported *unrelated* operation no longer blocks an unrelated *supported* one. Risk: a careless implementation could delete the gate instead of narrowing it — mitigated by requiring the per-operation check to remain. |
| **New adapter contract** | Highest surface area. Two contracts to maintain, two sets of tests, and the RADIUS adapter would still need a contract. Not justified by one adapter. |

- **FACT.** Independently of REC-1, no production caller can currently supply the context the RADIUS adapter requires. `RoamingAAAAdapter.buildContext` (`roamingAAAAdapter.js:116–133`) emits neither `userName` nor `password`, so `authenticate` would fail validation even with the gate relaxed. REC-1 is necessary but not sufficient.

### 3.4 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of sub-phase 8.4A.**

- Not approved.
- Not implemented.
- **DECISION REQUIRED BEFORE IMPLEMENTATION:** approve the per-operation capability model, or specify an alternative.

---

## 4. REC-2 — RADIUS Adapter Lifecycle / Registration

### 4.1 Intentional Phase 8.3 end state

- **FACT.** Phase 8.3 deliberately left the RADIUS adapter implemented, unregistered and production-disabled. This was a locked decision, not an oversight.
- **FACT.** `server.js` contains zero references to `radiusRoamingAAAAdapter` or `ROAMING_RADIUS_ENABLED`.
- **FACT.** The Phase 8.3 checker actively asserts this state:
  - `check-roaming-phase8-3.js:1483–1487` — `server.js` must not reference `radiusRoamingAAAAdapter`
  - `check-roaming-phase8-3.js:1491–1492` — `server.js` must not contain `ROAMING_RADIUS_ENABLED = true`
  - `check-roaming-phase8-2a.js:205–206`, `:250–251` — the same assertions
- **FACT.** The registry (`roamingAAAAdapterRegistry.js`) is an in-memory, fail-closed Map. `unregisterAAAAdapter` already exists and is exercised by the 8.3 checker, so runtime deregistration needs no new code.

### 4.2 Consequence for Phase 8.4

- **FACT.** Any Phase 8.4 work that registers the adapter or sets the flag **will fail the existing regression suites**. This is intentional and must remain a deliberate, reviewed act.
- **ARCHITECTURAL RECOMMENDATION.** Registration must not be coupled to `ROAMING_RADIUS_ENABLED`. Use a **separate** registration flag, so that registration, profile resolution and the transport can each be disabled independently during an incident.
- **ARCHITECTURAL RECOMMENDATION.** Registration must be the **last** sub-phase, after REC-4 through REC-10 are resolved and approved.

### 4.3 Required future activation sequence

- **ARCHITECTURAL RECOMMENDATION.** The sequence below is derived from the discovery report's dependency ordering and must not be reordered:

1. REC-1 resolved and approved — enforcement can resolve an authorize-only adapter.
2. REC-10 implemented and tested — the adapter emits a correlatable identity, and an unknown correlation identifier can be dropped and audited.
3. REC-4 implemented and tested — profile ownership enforced; cross-owner reference impossible.
4. REC-5 and REC-6 resolved and implemented — a real secret backend exists and is proven to work.
5. REC-7 answered, then REC-8 and REC-9 implemented — identity and credential exist and are proven not to leak PII.
6. Observability and audit fields implemented.
7. Registration flag introduced, defaulted off.
8. `ROAMING_RADIUS_ENABLED` remains **false** until the §17 gate is separately approved.

- **ARCHITECTURAL RECOMMENDATION.** No new activation mechanism should be introduced. The existing `radiusTransport/featureFlag.js` gate is the transport boundary and should remain the single transport kill switch; the new element is a registration flag only, defaulting to off.

### 4.4 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of the registration sub-phase.**

- **ARCHITECTURAL RECOMMENDATION** on record: dedicated registration flag, default off, sequenced last, existing transport gate unchanged.

---

## 5. REC-3 — Production Activation Boundary

### 5.1 Current state

- **FACT.** Production RADIUS is disabled and cannot be enabled by any existing code path.
- **FACT.** The transport gate throws `RADIUS_DISABLED` when `ROAMING_RADIUS_ENABLED` is false (`featureFlag.js:16–28`). The only bypass is `options.testMode === true` combined with `NODE_ENV !== "production"` (`featureFlag.js:13`, `:20–22`).
- **FACT.** No `radius_profiles` collection, index or rules file exists. The repository has no `firestore.rules` and no `firestore.indexes.json` at all.
- **FACT.** The production secret resolver always throws (`radiusTransport/secrets.js:51–69`).

### 5.2 Boundary proposal

- **ARCHITECTURAL RECOMMENDATION.** The activation boundary should be defined as **two independent approvals**, not one:
  1. **Readiness approval** — every gate in §17 satisfied and verified.
  2. **Activation approval** — an explicit, separately recorded decision to set the flag.
- **ARCHITECTURAL RECOMMENDATION.** Readiness without activation is the normal steady state and should be a comfortable place to sit. There is no operational pressure that should make activation automatic once readiness is met.

### 5.3 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of the activation sub-phase.**

---

## 6. REC-4 — RADIUS Profile Ownership Model

### 6.1 Entities and current relationships

- **FACT.** An **App Owner** is a super-admin; owner-facing routes authenticate via `authenticateOwnerOrSuper` (`roamingRegistryService.js:115`).
- **FACT.** A **hotspot** is `roaming_hotspots/{hotspotId}`, owned via `ownerId`, and carries `partnerStatus`, `enforcementMode`, `aaaAdapterKey` and `radiusProfileId`.
- **FACT.** `radiusProfileId` is written to the hotspot document from the **owner-supplied registration payload as an arbitrary string, with no pattern check, no existence check and no ownership check** (`roamingRegistryService.js:554–555`).
- **FACT.** Phase 8.3 added **read-time** validation only: `resolveRadiusProfileId` (`roamingSessionService.js:50–70`) applies the four-condition predicate at `:53–57` and `:61–67` — id pattern, `enforcementMode === "radius"`, a registered RADIUS adapter, and that the id resolves in the injected profile store to a matching profile.
- **FACT.** `resolveRadiusProfileId` performs **no owner comparison**, and `radiusProfileService.getProfile` is owner-agnostic. This is the recorded gap.
- **FACT.** The Phase 8.3 profile shape has **no owner field at all**. The 12 normalized fields are `profileId`, `nasIdentifier`, `nasIpAddress`, `serverHost`, `authenticationPort`, `accountingHost`, `accountingPort`, `coaPort`, `secretReference`, `timeoutMs`, `retries`, `enabled`.

### 6.2 Required ownership model

- **ARCHITECTURAL RECOMMENDATION.** A future `radius_profiles` document must carry an **authoritative `ownerId`**, and this is a **new field relative to Phase 8.3**. The absence of an owner on the profile is precisely the gap.
- **ARCHITECTURAL RECOMMENDATION.** Ownership must be enforced at **two** points:
  1. **Write time** — when an owner sets `radiusProfileId` on a hotspot, verify the profile exists and `profile.ownerId === hotspot.ownerId`.
  2. **Resolution time** — `resolveRadiusProfileId` must additionally compare `profile.ownerId === hotspot.ownerId`.
- **ARCHITECTURAL RECOMMENDATION — rationale for both points.** Write-time validation prevents a stored cross-owner reference that would silently fail at runtime, which is confusing and acts as a probe for the existence of other owners' profiles. Resolution-time validation is defence in depth, and is the point that actually protects the RADIUS path.

### 6.3 Explicit prohibitions — one owner must not be able to

| Prohibition | Current state | Required |
|---|---|---|
| **Reference another owner's profile** | **NOT PREVENTED.** No owner check exists at write or resolution time | Enforced at both points (§6.2) |
| **Use another owner's NAS credentials** | **NOT PREVENTED** — follows directly from the gap above; `secretReference` resolution is owner-agnostic | Prevented by the owner check plus an owner-scoped `secretReference` naming convention (REC-6) |
| **Cause traffic through another owner's RADIUS configuration** | **NOT PREVENTED** — `authServer`/`nasIpAddress` are taken from whichever profile resolves | Prevented by the owner check |
| **Read another owner's secret reference or secret material** | **PARTIALLY MITIGATED.** No owner-facing route returns a profile's configuration at all, so there is currently nothing to read. But equally there is no way for an owner to verify their own profile. | No route may return another owner's `secretReference`; **the secret itself must never be readable through any API, by anyone, including the App Owner** |
| **Modify another owner's profile** | **NOT PREVENTED** — no store, no rules, no authorization layer exists | Firestore rules limited to super-admin, plus server-side owner checks on every mutation |

- **ARCHITECTURAL RECOMMENDATION.** Profile **mutation** should be super-admin only. An owner may *reference* a profile they own, but must not be able to create, edit or delete profiles — because `authServer` and `nasIpAddress` control where subscriber credentials and Access-Requests are transmitted. Handing an owner write access to those fields is handing them the ability to redirect subscriber authentication.
- **OPEN DECISION.** Whether `radiusProfileId` should remain a free-form string on the hotspot document, or whether hotspots should instead reference a profile by an App-Owner-issued opaque binding. Free-form is simpler; a server-issued binding is stronger because the operator never handles a profile identifier at all.

### 6.4 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of the profile-store sub-phase.**

---

## 7. REC-5 — Secret Backend Provider

### 7.1 Discovery findings — what exists

- **FACT.** There is **no encryption at rest anywhere in the repository**. No `crypto.createCipheriv`/`createDecipheriv`, no AES-GCM, no envelope encryption, no KMS client.
- **FACT.** No Google Secret Manager client (`@google-cloud/secret-manager`), no Google Cloud KMS client (`@google-cloud/kms`), no `google-auth-library`.
- **FACT.** `getProductionSecret(envVar, devDefault, name)` (`passwordService.js:26–36`) reads `process.env` and throws if `NODE_ENV === "production"` and the value is missing or equals the dev default. It performs **no strength validation**.
- **FACT.** `render.yaml` declares exactly two environment variables: `NODE_ENV=production` and `PORT=10000`. Every other secret is a Render dashboard value. No secret files, no mounted secrets, no managed-store reference.
- **FACT.** Existing secrets are: JWT signing secrets (`ROAMING_AUTH_JWT_SECRET`, `SUPERADMIN_JWT_SECRET`), HMAC signing keys for vouchers and MTN webhooks, and MTN/Airtel/Twilio/Cloudinary credentials — all environment variables.
- **FACT.** `devices.sshPassword` and `devices.enablePassword` are stored in **plaintext** in Firestore and consumed by `ciscoService.js`.
- **FACT.** `backend/serviceAccountKey.json` is committed to the repository and contains a Firebase service-account private key.
- **FACT.** RADIUS secret seams already exist: `createStaticTestSecretResolver` (`secrets.js:26–49`, `mode: "static_test"`, `isProduction: false`), `createDisabledProductionSecretResolver` (`:51–69`, always throws), and `createRadiusSecretResolver(resolveFn)` (`:71–93`, `isProduction` opt-in).

### 7.2 Invariants to preserve — non-negotiable

These are carried from the Phase 8.3 lock and the discovery report, and are restated here as hard constraints on any provider choice:

- **Secrets must never be stored in repository source.**
- **Secrets must never be exposed to clients** — no route, no response, no error payload.
- **Secrets must never be placed in `roaming_sessions`.**
- **Secrets must never be included in JWTs** — including the roaming JWT.
- **Secrets must never be logged**, at any level, including debug.
- **Secret material must remain separate from RADIUS profile configuration** — the profile carries a reference only. This is already enforced in code at `radiusProfiles/radiusProfileService.js:44–52` (throwing at `:106–116`) and `radiusTransport/profile.js:80–107`.

### 7.3 Provider decision

- **OPEN DECISION.** The discovery report explicitly declined to select a provider, recording that no client library for any candidate is currently a dependency and that the choice is a deployment/infra decision. That position is preserved. **No provider is selected here.**
- **ARCHITECTURAL RECOMMENDATION — the constraint, not the answer.** Whatever provider is chosen must satisfy:
  - per-NAS values (a single environment variable cannot express a multi-owner federation)
  - startup self-validation that fails construction when misconfigured
  - no caching of failed lookups
  - a version signal that does not reveal the secret
  - support for a reference-pinned, value-versioned rotation (§7.6)
  - an audit trail of access and rotation that excludes secret material
- **FACT.** Google Secret Manager is the natural fit given the Firebase/Google Cloud footprint, but it is **not** selected here, and selecting it would add a dependency — which is out of scope for this document.
- **OPEN DECISION.** Whether any narrower interim option is acceptable for a closed pilot — for example a single injected secret for a single known NAS, supplied through the existing dependency-injection seam with no Firestore and no environment file. This may be defensible for a pilot. It must not become the production design, and it must not be extended to more than one device.

### 7.4 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of the secret-backend sub-phase.**

---

## 8. REC-6 — Secret Reference / NAS-Key Model

### 8.1 Reference model

- **FACT.** `radiusProfileService` accepts exactly one secret-bearing field: `secretReference` (`radiusProfiles/radiusProfileService.js:38`, string-typed at `:62`, and rejected as literal material by `FORBIDDEN_PROFILE_FIELDS` at `:44–52` throwing at `:106–116`). The transport-side validation is at `radiusTransport/profile.js:238–241`.
- **FACT.** `looksLikeSecretMaterial` (`radiusTransport/profile.js:80`) causes a reference that resembles encoded secret material to be rejected (`:100`).
- **ARCHITECTURAL RECOMMENDATION.** The reference should be **opaque and NAS-scoped**, for example `nas/{nasIdentifier}/radius-shared-secret`. Rationale: an owner-scoped or free-form reference permits cross-owner probing; a NAS-scoped reference makes the device binding explicit and makes a foreign reference detectable.
- **ARCHITECTURAL RECOMMENDATION.** The reference should carry a **version**, so rotation advances the version behind a stable reference rather than mutating the reference itself. This keeps `radius_profiles` documents immutable with respect to secrets.

### 8.2 Keying model

- **OPEN DECISION / ARCHITECTURAL RECOMMENDATION.** Key by **NAS identity**, not by `radiusProfileId`. Rationale: the secret is a trust anchor between *this device and the RADIUS server*, so its natural identity is the device; a profile may legitimately change hosts while keeping the same device; and `profileId` is an operator-chosen string that could be reused or reassigned, which would silently repoint a device's trust anchor.
- **OPEN DECISION.** Whether one NAS may present **different** secrets for the authentication and accounting ports, or must use one. RADIUS permits either; the current profile model has a single `secretReference`.
- **OPEN DECISION.** Whether the **App Owner** should be able to read a secret reference but never the material, or neither. **ARCHITECTURAL RECOMMENDATION:** reference visible to super-admin for operations; material never readable through any API by anyone.

### 8.3 Rotation requirements

- **ARCHITECTURAL RECOMMENDATION.** Rotation must be **reference-pinned and value-versioned**: the stored reference never changes, the backend version advances. Rotation is then an out-of-band operation with no Firestore write.
- **ARCHITECTURAL RECOMMENDATION.** A rotation must support a **grace window** accepting old and new simultaneously, because RADIUS offers no in-band renegotiation and a half-rotated NAS silently rejects every Access-Request with no diagnostic.
- **OPEN DECISION.** Maximum acceptable overlap window, and whether overlap is permitted at all given the fail-closed posture.
- **ARCHITECTURAL RECOMMENDATION.** Rotation metadata (`secretRotatedAt`) should live in the profile document as **audit only**, and must not become part of the runtime profile object, which is exactly the 8.2C normalized 12-field shape.

### 8.4 Failure behaviour

- **FACT.** Today `RADIUS_SECRET_UNAVAILABLE` maps to `ADAPTER_FAILURE` / 502 (`radiusTransport/errors.js:22`), and `validateResolvedSecret` fails closed on empty or over-length results (`secrets.js:16–24`).
- **ARCHITECTURAL RECOMMENDATION.** Preserve this exactly. A missing secret must never degrade to "no authentication required", never fall back to a default, and never be cached across a failure.
- **OPEN DECISION.** Whether a secret-unavailable event should automatically disable the owning pairing. Auto-disable is a federation-wide side effect from a single backend fault and would need an owner-visible audit trail.

### 8.5 Ownership boundary and audit

- **ARCHITECTURAL RECOMMENDATION.** The secret backend must be owner-scoped, so that resolution of one owner's reference can never return another owner's material.
- **ARCHITECTURAL RECOMMENDATION.** Required audit events: secret reference created, rotated, revoked; actor; timestamp; backend version. **Never** the secret, never a derivative of the secret, never a hash of it.

### 8.6 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of the secret-backend sub-phase.** Depends on REC-5.

---

## 9. REC-7 / OD-1 — EAP/802.1X vs PAP

### 9.1 This decision is not closed

**OD-1: OPEN — USER DECISION REQUIRED.**

This document does **not** select a path. Both are presented using only evidence supported by the discovery report. No EAP dependency is introduced. No PAP implementation is proposed beyond what Phase 8.3 already requires.

### 9.2 What exists in the repository today

- **FACT.** Phase 8.3 requires `context.password` on every Access-Request (`radiusRoamingAAAAdapter.js:245–251`, max 128 chars per `MAX_RADIUS_PASSWORD_LENGTH` at `:90`), forwarded as `userPassword` (`:263`) and encoded by RFC 2865 §5.2 password hiding (`radius/passwordHiding.js`).
- **FACT.** **There is no production producer for `context.password`.** `RoamingAAAAdapter.buildContext` (`roamingAAAAdapter.js:116–133`) emits neither `password` nor `userName`.
- **FACT.** YabaLink's existing subscriber secret is an **owner/app bcrypt hash**, which is one-way and cannot be used as a RADIUS `User-Password`.
- **FACT.** The **entire** EAP surface in the repository is: the attribute constant `71: { name: "EAP-Message", type: "opaque" }` (`radius/constants.js:160`), a reference to it in the Access-Request builder (`radius/authenticator.js:188`, `:194`), and two packet-type code names (`radius/constants.js:93–94`, `10: "EAP Success"` / `12: "EAP Failed"`). There is **no** EAP method negotiation, no EAP-Identity handling, no MSCHAPv2, no 802.1X.
- **FACT.** `UNSUPPORTED_OPERATIONS` covers only CoA and Disconnect (`radiusTransport/client.js:32–37`). EAP is not blocked at the transport level but is unimplemented at the codec level.

### 9.3 Path A — PAP-over-RADIUS / User-Password

| Dimension | Assessment |
|---|---|
| **Identity requirements** | A stable pseudonymous `User-Name` presented in cleartext on the wire |
| **Credential requirements** | YabaLink must hold a **reusable per-subscriber secret**, retrievable at Access-Request time |
| **Secret requirements** | Requires a per-subscriber secret store — a materially larger problem than the per-NAS store in REC-6, because it scales with subscribers rather than devices |
| **RADIUS interaction** | Supported today by the 8.2C transport; no new protocol code |
| **NAS requirements** | NAS must accept PAP. Many enterprise-capable NAS configurations do not permit PAP for roaming |
| **Security implications** | The subscriber secret transits the network inside a **recoverable** encoding (RFC 2865 password hiding is MD5-based, `radius/passwordHiding.js:59,108`). This is materially weaker than EAP-TLS. Over an untrusted wireless medium this is a real exposure |
| **Passpoint compatibility** | **Poor.** Passpoint/EAP deployments do not accept PAP for enterprise credentials. A PAP-only design would need replacement, not extension |
| **Impact on REC-8 (identity)** | Identity is carried in cleartext in `User-Name`, so REC-8 is fully load-bearing |
| **Impact on REC-9 (credentials)** | REC-9 becomes the largest sub-phase in Phase 8.4, and it cannot be deferred |
| **Impact on production secret architecture** | Requires **two** secret classes: per-NAS (REC-6) and per-subscriber. Only the per-NAS class is currently contemplated |

### 9.4 Path B — 802.1X / EAP / Passpoint-compatible authentication

| Dimension | Assessment |
|---|---|
| **Identity requirements** | The **supplicant** holds and presents its own identity; YabaLink is not necessarily the party presenting credentials |
| **Credential requirements** | YabaLink may need **no** per-subscriber secret at all, depending on the trust model (certificate, SIM, or delegated validation) |
| **Secret requirements** | Potentially limited to per-NAS secrets plus certificate/subscription material handled outside YabaLink |
| **RADIUS interaction** | **Not implemented.** Would require EAP attribute encoding/decoding, method negotiation, and message handling in the `radius/` codec — a significant extension of a codec deliberately kept minimal |
| **NAS requirements** | NAS must run 802.1X with a RADIUS backend and WPA2/WPA3-Enterprise |
| **Security implications** | Materially stronger: TLS-based methods protect the credential. But the implementation surface is much larger, and an incorrect EAP implementation is worse than no EAP |
| **Passpoint compatibility** | **Directly aligned.** No rework expected |
| **Impact on REC-8 (identity)** | REC-8 may be substantially simplified or replaced by the supplicant identity |
| **Impact on REC-9 (credentials)** | REC-9 may reduce to certificate/subscription lifecycle, or disappear from YabaLink's scope |
| **Impact on production secret architecture** | May not require a per-subscriber secret store at all — which would remove the single largest secret-management risk in Phase 8.4 |

### 9.5 The decisive consequence

- **FACT.** This fork determines whether Phase 8.4 must build a per-subscriber secret store.
- **ARCHITECTURAL RECOMMENDATION.** Do **not** build per-subscriber credential storage until this is answered. Building it under Path A and then discovering Path B is the destination would mean creating a store of subscriber credentials that must be dismantled and whose compromise would affect every subscriber.
- **ARCHITECTURAL RECOMMENDATION.** If Path A is chosen for a pilot, the pilot must be time-boxed with a documented migration plan to Path B, and the credential exposure over the wireless medium must be explicitly accepted as a risk.

### 9.6 Status

**OD-1: OPEN — USER DECISION REQUIRED. Blocks REC-8 and REC-9 entirely.**

---

## 10. REC-8 — RADIUS Identity Model

### 10.1 Preserved Phase 8.3 position

- **FACT.** The Phase 8.3 decision lock deferred this and stated: *"Phase 8.3 makes no username or pseudonym decision... The adapter never derives a username from `userRef`, `phone`, `userId`, `jti`, `entitlementId` or any other subscriber identifier."*
- **ARCHITECTURAL RECOMMENDATION.** Preserve that: a stable pseudonymous RADIUS identity is preferred over exposing the user's phone number.

### 10.2 Why this is not optional

- **FACT.** `sub`/userId **can be a phone number** in this codebase. `routes/roaming/auth.js:74–113` resolves `db.collection("users").doc(phone)` and returns that document id as `userId` (`:76`, `:97`, `:112`).
- **FACT.** The data model itself stores the JWT `sub` in a field named `phone`: `roamingSessionService.js:304–308` writes `phone: claims.sub` and `authType: claims.sub`.
- **ARCHITECTURAL RECOMMENDATION — hard rule.** A phone number must **never** be placed in `User-Name`. Any derivation that echoes `userId`, `sub` or `phone` into the RADIUS attribute discloses subscriber PII to every visited network operator, permanently and outside YabaLink's control.

### 10.3 Proposed derivation — analysis, not finalisation

- **ARCHITECTURAL RECOMMENDATION.** A pseudonymous identity derived from `(userId, homeOwnerId)`, HMAC-SHA256 based, truncated, with a version prefix. `crypto` is built in and already used for HMAC in this repository (`routes/vouchers.js:17`), so **no new dependency is required**.
- **ARCHITECTURAL RECOMMENDATION.** Include `homeOwnerId`, for two reasons: it scopes the pseudonym to the home federation so two different subscribers can never collide even if `userId` namespaces were ever weak; and it means a user's identifier is **not globally correlatable across federations**, which is a privacy gain. The cost — a user who changes home owner receives a new RADIUS identity — is correct behaviour.

| Requirement | Position |
|---|---|
| **Key requirement** | A dedicated HMAC key, held in the same managed backend as RADIUS secrets (REC-5), but a **separate key** from any RADIUS shared secret and any JWT secret. A leaked pseudonym key must not compromise device trust, and vice versa |
| **Rotation requirement** | Key rotation must be possible. Because a rotated key yields a different pseudonym, rotation is an identity change and interacts with REC-10 correlation |
| **Versioning requirement** | An explicit version prefix in the identifier (for example `ybl-r1-<hex>`), so rotation is unambiguous and needs no flag-day cutover |
| **Uniqueness requirement** | Unique **within** a federation, not globally. Global uniqueness invites cross-federation tracking for no benefit |
| **Stability across visited hotspots** | **Required.** This is the core roaming requirement. If identity varied per hotspot, every partner would treat a returning subscriber as new, and per-subscriber policy and RAU continuity would both break |

### 10.4 What is not finalised here

- **OPEN DECISION.** The exact canonicalisation of the derivation input — field ordering, separators, encoding, truncation length, version prefix format. **Not finalised**, because it depends on OD-1 (REC-8 is blocked).
- **OPEN DECISION.** Whether `userId` should be canonicalised before derivation, given it may be a phone number, a Firebase uid, or a random UUID document id depending on how the account was created.

### 10.5 Status

**BLOCKED — depends on OD-1 (REC-7). DECISION REQUIRED BEFORE IMPLEMENTATION of the identity sub-phase.**

---

## 11. REC-9 — Credential Lifecycle

### 11.1 The unresolved issue

- **FACT.** Phase 8.3 requires `context.password` on every Access-Request (`radiusRoamingAAAAdapter.js:245–251`) and provides **no production source** for it.
- **FACT.** The value is never stored, logged or serialized by the adapter, and the 8.3 checker asserts no `console.*` call exists in the adapter at all.
- **BLOCKED.** The credential model is entirely determined by OD-1 (§9). Path A requires a per-subscriber secret lifecycle; Path B may not require a YabaLink-held subscriber credential at all.

### 11.2 Prohibited premature implementations

These are explicit prohibitions. Each is grounded in repository evidence showing why it would be a defect.

| Prohibition | Evidence |
|---|---|
| **Never store a password in `roaming_sessions`** | That document is written in a transaction (`roamingSessionService.js:268`) and is read by the customer usage view (`roamingUsageService.js:51–56`) and by settlement validation (`roamingSettlementReconciliationService.js:276`) |
| **Never put a password in a JWT** | JWT claims are returned to callers by `POST /api/roaming/validate` (`routes/roaming/auth.js:192–202`) and `POST /api/roaming/context` (`:314–320`). Anything in the JWT is effectively client-visible |
| **Never use frontend credentials** | No client-side storage of a roaming credential is acceptable |
| **Never return a credential through a public API** | The discovery allowlist (`roamingRegistryService.js:616–648`) exists precisely to prevent this class of leak; a credential path would defeat it |
| **Never use a query-string credential** | Already the case — all state travels in POST bodies or headers. Must not regress |
| **Never log a credential** | Already asserted by the 8.3 checker |
| **Never allow client-controlled credential injection** | `assertNoClientSuppliedConfig` (`radiusTransport/profile.js:273`), invoked by the adapter at `radiusRoamingAAAAdapter.js:236`, already rejects infrastructure and secret fields from context |

### 11.3 Credential lifecycle questions that must be answered

- **OPEN DECISION.** Credential issuance: server-generated, derived, or short-lived.
- **OPEN DECISION.** Credential storage: where a per-subscriber credential would live, given there is no encryption at rest (§7.1).
- **OPEN DECISION.** Credential revocation: how a compromised or rotated credential is invalidated without a partner-wide coordination problem.
- **OPEN DECISION.** Credential scope: whether one credential covers all of a subscriber's roaming, or is per-entitlement, per-session, or per-partner.

### 11.4 Status

**BLOCKED — depends on OD-1 (REC-7). DECISION REQUIRED BEFORE IMPLEMENTATION of the credential sub-phase.**

---

## 12. REC-10 — Session Correlation

### 12.1 Entities that must correlate

| Entity | Current key | Evidence |
|---|---|---|
| `roaming_sessions` | `sessionId` (auto-generated document id) | `roamingSessionService.js:239` |
| Entitlement | `entitlementId` | Snapshotted on the session |
| User | `userRef.userId` (+ `phone`, `authType`) | `roamingSessionService.js:304–308` |
| Home owner | `homeOwnerId` | On both entitlement and session |
| Visited owner | `visitedOwnerId` | On both |
| Hotspot | `visitedHotspotId` | From signed JWT claims |
| `radiusProfileId` | Server-derived, session field | **FACT** added by Phase 8.3 (`roamingSessionService.js:333–334`), written only inside the resolution guard |
| NAS | **NOT PRESENT on the session** | No `nasIdentifier` field exists |
| `Acct-Session-Id` | **NOT PRESENT** | Never set by any production code |
| `Class` | **NOT PRESENT** | The adapter never sends `classAttribute` |

### 12.2 Candidate correlation key

- **ARCHITECTURAL RECOMMENDATION.** `roaming_sessions.sessionId` should be the **single authoritative correlation key**. Everything else is either an attribute of that session or must be reachable from it.
- **ARCHITECTURAL RECOMMENDATION.** `sessionId` is server-generated, non-PII, and already treated as non-guessable by the Phase 8.2A design. It is therefore suitable for transmission as a correlation token.
- **FACT.** Feasible today: `sendAccessRequest` accepts `classAttribute` (`radiusTransport/client.js:124`); `sendAccountingRequest` accepts both `classAttribute` (`:183`) and `acctSessionId` (`:173`).

### 12.3 Unresolved items

- **OPEN DECISION.** Whether `Class` carries the raw `sessionId`, or a signed compact token wrapping it. **ARCHITECTURAL RECOMMENDATION:** raw `sessionId`, because a signed token adds a second signing key and a rotation obligation with no security gain — `sessionId` is already opaque and carries no PII.
- **OPEN DECISION.** Whether the `NAS` identity should be recorded on the session document. If correlation requires knowing which device served a session — for troubleshooting, or for future Accounting — a `nasIdentifier` field would be needed. It does not exist today.
- **OPEN DECISION.** Whether `Acct-Session-Id` should equal `sessionId` or be a separate value. Separate is safer if a future partner requires a specific format; equal is simpler. Depends partly on whether RADIUS Accounting is ever adopted (REC-11).
- **BLOCKED.** If REC-8 adopts a versioned pseudonym, correlation must **not** depend on `User-Name`, because a rotated pseudonym key changes it. This is a constraint on the design, not a blocker on REC-10 itself.
- **ARCHITECTURAL RECOMMENDATION.** A RADIUS packet whose correlation identifier resolves to no known session must be **dropped and audited**, never billed and never used to create state.

### 12.4 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of the correlation sub-phase.** Recommended position recorded above; not approved.

---

## 13. REC-11 — Accounting / RAU Authority

### 13.1 The invariant — preserved without modification

> `1 eligible connected roaming minute = 1 RAU`

- **FACT.** The sole billing-time enforcement point is `wholeMinutesElapsed` in `roamingRauConsumptionService.js:68–76`, which floors `diffMs / MS_PER_MINUTE`. `MS_PER_MINUTE = 60000` (`rauCalculationService.js:25`).
- **FACT.** `rauCalculationService.calculateRAUs` is **not** in the billing path — it is imported only for the constant (`roamingRauConsumptionService.js:42`).
- **FACT.** YabaLink is the authoritative RAU authority, and the RAU engine imports no adapter module.
- **ARCHITECTURAL RECOMMENDATION — carried forward unchanged.** RADIUS Accounting must never become a second monetary or RAU authority.

### 13.2 The reconciliation constraint that enforces this

- **FACT.** `roamingSettlementReconciliationService.js:276` asserts `sum(consumedRaus) <= session.billedMinutes`.
- **FACT.** This means any accounting path that incremented RAU **independently** of `session.billedMinutes` would break the invariant and begin flagging settlements `INVALID`.
- **ARCHITECTURAL RECOMMENDATION.** This is the strongest technical reason RADIUS must not become a second RAU authority, and it should be cited in any future accounting proposal.

### 13.3 Intended future relationship — if RADIUS Accounting is ever adopted

| RADIUS event | Recommended relationship |
|---|---|
| **Accounting-Start** | Do **not** bill. Establish or leave the existing anchor (`session.lastBilledAt \|\| session.startedAt`). Billing on Start would double-count, because YabaLink already anchors on session creation |
| **Interim-Update** | The natural RAU trigger: call the existing `billConnectedMinutes`. The monotonic cursor makes this naturally idempotent |
| **Stop** | Call the existing `finalBillOnDisconnect`, then the existing terminate path — the **same** entry point, so billing stays single-sourced |

- **FACT.** All three event types are already supported by the transport (`SUPPORTED_ACCOUNTING_EVENTS = [Start, Interim-Update, Stop]`, `client.js:26–30`), and `sendAccountingRequest` exists (`client.js:160–217`) — but is called by no production code.
- **FACT.** YabaLink time remains authoritative: `deps.serverNowIso` is injectable (`roamingRauConsumptionService.js:138`) defaulting to server time (`:143`). `Date.now()` and Firestore `serverTimestamp` are absent.
- **ARCHITECTURAL RECOMMENDATION — hard rule.** RADIUS-reported times (`Acct-Session-Time`, `Acct-Delay-Time`) must **never** enter the billing computation. They are NAS-reported and untrusted.

### 13.4 Concerns to document now

| Concern | Position |
|---|---|
| **Duplicate packets** | Handled by the monotonic `lastBilledAt` cursor (`:317`) plus the `diffMs <= 0` no-op guard (`:73–74`) plus the zero-consumption short-circuit (`:299–301`). No separate accounting ledger should be introduced |
| **Replay** | Settlement-level protection: `idempotencyKey = ${entitlementId}:${sessionId}:${billingCursor}` **is** the document id, with an in-transaction exists-guard (`roamingSettlementService.js:33–44`, `:214–221`) |
| **Out-of-order packets** | Silent no-op under the existing guard. Log for observability; do not alert |
| **Missing Interim-Updates** | **No accuracy cost.** The engine is interval-based, not event-count-based, so the next Interim-Update or Stop bills the whole elapsed gap. **Recommendation: do not add an Interim-Update expectation** |
| **Accounting failure** | Must **not** grant access and must **not** block access. Access is decided at Access-Request; accounting follows. Never let an accounting failure call `provisionAccess` or `revokeAccess` |
| **Server-time authority** | Preserved: YabaLink server time only |
| **Settlement / credit / residual** | Untouched. Any future accounting must flow through the existing single entry points |

### 13.5 Scope position

- **ARCHITECTURAL RECOMMENDATION — carried forward from the discovery report.** RADIUS Accounting should be **out of Phase 8.4 entirely**, unless a partner's RADIUS server requires it for its own billing. YabaLink gains no accuracy from a second, less trustworthy time source, and gains real reconciliation risk.
- **OPEN DECISION.** If a partner does require it, it must be a separately approved sub-phase with the §13.2 constraint treated as a hard acceptance criterion.

### 13.6 Status

**RECOMMENDED / OPEN — DECISION REQUIRED BEFORE IMPLEMENTATION of any accounting sub-phase.** Recommended position: out of scope for Phase 8.4.

---

## 14. REC-12 — Enforcement / CoA / Disconnect Scope

### 14.1 Current unsupported methods

- **FACT.** The RADIUS adapter fails all four closed with `501 radius_method_not_supported` (`radiusRoamingAAAAdapter.js:403–417`, code constant at `:65`), and advertises them as `false` capabilities (`:80–88`).
- **FACT.** This is a locked Phase 8.3 contract and is asserted by the 8.3 checker.
- **FACT.** CoA and Disconnect are rejected at the transport layer (`UNSUPPORTED_OPERATIONS`, `client.js:32–37`; `assertSupportedOperation`, `:61–69`).

### 14.2 Scope determination

| Method | Determination | Reasoning |
|---|---|---|
| `provisionAccess` | **RECOMMENDATION: remains permanently fail-closed for RADIUS** | RADIUS provisioning is implicit — an Access-Accept *is* the provisioning. There is no separate protocol operation for "create session". Implementing it would be fabricating behaviour |
| `revokeAccess` | **OPEN — recommended for a later Phase 8.x sub-phase, only if a partner requires immediate revocation** | Administrative intent. YabaLink already has an authoritative admin route (`routes/roaming/enforcement.js:175`). CoA is needed only to kill an in-flight session immediately |
| `disconnect` | **OPEN — recommended for a later Phase 8.x sub-phase** | Same reasoning. Note the RAU-exhaustion disconnect **already works** via the existing YabaLink path (`roamingRauConsumptionService.js:357–372`) and is best-effort by design |
| `getUsage` | **RECOMMENDATION: remains permanently fail-closed for RADIUS** | RADIUS has no usage-query operation in the implemented RFC 2865 set. Usage arrives via Accounting. RADIUS is not a usage authority (REC-11) |

### 14.3 Which operation should control which concern

| Concern | Recommended control |
|---|---|
| Initial authorization | Access-Request / Access-Accept |
| Session provisioning | Access-Accept itself |
| RAU exhaustion | YabaLink terminate route — already implemented |
| Entitlement revocation | YabaLink admin route, then `revokeAccess` only if CoA is later approved |
| Session termination | YabaLink terminate route |
| Hotspot / device failure | Disable hotspot, then revoke — only if CoA is later approved |

### 14.4 Why CoA / Disconnect are recommended out of Phase 8.4

- **FACT.** Neither is needed for initial authorization, provisioning, RAU exhaustion or termination — all four already have authoritative YabaLink paths.
- **ARCHITECTURAL RECOMMENDATION.** They introduce a **reverse channel** (server to NAS) that has never been security-reviewed, threat-modelled or tested in this repository.
- **ARCHITECTURAL RECOMMENDATION.** They are gated on: a documented threat model, a real partner requirement for immediate disconnect, and REC-7/REC-8 already locked.
- **OPEN DECISION.** Whether CoA support will be contractually required by any partner. If yes, this recommendation should be revisited before activation rather than at activation time.

### 14.5 Status

**OPEN DECISION — DECISION REQUIRED BEFORE IMPLEMENTATION of any enforcement-lifecycle sub-phase.**

---

## 15. Passpoint / 802.1X Forward-Compatibility Boundary

### 15.1 The separation

| In scope for Phase 8.4 | Explicitly out of scope |
|---|---|
| Access-Request / Access-Accept / Access-Reject over UDP | Passpoint / Hotspot 2.0 |
| Generic attributes only | 802.1X, EAP, WPA2/WPA3-Enterprise |
| `radius_profiles` configuration | ANQP |
| Correlation via `Class` / `Acct-Session-Id` | EAP-SIM / TTLS / PEAP / TLS |
| YabaLink entitlement authority | SIM-based and certificate-based authentication |

- **FACT.** The separation is preserved by this document and by §2.2. EAP is a sub-phase decision (REC-7 / OD-1), not an EAP implementation.

### 15.2 Forward-compatibility requirements on Phase 8.4 decisions

| Decision | Requirement |
|---|---|
| **Identity (REC-8)** | **ARCHITECTURAL RECOMMENDATION.** A pseudonym stable per `(homeOwnerId, userId)` maps onto a user-scoped EAP outer identity. A design deriving identity from the NAS would **not** survive a Passpoint future, because the supplicant identity is user-scoped, not device-scoped |
| **Correlation (REC-10)** | **ARCHITECTURAL RECOMMENDATION.** `Class` must stay strictly opaque and non-PII. Passpoint deployments commonly carry vendor or standard attributes for session correlation; keeping `Class` free of PII avoids a future migration |
| **No phone numbers on the wire (REC-8 §10.2)** | **Non-negotiable, and Passpoint-aligned.** A phone number disclosed to partner infrastructure in a pilot cannot be withdrawn. This is an asymmetry that must be respected: disclosure is irreversible |
| **Entitlement authority (REC-11)** | **ARCHITECTURAL RECOMMENDATION.** An AAA-as-authorization-input model extends directly to Passpoint, where real-time policy consultation is the norm |
| **Per-NAS profile model (REC-4)** | **ARCHITECTURAL RECOMMENDATION.** Compatible. Passpoint adds a profile per federation/venue rather than per NAS — additive |
| **Server-time-authoritative RAU (REC-11)** | **ARCHITECTURAL RECOMMENDATION.** Compatible and retained. Passpoint accounting has the same untrusted-NAS-time property |

### 15.3 The single incompatibility point

- **FACT.** The credential model (REC-9) is the incompatibility point. A PAP credential means YabaLink holds a reusable subscriber secret; EAP means it must not.
- **ARCHITECTURAL RECOMMENDATION.** Do not build per-subscriber credential storage until OD-1 is answered (§9.5).
- **OPEN DECISION.** Whether any pilot targets PAP at all, or whether Phase 8.4 defers entirely to EAP. If a pilot is required, **ARCHITECTURAL RECOMMENDATION:** PAP only with a documented, time-boxed migration plan, and only over a network path where the credential exposure is explicitly accepted.

### 15.4 Status

**OPEN DECISION — carried into §20. Does not independently block any sub-phase other than REC-9.**

---

## 16. Observability and Audit

### 16.1 Forbidden set

- **ARCHITECTURAL RECOMMENDATION.** The following must **never** appear in logs, metrics or audit records: RADIUS shared secrets; `User-Password` in any form, including RFC 2865-hidden form; roaming JWTs and `jti` values; phone numbers; `userRef.userId` where it may be a phone number; resolved profile host/port combinations, because a resolved profile map is itself an infrastructure disclosure; Firebase service-account material.
- **FACT.** The 8.3 checker already asserts the adapter contains **no** `console.*` call at all, and that no secret appears in thrown errors, details or serialized state. This is the current state and must not regress.

### 16.2 Safe, useful fields

- **ARCHITECTURAL RECOMMENDATION.** Safe and useful: `sessionId`, `entitlementId`, `homeOwnerId`, `visitedOwnerId`, `visitedHotspotId`, `nasIdentifier`, `radiusCode` / `radiusCodeName` / `codeName`, `radiusErrorCode`, `attempts`, `rttMs`, `durationMs`, `outcome` (`accept` / `reject` / `error`).
- **ARCHITECTURAL RECOMMENDATION.** `radiusProfileId` may be logged **only after** ownership validation succeeds. Before validation it is untrusted operator input (§6.2).
- **ARCHITECTURAL RECOMMENDATION.** Add `correlationId` — a per-exchange opaque id, propagated into `Class`, so a partner's log can be joined to YabaLink's without exposing identity.
- **ARCHITECTURAL RECOMMENDATION.** Add `radiusPseudonymVersion` — the key version only, never the key and never the pseudonym's derivation input.

### 16.3 Required audit events

- **ARCHITECTURAL RECOMMENDATION.** Profile created / updated / enabled / disabled — actor and `ownerId`.
- **ARCHITECTURAL RECOMMENDATION.** Secret reference rotated — actor, timestamp, backend version. Never the secret.
- **ARCHITECTURAL RECOMMENDATION.** Every Access-Request outcome at debug level, keyed by `correlationId`.
- **ARCHITECTURAL RECOMMENDATION.** Every rejection at warn level, because repeated rejects indicate a misconfigured federation rather than user error.
- **ARCHITECTURAL RECOMMENDATION.** Any ownership-validation failure at **error** level. §6.1 is a security signal, not a configuration nuisance.
- **ARCHITECTURAL RECOMMENDATION.** Activation-gate state changes (flag flips) at warn level.
- **ARCHITECTURAL RECOMMENDATION.** Any RADIUS packet whose correlation identifier resolves to no known session, dropped and audited (§12.3).

### 16.4 Reuse of existing audit infrastructure

- **FACT.** `audit_logs` already exists and is already written by `roamingAuthService.logAuthEvent` (`roamingAuthService.js:732–744`).
- **FACT.** `roaming_enforcements/{sessionId}` already records provisioning outcomes (`roamingEnforcementService.js:225`).
- **ARCHITECTURAL RECOMMENDATION.** Reuse these. Do not invent a second audit store.
- **ARCHITECTURAL RECOMMENDATION.** Do **not** implement logging in the early sub-phases. The fields that matter most — `correlationId`, `nasIdentifier`, outcome classification — only exist once correlation (REC-10) and a real transport are in place. Observability is a late sub-phase (§19, 8.4G).

### 16.5 Status

**ARCHITECTURAL RECOMMENDATION — not approved. Sequence constraint only: correlation must exist before observability.**

---

## 17. Activation Gates

**FACT.** These are the exact conditions under which `ROAMING_RADIUS_ENABLED=true` could ever be permitted in production. **None is satisfied today.**

| # | Gate | State | Evidence |
|---|---|---|---|
| 1 | **Secure secret backend** | **NOT MET** | No managed store, no encryption at rest, no client library. Default resolver always throws (`radiusTransport/secrets.js:51–69`) |
| 2 | **Profile store** | **NOT MET** | No store exists; the default is inert — no Firestore, no environment, no filesystem (`radiusProfiles/radiusProfileService.js:86–96`, wired at `:178`) |
| 3 | **Adapter registration** | **NOT MET** | `server.js` has zero references; checkers actively forbid it (`check-roaming-phase8-3.js:1483–1487`, `check-roaming-phase8-2a.js:205–206`, `:250–251`) |
| 4 | **Identity model** | **NOT MET** | Username scheme undecided (§10); `context.userName` has no production producer (`roamingAAAAdapter.js:116–133`) |
| 5 | **Credential model** | **NOT MET** | Blocked on OD-1 (§9) |
| 6 | **Authorization model** | **PARTIAL** | Entitlement authority is structurally sound; the three implemented methods are tested |
| 7 | **Enforcement compatibility** | **NOT MET** | `roamingEnforcementService.js:196` rejects the adapter (§3.1) |
| 8 | **Session correlation** | **NOT MET** | Neither `Class` nor `Acct-Session-Id` is populated — the Access-Request argument set carries only identity and NAS identifiers (`radiusRoamingAAAAdapter.js:260–273`) |
| 9 | **Accounting** | **DEFERRED by recommendation** | Not required for access; recommended out of Phase 8.4 (§13.5) |
| 10 | **Duplicate protection** | **MET for billing** | Cursor + transaction + settlement key + credit status (§13.1) |
| 11 | **Failure behaviour** | **MET at adapter level** | Deterministic 404 / 503 / 502 / 501 mapping (`radiusTransport/errors.js:18–33`); all four unsupported methods fail closed |
| 12 | **Monitoring / audit** | **NOT MET** | No RADIUS observability exists (§16) |
| 13 | **Ownership isolation** | **NOT MET** | No `profile.ownerId` check (§6.1) |
| 14 | **Rollback** | **NOT MET** | A single boolean flag with no documented procedure (§18) |
| 15 | **Test coverage** | **PARTIAL** | 234 assertions green offline; no integration test against a real or emulated NAS |
| 16 | **Pre-existing credential remediation** | **NOT MET** | Committed Firebase private key; plaintext device credentials (§22) |

- **ARCHITECTURAL RECOMMENDATION.** The flag must remain `false` until gates 1–8 and 10–16 are met and the corresponding RECs are approved. Gate 9 is excluded by recommendation.
- **ARCHITECTURAL RECOMMENDATION.** Introduce a **second, independent kill switch** distinct from the transport flag, so that profile resolution, adapter registration and the transport itself can each be disabled independently during an incident. The current single boolean cannot express "stop resolving profiles but keep the code loaded".
- **FACT.** Today no RADIUS traffic can leave a YabaLink deployment: `ROAMING_RADIUS_ENABLED` defaults `false` (`radiusTransport/featureFlag.js:4`) and `assertRadiusTransportEnabled` throws `RADIUS_DISABLED` (`featureFlag.js:16–28`). This is the property that must survive every sub-phase.

---

## 18. Migration and Rollback

### 18.1 Isolation is already structural

- **FACT.** Roaming money flows **in** at exactly one point: `POST /api/receipts/save` (`receiptRoutes.js:203`) → `roamingEntitlementBridgeService.js:146`. The receipt is committed at `:231–240` and the wallet transaction at `:246–284` **before** the bridge runs at `:305`, and bridge failures are swallowed at `:313–316`. A roaming failure therefore cannot corrupt a purchase.
- **FACT.** Roaming's only write to existing money state is the visited-owner credit (`roamingSettlementCreditService.js:261`), whose amount derives from the entitlement's immutable `commercial` snapshot (`roamingEntitlementBridgeService.js:112–124`) and never re-reads a live price.
- **FACT.** `wifi_sessions` and `roaming_sessions` are **completely disjoint** — different collections, different identity keys (`userPhone` vs `entitlementId`), different accounting models, and no code path writes to both.
- **FACT.** `backfillCalculatedSettlements` is **dead code** — reachable only from `check-roaming-phase7-6f4.js:423`, with no HTTP route and no cron.
- **ARCHITECTURAL RECOMMENDATION.** These four properties are the reason rollback can be cheap, and they are the strongest argument for keeping the profile store strictly separate from the Phase 7 ledger.

### 18.2 The opt-in boundary

| Layer | Default | Rationale |
|---|---|---|
| `ROAMING_RADIUS_ENABLED` | `false` | Global kill switch — already exists (`featureFlag.js:4`) |
| Second kill switch (§17) | **NOT IMPLEMENTED** | Independent disable of profile resolution / registration / transport |
| Profile `enabled` | `false` until provisioned | Per-NAS kill switch |
| Hotspot `enforcementMode` | `local_adapter` | **FACT** `ENFORCEMENT_MODES = ["local_adapter","radius"]` (`roamingRegistryService.js:16`) — existing hotspots are already unaffected |
| Hotspot `radiusProfileId` | absent | **FACT** no existing document sets a resolvable value |
| Adapter registration | gated by its own flag | **ARCHITECTURAL RECOMMENDATION.** Do **not** couple registration to `ROAMING_RADIUS_ENABLED`; coupling them would make the transport flag the only lever and would defeat the second kill switch |

- **ARCHITECTURAL RECOMMENDATION.** RADIUS roaming is introduced **per hotspot, opt-in, default-off**, and only after the global flag is on. A hotspot that does not opt in behaves exactly as today — the `local_adapter` path already in the registry.

### 18.3 Migration sequence

- **ARCHITECTURAL RECOMMENDATION.**
  1. Deploy the profile store **empty**; production flag off.
  2. Read-only audit of existing `roaming_hotspots` for non-empty `radiusProfileId`; reconcile each against the new store or clear it.
  3. Provision profiles and secrets for a single internal or test owner.
  4. Enable the flag for that owner only; observe.
  5. Extend hotspot by hotspot, each with its own profile.
- **FACT.** No data migration is required. No existing collection contains RADIUS profile data.

### 18.4 Rollback

| Trigger | Action | Blast radius |
|---|---|---|
| Single bad NAS | Set that profile `enabled = false` | One device |
| Single bad owner | Clear the owner's hotspot `enforcementMode` back to `local_adapter` | One owner |
| Federation-wide fault | `ROAMING_RADIUS_ENABLED = false` | All RADIUS roaming |
| Adapter defect | Unregister the adapter | All RADIUS roaming |

- **FACT.** Rollback is safe because no Phase 7 state depends on RADIUS: RAU is driven by the heartbeat route, settlement reads the entitlement snapshot, and the residual cron is independent.
- **FACT.** The profile store is additive and holds no financial data, so its rollback is "stop reading the collection" — no data migration to reverse, no settlement or entitlement impact.
- **FACT.** `roamingAAAAdapterRegistry.unregisterAAAAdapter` already exists and is used by the 8.3 checker.
- **ARCHITECTURAL RECOMMENDATION.** Runtime unregistration without a deploy should be possible. This requires no new code.

### 18.5 Coexistence with the captive portal

- **FACT.** The captive portal (`routes/users.js`, `wifi_sessions`) has **zero** coupling to roaming sessions, adapters or enforcement. RADIUS roaming adds no path into the portal. A user may hold both a `wifi_sessions` record and a `roaming_sessions` record for the same package; the entitlement bridge already handles this by creating a roaming entitlement alongside the receipt.

### 18.6 Status

**ARCHITECTURAL RECOMMENDATION — not approved. Gate 14 remains NOT MET until this is documented and tested.**

---

## 19. Proposed Sub-Phases

**ARCHITECTURAL RECOMMENDATION.** Phase 8.4 must not be a single phase. The decomposition is ordered by dependency, and **every** sub-phase keeps production disabled.

| Sub-phase | Objective | Depends on | Firestore | Production disabled | Blocked by |
|---|---|---|---|---|---|
| **8.4A** | Enforcement-model compatibility: allow a `provisionAccess: false` adapter to resolve, via per-operation capability checks. No RADIUS behaviour change | — | No | Yes | REC-1 approval |
| **8.4B** | Session correlation contract: `Class` payload shape, `Acct-Session-Id` derivation, unknown-identifier drop-and-audit | 8.4A | No | Yes | REC-10 approval |
| **8.4C** | RADIUS profile store with `ownerId`, plus write-time validation on hotspot registration | 8.4A, 8.4B | **Yes** | Yes | REC-4 approval; the Firestore plan in discovery report §16.2 must be approved first |
| **8.4D** | Production secret resolver keyed by NAS identity, with rotation and versioning | 8.4C | No (backend is external) | Yes | REC-5, REC-6 |
| **8.4E** | Identity model: versioned pseudonymous `User-Name`, HMAC-based | 8.4D | No | Yes | **REC-7 / OD-1** |
| **8.4F** | Credential model: produce `context.password` safely | 8.4E | Possibly | Yes | **REC-7 / OD-1** |
| **8.4G** | Observability and audit fields, events, `correlationId` | 8.4B | No (reuse `audit_logs`) | Yes | REC-10 approval |
| **8.4H** | Adapter registration under a dedicated flag; update the checkers that forbid it; document rollback | 8.4A–8.4G | No | **Yes — this sub-phase prepares, it does not enable** | All prior approvals |

### 19.1 Risks that must be carried into each sub-phase

| Sub-phase | Principal risk | Required mitigation |
|---|---|---|
| 8.4A | Relaxing the 501 gate weakens the mock adapter's guarantees | The gate becomes **per-operation**, never removed; assert the mock adapter still enforces all seven capabilities |
| 8.4B | `Class` leaks PII | A test asserting the payload contains no phone number, no `userId`, no JWT |
| 8.4C | Cross-owner profile reference (§6.1) | Mandatory owner check at **both** write and resolution time, with an error-level audit event on failure |
| 8.4D | **Highest-risk sub-phase in Phase 8.4** | Fail-closed on every failure mode; startup validation; no caching of failures; no secret in any error, log or serialized state |
| 8.4E | PII leakage if derivation is wrong; cross-federation linkability if `homeOwnerId` is omitted | Assert no phone number reaches the wire; assert stability across hotspots; assert different identity per home owner |
| 8.4F | **Highest of all sub-phases** | Do not start before OD-1 is answered (§9.5) |
| 8.4H | This is where production RADIUS becomes *possible* | Must be last; full regression gate; new assertions that every prior gate is satisfied |

### 19.2 Deferred beyond Phase 8.4

- **RADIUS Accounting** — only if a partner requires it, as its own approved sub-phase, with §13.2 as a hard acceptance criterion.
- **CoA / Disconnect** — §14.4.
- **Passpoint / 802.1X** — a separate programme (§15).
- **Pre-existing credential remediation (§22)** — this predates RADIUS and should not be sequenced behind it, even though it is a production gate.

### 19.3 Firestore discipline

- **ARCHITECTURAL RECOMMENDATION.** Firestore is required in **exactly one** sub-phase, 8.4C. Enforcement change, correlation, attribute semantics, failure matrix, observability and the test suite all require zero Firestore changes.
- **ARCHITECTURAL RECOMMENDATION.** Preserve the property that every new module is unit-testable with injected stores and no emulator. Access pattern is `doc(profileId).get()` keyed by document id; **no index is required**. Defer any `where("ownerId")` listing.
- **ARCHITECTURAL RECOMMENDATION.** Store **no derived fields**. Let `normalizeRadiusProfile` derive them, so the stored document and the runtime object cannot diverge.
- **ARCHITECTURAL RECOMMENDATION.** A store-level test must assert no `sharedSecret`, `secret` or `password` field can exist.

### 19.4 Status

**ARCHITECTURAL RECOMMENDATION — sequencing proposal only. No sub-phase is authorised to begin.**

---

## 20. Consolidated Open Decisions

**FACT.** All open decisions are consolidated here. None is closed by this document.

| # | Decision | Section | Blocked by | Consequence if guessed wrong |
|---|---|---|---|---|
| **OD-1** | EAP/802.1X vs PAP | §9 | Passpoint requirements not final | Building a per-subscriber secret store that must be dismantled, or shipping a credential model that cannot support enterprise Wi-Fi |
| **OD-2** | Enforcement gate: per-operation relaxation vs a new adapter contract | §3 | Architectural preference | Over-loosening weakens existing guarantees; a new contract adds surface |
| **OD-3** | `Class` payload: raw `sessionId` vs signed token | §12.3 | — | Low risk; either is defensible |
| **OD-4** | Secret backend provider | §7.3 | Deployment / infrastructure decision | Rework of 8.4D; possible dependency addition |
| **OD-5** | Rotation model: pinned vs floating reference; overlap permitted? | §8.3 | Partner NAS capability | A half-rotated NAS rejects every Access-Request with no diagnostic |
| **OD-6** | One secret per NAS, or separate auth/accounting secrets | §8.2 | Partner NAS capability | Rework of the profile model |
| **OD-7** | Ownership enforcement point: write-time, read-time, or both | §6.2 | — | Cross-owner reference becomes possible. **This document recommends both** |
| **OD-8** | `"unknown"` persisted as an `AAA_ADAPTER_KEYS` value | §21 note | — | Pre-existing confusion; worth cleaning, not RADIUS-blocking |
| **OD-9** | Firestore rules: `radius_profiles` only, or a separate infrastructure work item | §19.3 | Platform decision | A partial rules posture may be worse than none |
| **OD-10** | Whether Access-Reject reasons are customer-visible | §20.1 note | Product decision | Minor information disclosure about partner network policy |
| **OD-11** | Whether secret unavailability auto-disables a pairing | §8.4 | Product / ops decision | Federation-wide side effect from a single backend fault |
| **OD-12** | Concurrent-session cap | — | Product decision | Changing it alters Phase 7 billing behaviour — **out of scope for Phase 8.4** |

### 20.1 Failure-matrix position on Access-Reject

- **FACT.** Today `reason: "access_reject"` is returned to the caller. This is a small disclosure about the partner network's policy.
- **ARCHITECTURAL RECOMMENDATION.** Keep it internal. Do not map partner rejection reasons to customer-visible codes. (OD-10)
- **FACT.** The failure matrix is otherwise uniformly fail-closed: there is **no** row in which a RADIUS-side failure results in ALLOW. This is the correct posture and must be preserved.
- **ARCHITECTURAL RECOMMENDATION.** Keep "do not create the session" for every Access-Request failure. A `roaming_sessions` document in `authorized` state starts a billing clock, so creating one before the access decision is known risks billing a session that was never admitted.
- **FACT.** Accounting unavailability must have **no** effect on access, and settlement failure leaves status `calculated` because credit is non-blocking by design (`roamingSettlementCreditGateway.js:12–15`).

---

## 21. Exact Blockers to Production RADIUS

**FACT.** Production RADIUS cannot be enabled. The blockers, in dependency order:

1. **Secret backend does not exist.** `createDisabledProductionSecretResolver` always throws (`radiusTransport/secrets.js:51–69`). No managed store and no encryption at rest anywhere in the repository (§7.1).
2. **Profile store does not exist.** The profile service is inert by default (`radiusProfiles/radiusProfileService.js:86–96`, wired at `:178`).
3. **Enforcement service rejects the adapter.** `roamingEnforcementService.js:196` (§3.1).
4. **No production source for `context.userName`.** `RoamingAAAAdapter.buildContext` emits neither `userName` nor `password` (`roamingAAAAdapter.js:116–133`).
5. **No production source for `context.password`.** Blocked on OD-1 (§9, §11.1).
6. **No correlation emitted.** Neither `Class` nor `Acct-Session-Id` is populated — the Access-Request argument set carries only identity and NAS identifiers (`radiusRoamingAAAAdapter.js:260–273`).
7. **Ownership check missing.** No `profile.ownerId` comparison anywhere (§6.1).
8. **Adapter not registered, flag off.** `server.js` has zero references; `ROAMING_RADIUS_ENABLED` defaults `false`.
9. **Existing checkers actively forbid wiring.** `check-roaming-phase8-3.js:1483–1492` and `check-roaming-phase8-2a.js:205–206`, `:250–251`. Any activation sub-phase must update these deliberately, not by weakening them.
10. **No observability.** No audit events, no correlation IDs, no metrics (§16).
11. **No rollback procedure.** Neither tested nor documented (§18).
12. **Committed credential material.** `backend/serviceAccountKey.json` and plaintext `devices.sshPassword` / `devices.enablePassword` (§22).

- **FACT.** **Note on OD-8.** `"unknown"` is recorded as a possible persisted `AAA_ADAPTER_KEYS` value. This is pre-existing confusion. It is worth cleaning, but it is not a RADIUS blocker and is not a Phase 8.4 decision.
- **FACT — the honest bottom line.** Phases 8.1–8.3 built a complete, well-tested, **unreachable** RADIUS stack. The gap between "the code exists" and "production RADIUS works" is not more RADIUS code — it is a secret backend, an identity model, a credential model, one enforcement-model change, and a set of security remediations that predate RADIUS entirely. Ten of the twelve blockers are decisions or infrastructure, not implementation.

---

## 22. Pre-existing Credential Hygiene and Security Debt

**FACT.** These items **predate RADIUS**. They are recorded here because gate 16 depends on them, and because claiming production RADIUS security while a Firebase private key sits in the repository would undermine every other control in this document.

### 22.1 Findings

- **FACT.** `backend/serviceAccountKey.json` is **committed to the repository** and contains a Firebase service-account private key.
- **FACT.** `devices.sshPassword` and `devices.enablePassword` are stored in **plaintext** in Firestore and consumed by `ciscoService.js`.
- **FACT.** There is **no encryption at rest anywhere in the repository** — no cipher primitive, no envelope encryption, no KMS client (§7.1).

### 22.2 Required actions

- **ARCHITECTURAL RECOMMENDATION.** Rotate the Firebase service-account key and **purge it from repository history** before any production RADIUS claim. Rotation alone is insufficient: history remains reachable to anyone with clone access, and the old key must be presumed exposed.
- **ARCHITECTURAL RECOMMENDATION.** Migrate `devices.sshPassword` / `devices.enablePassword` to the same secret backend chosen under REC-5, or explicitly accept and document the risk. Do not build a second, weaker secret path for device credentials.
- **ARCHITECTURAL RECOMMENDATION.** Sequencing note: this work should **not** be sequenced behind RADIUS. It is independent, it is older, and it is cheaper to do first.

### 22.3 Status

**DECISION REQUIRED BEFORE ANY PRODUCTION RADIUS CLAIM.** Not a Phase 8.4 decision; a prerequisite claim restriction.

---

## 23. Invariants to Preserve

**These hold across every sub-phase in §19 and across the activation gate in §17. A change that breaks any of them is out of scope, not a trade-off.**

### 23.1 Financial invariants

| # | Invariant | Evidence |
|---|---|---|
| F1 | **`1 eligible connected roaming minute = 1 RAU`**, computed by `wholeMinutesElapsed` | `roamingRauConsumptionService.js:68–76`, `MS_PER_MINUTE = 60000` (`rauCalculationService.js:25`) |
| F2 | YabaLink is the **sole** RAU authority. The RAU engine imports no adapter module | `roamingRauConsumptionService.js:42` |
| F3 | **RADIUS must never become a second RAU or monetary authority** | §13.1; reconciliation assertion `sum(consumedRaus) <= billedMinutes` (`roamingSettlementReconciliationService.js:276`) |
| F4 | **YabaLink server time is authoritative.** RADIUS-reported times never enter billing | `deps.serverNowIso` injectable, defaults to server time (`roamingRauConsumptionService.js:138`, `:143`) |
| F5 | No Phase 7 change: settlement, credit, residual, commission, package, payment, MTN, voucher, wallet logic are untouched | §2.2 |

### 23.2 Authorization invariants

| # | Invariant | Evidence |
|---|---|---|
| A1 | **YabaLink remains the entitlement authority.** RADIUS is an authorization **input** only | §7.1–§7.4 of the discovery report |
| A2 | **Access is decided at Access-Request.** Accounting and enforcement follow; they never grant access | §13.4 |
| A3 | Every Access-Request failure is **fail-closed**, and no session document is created | §20.1 |
| A4 | `provisionAccess`, `revokeAccess`, `disconnect`, `getUsage` remain **fail-closed** on the RADIUS adapter | `radiusRoamingAAAAdapter.js:403–417` |
| A5 | RADIUS is **not** a usage authority; `getUsage` stays unsupported | §14.2 |

### 23.3 Security invariants

| # | Invariant | Evidence |
|---|---|---|
| S1 | **No phone number, `userId`, or `sub` ever reaches RADIUS** | §10.2; `sub` can be a phone number (`routes/roaming/auth.js:74–113`; `roamingSessionService.js:304–308`) |
| S2 | The profile store holds **configuration only** — never secret material | `radiusProfiles/radiusProfileService.js:44–52`, `radiusTransport/profile.js:80–107` |
| S3 | Secrets never in repository source, client responses, `roaming_sessions`, JWTs, or logs | §7.2, §11.2, §16.1 |
| S4 | No credential path through a public API | Discovery allowlist (`roamingRegistryService.js:616–648`) |
| S5 | No client-supplied infrastructure or secret fields in context | `assertNoClientSuppliedConfig` (`radiusTransport/profile.js:273`), invoked at `radiusRoamingAAAAdapter.js:236` |
| S6 | **Ownership isolation**: `profile.ownerId === hotspot.ownerId` at both write and resolution time | §6.2 |
| S7 | Fail-closed on missing, disabled, malformed or unavailable secrets — never degrade to unauthenticated | §8.4, `radiusTransport/errors.js:22` |

### 23.4 Structural invariants

| # | Invariant | Evidence |
|---|---|---|
| C1 | `backend/services/radius/` stays **networking-free** — 7 files, 0 `dgram`/`net`/`http`/`https`/`dns` imports | §19.3 |
| C2 | `radiusTransport` is the **only** UDP layer; `dgram` is imported only by `radiusTransport/transport.js` | §19.3 |
| C3 | The adapter reaches networking **only** via `radiusTransport/client` — never `dgram` directly | §19.3 |
| C4 | **No duplicate RADIUS implementation.** Phase 8.4 adds configuration, correlation and enforcement glue only | §19.3 |
| C5 | No networking introduced into Phase 7 services | §19.3 |
| C6 | Test-only networking confined to check scripts, loopback UDP only | §19.3 |
| C7 | Dependencies stay injected: profile store and secret resolver | `radiusProfiles/radiusProfileService.js:86–96`, `:178`; `radiusTransport/secrets.js` |
| C8 | **No new npm dependency** for 8.4A–8.4C. A secret-manager client, if chosen, is its own reviewed sub-phase after the provider is locked | §19.3, §7.3 |
| C9 | Firestore only in 8.4C; every other sub-phase stays emulator-free | §19.3 |
| C10 | All four Phase 8.1 / 8.2A / 8.2C / 8.3 checkers stay green and unweakened | Phase 8.3 baseline: 234 assertions |

- **ARCHITECTURAL RECOMMENDATION.** Add a checker assertion for each of C1–C6 so a future phase cannot regress them. This is exactly the pattern the existing Phase 8.2A and 8.3 checkers already use.

---

## 24. Verification Performed, and What Was Deliberately Not Done

### 24.1 Verification

- **FACT.** `backend/scripts/check-roaming-phase8-3.js` was re-run against the baseline. **234 passed, 0 failed.**
- **FACT.** All tracked files are unmodified. `HEAD` and `origin/main` are both `a6f5469234e1cbb67850b4ed77527ef29a9a9dda`.
- **FACT.** The only files added by this work are two untracked Markdown documents: this decision lock and its source discovery report.

### 24.2 Not done — deliberately

| Not done | Why |
|---|---|
| Any code change | This is a decision-lock document. Approval precedes implementation |
| Any Firestore collection, index or rules file | §19.3 — 8.4C only, and only after approval |
| Any dependency in `package.json` | C8 |
| Adapter registration in `server.js` | Gate 3, and §4.2 — the activation sequence is not authorised |
| Any flag change | The activation gate (§17) remains `NOT MET`; `ROAMING_RADIUS_ENABLED` stays `false` |
| Any secret backend implementation | REC-5 / REC-6 are open |
| Any identity or credential implementation | Blocked on OD-1 |
| Weakening of any existing checker | C10 |
| Commit or push | Not requested; nothing has been committed |

### 24.3 Status

**PHASE 8.4 — DECISION LOCK PREPARATION COMPLETE.**
**NO CODE WRITTEN. NO CONFIGURATION CHANGED. NO FIRESTORE TOUCHED. NO DEPENDENCY ADDED. NO FLAG CHANGED.**
**PRODUCTION RADIUS REMAINS DISABLED, UNREGISTERED AND UNREACHABLE.**
**NO COMMIT. NO PUSH.**

**Twelve recommendations recorded (REC-1…REC-12). Twelve decisions remain open (OD-1…OD-12), of which two are explicitly outside Phase 8.4 scope.**
**OD-1 blocks sub-phases 8.4E and 8.4F outright.**
**Next action is approval, not implementation.**