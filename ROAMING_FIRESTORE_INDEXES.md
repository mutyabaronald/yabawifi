# Roaming Federation Firestore Indexes

## Phase 2: Roaming Registry

### Collection: `roaming_partners`

**Single-field indexes (automatic):**
- `federationStatus` (ascending/descending)
- `ownerId` (document ID, automatic)

**Composite indexes:**
None required for Phase 2 queries.

### Collection: `roaming_hotspots`

**Single-field indexes (automatic):**
- `partnerStatus` (ascending/descending)
- `ownerId` (ascending/descending)
- `hotspotId` (document ID, automatic)

**Composite indexes:**
None required for Phase 2 queries.

---

## Phase 3: Roaming Entitlements

### Collection: `roaming_entitlements`

**Single-field indexes (automatic):**
- `status` (ascending/descending)
- `homeOwnerId` (ascending/descending)
- `scope` (ascending/descending)
- `source` (ascending/descending)
- `id` (document ID, automatic)

**Composite indexes required:**

1. **Query entitlements by user and status:**
   - Collection: `roaming_entitlements`
   - Fields:
     - `userRef.userId` (ascending)
     - `status` (ascending)
   - Query modes: Collection

2. **Query entitlements by home owner and status:**
   - Collection: `roaming_entitlements`
   - Fields:
     - `homeOwnerId` (ascending)
     - `status` (ascending)
   - Query modes: Collection

3. **Query active entitlements by user (eligibility check):**
   - Collection: `roaming_entitlements`
   - Fields:
     - `userRef.userId` (ascending)
     - `status` (ascending)
     - `validity.expiresAt` (ascending)
   - Query modes: Collection
   - **Note:** This is for future optimization when filtering expired entitlements

4. **Query entitlements by idempotency key:**
   - Collection: `roaming_entitlements`
   - Fields:
     - `lastIdempotencyKey` (ascending)
   - Query modes: Collection

---

## Creating Indexes in Firebase Console

1. Go to Firebase Console → Firestore Database → Indexes
2. Click "Create Index"
3. Select collection: `roaming_entitlements`
4. Add fields as specified above
5. Set query scope: Collection
6. Click "Create Index"

Wait for indexes to build before running queries that depend on them.

---

## Creating Indexes via Firebase CLI

Add to `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "roaming_entitlements",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userRef.userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "roaming_entitlements",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "homeOwnerId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "roaming_entitlements",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userRef.userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "validity.expiresAt", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

Deploy with:
```bash
firebase deploy --only firestore:indexes
```

---

## Query Performance Notes

- The eligibility check (`checkEntitlementEligibility`) currently queries by `userRef.userId` and `status`
- Future optimization may add filtering by `validity.expiresAt` to exclude already-expired entitlements at query time
- Current implementation performs expiry validation in application code after retrieval
- List operations are limited to 100 results by default to prevent excessive reads

---

## Index Build Status

After creating indexes, check build status in Firebase Console:
- Firestore Database → Indexes tab
- Wait for status to show "Enabled" (green checkmark)
- Building can take several minutes for existing collections

---

## Phase 3 Note

Phase 3 introduces the entitlements domain but does not implement actual network access.
The indexes support permission/eligibility lookups only.
Network session tracking and RADIUS integration are deferred to later phases.

---

## Phase 4: Roaming Authentication Tokens

### Collection: `roaming_auth_tokens`

**Single-field indexes (automatic):**
- `status` (ascending/descending)
- `userId` (ascending/descending)
- `expiresAt` (ascending/descending)
- `jti` (document ID, automatic)

**Composite indexes required:**

1. **Query tokens by user and status:**
   - Collection: `roaming_auth_tokens`
   - Fields:
     - `userId` (ascending)
     - `status` (ascending)

2. **Query tokens by status and expiration (cleanup):**
   - Collection: `roaming_auth_tokens`
   - Fields:
     - `status` (ascending)
     - `expiresAt` (ascending)

3. **Query tokens by entitlement:**
   - Collection: `roaming_auth_tokens`
   - Fields:
     - `entitlementId` (ascending)
     - `status` (ascending)

### Collection: `roaming_auth_logs`

**Single-field indexes (automatic):**
- `eventType` (ascending/descending)
- `userId` (ascending/descending)
- `timestamp` (ascending/descending)

### CLI indexes:

Add to `firestore.indexes.json`:

```json
{
  "collectionGroup": "roaming_auth_tokens",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "roaming_auth_tokens",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "expiresAt", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "roaming_auth_tokens",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "entitlementId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

### TTL Configuration:

Set Firestore TTL policy on `roaming_auth_tokens.expiresAt` so expired tokens are automatically deleted.

---

## Phase 5: Roaming Sessions

### Collection: `roaming_sessions`

**Single-field indexes (automatic):**
- `status` (ascending/descending)
- `userRef.userId` (ascending/descending)
- `homeOwnerId` (ascending/descending)
- `visitedOwnerId` (ascending/descending)
- `entitlementId` (ascending/descending)
- `visitedHotspotId` (ascending/descending)
- `expiresAt` (ascending/descending)
- `createdAt` (ascending/descending)
- `idempotencyKey` (ascending/descending)
- `lastActivityAt` (ascending/descending)

**Composite indexes required:**

1. **List user sessions by user and status:**
   - Collection: `roaming_sessions`
   - Fields:
     - `userRef.userId` (ascending)
     - `status` (ascending)
     - `createdAt` (descending)

2. **List owner sessions by visited owner:**
   - Collection: `roaming_sessions`
   - Fields:
     - `visitedOwnerId` (ascending)
     - `status` (ascending)
     - `createdAt` (descending)

3. **List owner sessions by home owner:**
   - Collection: `roaming_sessions`
   - Fields:
     - `homeOwnerId` (ascending)
     - `status` (ascending)
     - `createdAt` (descending)

4. **Check max concurrent sessions per user+entitlement:**
   - Collection: `roaming_sessions`
   - Fields:
     - `userRef.userId` (ascending)
     - `entitlementId` (ascending)
     - `status` (ascending)

5. **Idempotency key lookup:**
   - Collection: `roaming_sessions`
   - Fields:
     - `idempotencyKey` (ascending)

6. **Batch expiration query:**
   - Collection: `roaming_sessions`
   - Fields:
     - `status` (ascending)
     - `expiresAt` (ascending)

7. **List user sessions (default):**
   - Collection: `roaming_sessions`
   - Fields:
     - `userRef.userId` (ascending)
     - `createdAt` (descending)

8. **List owner sessions (default):**
   - Collection: `roaming_sessions`
   - Fields:
     - `visitedOwnerId` (ascending)
     - `createdAt` (descending)

### CLI indexes:

```json
{
  "collectionGroup": "roaming_sessions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userRef.userId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "roaming_sessions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "visitedOwnerId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "roaming_sessions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "homeOwnerId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "roaming_sessions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userRef.userId", "order": "ASCENDING" },
    { "fieldPath": "entitlementId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "roaming_sessions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "idempotencyKey", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "roaming_sessions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "expiresAt", "order": "ASCENDING" }
  ]
}
```

### TTL Configuration:

Set Firestore TTL policy on `roaming_sessions.expiresAt` so expired sessions are automatically deleted.

### Note on `status IN` queries:

Queries using `where("status", "in", ["authorized", "active"])` require a composite index on `status` alone, plus a collection-scope index. The indexes above cover the `status` field in composite queries.

---

## Phase 5 Note

Phase 5 implements the roaming session lifecycle as a separate bounded context
from existing `wifi_sessions` and `sessions` collections. It tracks session
state transitions, idempotency, and max-concurrent-sessions enforcement.
Network enforcement, RADIUS, and router configuration are handled in Phase 7+.
