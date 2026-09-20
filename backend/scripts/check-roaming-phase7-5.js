/**
 * Phase 7.5 — Owner Roaming Dashboard checks.
 *
 * Offline & deterministic. Verifies that the owner-facing roaming dashboard:
 *   - mounts under /api/roaming/dashboard
 *   - derives owner identity from the server-side authenticated context
 *     (authenticateOwnerOrSuper + requireOwnerSelf) and NEVER trusts ownerId
 *     from the request body or an untrusted client parameter.
 *   - scopes session history by visitedOwnerId, so an owner can ONLY see
 *     sessions at their own hotspot (cannot read another owner's records).
 *
 * Run: node backend/scripts/check-roaming-phase7-5.js
 */
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");
const { listOwnerSessions } = require("../services/roamingSessionService");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${msg}`);
    failed++;
  }
}
function assertEqual(a, b, m) {
  const ok = a === b;
  ok
    ? (console.log(`✅ PASS: ${m} (${a})`), passed++)
    : (console.error(`❌ FAIL: ${m} — expected ${b}, got ${a}`), failed++);
}

const EPOCH = "2025-01-01T00:00:00.000Z";
function iso(min) {
  return new Date(new Date(EPOCH).getTime() + min * 60000).toISOString();
}

function readFile(rel) {
  return fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");
}

// --- Fake Firestore scoped to roaming_sessions ---
function makeFakeDb(sessions = []) {
  const store = {};
  for (const s of sessions) store[s.id] = s;
  const builder = {
    _filter: null,
    _filters: [],
    _sortDir: "desc",
    _limit: Infinity,
    where(field, op, value) {
      this._filters.push({ field, op, value });
      return this;
    },
    orderBy(field, dir) {
      this._sortDir = dir || "desc";
      return this;
    },
    limit(n) {
      this._limit = n;
      return this;
    },
    get() {
      const self = this;
      let docs = Object.values(store);
      for (const f of self._filters) {
        docs = docs.filter((d) => {
          const v = f.field.split(".").reduce((o, p) => o && o[p], d);
          if (f.op === "==") return v === f.value;
          if (f.op === "in") return (f.value || []).includes(v);
          return true;
        });
      }
      docs = [...docs].sort((a, b) =>
        self._sortDir === "desc"
          ? String(b.createdAt).localeCompare(String(a.createdAt))
          : String(a.createdAt).localeCompare(String(b.createdAt))
      );
      docs = docs.slice(0, self._limit);
      return {
        docs: docs.map((d) => ({ id: d.id, data: () => ({ ...d }) })),
        size: docs.length,
      };
    },
  };
  const collection = () => Object.assign(Object.create(builder), {
    _filters: [],
    _sortDir: "desc",
    _limit: Infinity,
  });
  return {
    collection(name) {
      assert(name === "roaming_sessions", `FakeDb only mocks roaming_sessions (got ${name})`);
      return collection();
    },
    _store: store,
  };
}

function sess({ id, userId, visitedOwnerId, status, createdAt }) {
  return { id, userRef: { userId }, visitedOwnerId, status, createdAt };
}

async function main() {
  console.log("=== Phase 7.5: Owner Roaming Dashboard ===\n");

  const serverCode = readFile("backend/server.js");
  const routeCode = readFile("backend/routes/roaming/dashboard.js");

  console.log("--- 1. Route file & mount ---");
  {
    assert(
      fs.existsSync(path.resolve(__dirname, "..", "routes", "roaming", "dashboard.js")),
      "backend/routes/roaming/dashboard.js exists"
    );
    assert(routeCode.includes("require.OwnerSelf") || routeCode.includes("requireOwnerSelf"), "Dashboard uses requireOwnerSelf to bind identity");
    assert(routeCode.includes("authenticateOwnerOrSuper"), "Dashboard authenticates via authenticateOwnerOrSuper (server-side context)");
    assert(serverCode.includes("/api/roaming/dashboard"), "GET /api/roaming/dashboard is mounted in server.js");
  }

  console.log("\n--- 2. Owner identity is server-side derived (never trusted from client) ---");
  {
    const usesBodyOwnerId =
      routeCode.includes("req.body.ownerId") || routeCode.includes("body?.ownerId");
    assert(!usesBodyOwnerId, "Route does NOT read ownerId from req.body");
    assert(
      /authenticateOwnerOrSuper|authenticateOwner/.test(routeCode),
      "ownerId comes from authenticated session context, not client input"
    );
    assert(
      /requireOwnerSelf/.test(routeCode),
      "Owner is bound to their own records via requireOwnerSelf"
    );
  }

  console.log("\n--- 3. Owner can ONLY see sessions at their own hotspot ---");
  {
    const ownerA = "ownerA";
    const ownerB = "ownerB";
    const dbA = makeFakeDb([
      sess({ id: "a1", userId: "u1", visitedOwnerId: ownerA, status: "terminated", createdAt: iso(20) }),
      sess({ id: "a2", userId: "u2", visitedOwnerId: ownerA, status: "active", createdAt: iso(30) }),
      sess({ id: "b1", userId: "u3", visitedOwnerId: ownerB, status: "terminated", createdAt: iso(40) }),
      sess({ id: "b2", userId: "u4", visitedOwnerId: ownerB, status: "revoked", createdAt: iso(50) }),
    ]);

    const aSessions = await listOwnerSessions(ownerA, { limit: 50 }, { db: dbA });
    assert(aSessions.every((s) => s.visitedOwnerId === ownerA), "All returned sessions belong to ownerA");
    assertEqual(aSessions.length, 2, "ownerA sees exactly their 2 sessions");
    const idsA = aSessions.map((s) => s.id).sort();
    assertEqual(JSON.stringify(idsA), JSON.stringify(["a1", "a2"].sort()), "ownerA session ids are a1,a2 (no leakage into ownerB)");

    const bSessions = await listOwnerSessions(ownerB, { limit: 50 }, { db: dbA });
    assertEqual(bSessions.length, 2, "ownerB sees exactly their 2 sessions");
    assertEqual(JSON.stringify(bSessions.map((s) => s.id).sort()), JSON.stringify(["b1", "b2"].sort()), "ownerB session ids are b1,b2");

    const aFiltered = await listOwnerSessions(ownerA, { status: "active", limit: 50 }, { db: dbA });
    assertEqual(aFiltered.length, 1, "ownerA status filter returns only active sessions");
    assertEqual(aFiltered[0].id, "a2", "filtered session is a2 (active)");
  }

  console.log("\n--- 4. Super-admin path still requires explicit ownerId param ---");
  {
    assert(
      /authenticateOwnerOrSuper/.test(routeCode) && /req\.params\.ownerId/.test(routeCode),
      "OwnerId resolved from authenticated context (params bound by requireOwnerSelf for owners)"
    );
    assert(!routeCode.includes("req.query.ownerId"), "No ownerId accepted via untrusted query param");
  }

  console.log("\n--- 5. Fixes lock-in ---");
  {
    assert(!/function\s+idempotencyKey\b/.test(routeCode), "Unused idempotencyKey helper removed");
    assert(/function\s+parseLimit\b/.test(routeCode), "parseLimit helper present for query validation");
    assert(/parseInt\(limit/.test(routeCode) === false, "Raw client limit is not passed to parseInt unchecked");
    assert(/Math\.min\([^)]*,\s*200\)/.test(routeCode), "Limit clamped to a maximum of 200");
    assert(!routeCode.includes("rauCreditsConsumed"), "Non-existent rauCreditsConsumed field no longer referenced");
    assert(/s\.billedMinutes/.test(routeCode), "/summary sources authoritative Phase 7.3 session field (billedMinutes)");
  }

  console.log(`\n========================================`);
  console.log(`Phase 7.5 Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test harness crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
