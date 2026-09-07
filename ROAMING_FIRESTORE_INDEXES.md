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
