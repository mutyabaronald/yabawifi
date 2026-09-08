# Phase 4 Roaming Authentication - Firestore Schema

## Overview

Phase 4 introduces dedicated collections for roaming authentication token management and audit logging. These collections are strictly limited to authentication/authorization concerns and do NOT represent roaming sessions.

---

## Collection: `roaming_auth_tokens`

**Purpose**: Token state management for replay protection and token lifecycle tracking.

**Document ID**: JWT `jti` (token ID)

**TTL Strategy**: Documents should expire after token expiration + grace period (e.g., 1 hour). Use Firestore TTL policy or scheduled cleanup.

### Schema

```javascript
{
  // Token identifier (matches JWT jti claim)
  jti: string (required, unique)

  // User identity
  userId: string (required, indexed)

  // Entitlement reference
  entitlementId: string (required, indexed)

  // Federation context
  homeOwnerId: string (required, indexed)
  visitedOwnerId: string (required, indexed)
  visitedHotspotId: string (required, indexed)
  agreementId: string (required, indexed)

  // Authentication path
  authPath: string (required) // "legacy_captive"

  // Token lifecycle status
  status: string (required, indexed)
  // Values: "issued" | "consumed" | "revoked" | "expired"

  // Timestamps
  issuedAt: string (ISO8601, required)
  expiresAt: string (ISO8601, required, indexed for TTL)
  consumedAt: string | null (ISO8601)
  revokedAt: string | null (ISO8601)

  // Revocation details (if revoked)
  revocationReason: string | null

  // Optional metadata
  metadata: object | null

  // Audit trail
  createdAt: string (ISO8601, required)
}
```

### Indexes Required

```javascript
// Composite indexes
{
  collectionGroup: "roaming_auth_tokens",
  fields: [
    { fieldPath: "userId", order: "ASCENDING" },
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "issuedAt", order: "DESCENDING" }
  ]
}

{
  collectionGroup: "roaming_auth_tokens",
  fields: [
    { fieldPath: "visitedOwnerId", order: "ASCENDING" },
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "issuedAt", order: "DESCENDING" }
  ]
}

{
  collectionGroup: "roaming_auth_tokens",
  fields: [
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "expiresAt", order: "ASCENDING" }
  ]
}

// Single-field indexes
- userId (ASCENDING)
- entitlementId (ASCENDING)
- homeOwnerId (ASCENDING)
- visitedOwnerId (ASCENDING)
- visitedHotspotId (ASCENDING)
- status (ASCENDING)
- expiresAt (ASCENDING)
```

### Security Rules (Firestore Rules v2)

```javascript
match /roaming_auth_tokens/{jti} {
  // Only server-side service can write
  allow read: if request.auth != null && request.auth.token.role == 'admin';
  allow write: if false; // Server-side only via Admin SDK
}
```

---

## Collection: `roaming_auth_logs`

**Purpose**: Audit trail for roaming authentication events.

**Document ID**: Auto-generated

**TTL Strategy**: Archive logs older than 90 days or as per compliance requirements.

### Schema

```javascript
{
  // Event type
  eventType: string (required, indexed)
  // Values: "token_issued" | "token_validated" | "token_consumed" | 
  //         "token_revoked" | "auth_denied" | "validation_failed"

  // User identity
  userId: string (required, indexed)

  // Entitlement reference
  entitlementId: string | null (indexed)

  // Federation context
  homeOwnerId: string | null (indexed)
  visitedOwnerId: string | null (indexed)
  visitedHotspotId: string | null (indexed)

  // Token identifier
  jti: string | null (indexed)

  // Event outcome
  success: boolean (required, indexed)

  // Denial/error details (if applicable)
  reason: string | null
  message: string | null
  errorCode: string | null

  // Optional context
  metadata: object | null

  // Timestamp
  timestamp: string (ISO8601, required, indexed)
}
```

### Indexes Required

```javascript
// Composite indexes
{
  collectionGroup: "roaming_auth_logs",
  fields: [
    { fieldPath: "eventType", order: "ASCENDING" },
    { fieldPath: "timestamp", order: "DESCENDING" }
  ]
}

{
  collectionGroup: "roaming_auth_logs",
  fields: [
    { fieldPath: "userId", order: "ASCENDING" },
    { fieldPath: "timestamp", order: "DESCENDING" }
  ]
}

{
  collectionGroup: "roaming_auth_logs",
  fields: [
    { fieldPath: "success", order: "ASCENDING" },
    { fieldPath: "timestamp", order: "DESCENDING" }
  ]
}

{
  collectionGroup: "roaming_auth_logs",
  fields: [
    { fieldPath: "visitedOwnerId", order: "ASCENDING" },
    { fieldPath: "eventType", order: "ASCENDING" },
    { fieldPath: "timestamp", order: "DESCENDING" }
  ]
}

// Single-field indexes
- eventType (ASCENDING)
- userId (ASCENDING)
- entitlementId (ASCENDING)
- homeOwnerId (ASCENDING)
- visitedOwnerId (ASCENDING)
- jti (ASCENDING)
- success (ASCENDING)
- timestamp (DESCENDING)
```

### Security Rules (Firestore Rules v2)

```javascript
match /roaming_auth_logs/{logId} {
  // Only server-side service can write
  // Admins can read for audit purposes
  allow read: if request.auth != null && request.auth.token.role == 'admin';
  allow write: if false; // Server-side only via Admin SDK
}
```

---

## Collection Relationships

```
roaming_entitlements (Phase 3)
    ↓
roaming_auth_tokens (Phase 4)
    ↓
roaming_auth_logs (Phase 4)
```

**Key Points**:
- `roaming_auth_tokens` references `entitlementId` from Phase 3
- `roaming_auth_tokens` is NOT a session store
- Token documents should be cleaned up after expiration
- Logs provide audit trail for compliance and security monitoring

---

## Maintenance Operations

### Token Cleanup (Scheduled Function)

```javascript
// Clean up expired tokens older than 1 hour
const cutoff = new Date(Date.now() - 3600000).toISOString();

await db.collection("roaming_auth_tokens")
  .where("expiresAt", "<", cutoff)
  .get()
  .then(snapshot => {
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  });
```

### Log Archival (Scheduled Function)

```javascript
// Archive logs older than 90 days
const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();

await db.collection("roaming_auth_logs")
  .where("timestamp", "<", cutoff)
  .limit(500)
  .get()
  .then(snapshot => {
    // Archive to cold storage or delete
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  });
```

---

## Security Considerations

1. **Token Storage**: Tokens contain sensitive authorization context. Access is restricted to server-side Admin SDK only.

2. **JTI Uniqueness**: Each `jti` MUST be cryptographically random (16 bytes minimum) to prevent collisions and guessing attacks.

3. **Replay Protection**: Token status transitions are one-way:
   - `issued` → `consumed` (normal flow)
   - `issued` → `revoked` (administrative action)
   - `consumed` → cannot be reused
   - `revoked` → cannot be reused

4. **Context Binding**: Tokens are bound to specific:
   - User (`userId`)
   - Entitlement (`entitlementId`)
   - Home owner (`homeOwnerId`)
   - Visited owner (`visitedOwnerId`)
   - Visited hotspot (`visitedHotspotId`)
   
   Validation MUST verify all context fields match.

5. **Audit Trail**: All authentication events MUST be logged for security monitoring and compliance.

6. **TTL Enforcement**: Expired tokens MUST be rejected even if not yet cleaned up from the database.

---

## Phase Boundaries

**Phase 4 ONLY manages authentication/authorization tokens.**

Phase 4 does NOT create:
- `roaming_sessions` (Phase 5)
- Router provisioning records (Phase 6)
- Network access records (Phase 7)
- RADIUS session state (Phase 8)

The Phase 4 token authorizes roaming access but does NOT itself grant network connectivity.

---

## Firestore Console Commands

### Create Indexes

Run these commands in Firebase CLI:

```bash
firebase firestore:indexes
```

Or deploy the index configuration file.

### Enable TTL

Configure Firestore TTL policy for `roaming_auth_tokens.expiresAt` field with 1-hour grace period.

---

**Document Version**: 1.0  
**Phase**: 4 (Authentication/Authorization)  
**Status**: Implementation Complete  
**Last Updated**: 2026-09-07
