"use strict";

// In-memory Firestore mock for device route and credential lifecycle tests.
// Supports collections, documents, subcollections, get/set/update/delete,
// runTransaction, and where/orderBy/limit/query chains.
// Data is isolated per mock instance; no cross-test leakage.

class MockDocumentSnapshot {
  constructor(ref, data, exists) {
    this.ref = ref;
    this._data = data || null;
    this.exists = exists === true;
    this.createTime = new Date().toISOString();
    this.updateTime = new Date().toISOString();
    this.readTime = new Date().toISOString();
  }
  data() {
    return this.exists ? { ...this._data } : undefined;
  }
  get(path) {
    if (!this.exists || !this._data) return undefined;
    const parts = String(path).split(".");
    let cur = this._data;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  }
  id() {
    return this.ref.id;
  }
}

class MockDocumentReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
    this.id = path.split("/").pop();
    this.parent = null;
  }

  collection(subPath) {
    const col = new MockCollectionReference(this.firestore, this.path + "/" + subPath);
    col.parent = this;
    return col;
  }

  doc(docPath) {
    const childPath = this.path + "/" + docPath;
    const ref = new MockDocumentReference(this.firestore, childPath);
    ref.parent = this;
    return ref;
  }

  async get() {
    return this.firestore.getDoc(this.path);
  }

  async set(data, options = {}) {
    await this.firestore.setDoc(this.path, data, { merge: options.merge || false });
    return { writeTime: new Date().toISOString() };
  }

  async update(data) {
    await this.firestore.updateDoc(this.path, data);
    return { writeTime: new Date().toISOString() };
  }

  async delete() {
    await this.firestore.deleteDoc(this.path);
    return {};
  }

  async onSnapshot() {
    return () => {};
  }
}

class MockQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
    this.query = null;
  }
  forEach(fn) {
    this.docs.forEach(fn);
  }
}

class MockCollectionReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
    this.id = path.split("/").pop();
    this.parent = null;
    this._orderBy = null;
    this._whereFilters = [];
    this._limitVal = null;
  }

  doc(docPath) {
    const ref = new MockDocumentReference(this.firestore, this.path + "/" + docPath);
    ref.parent = this;
    return ref;
  }

  async get() {
    const docs = await this.firestore.queryDocs(this.path, {
      where: this._whereFilters,
      orderBy: this._orderBy,
      limit: this._limitVal,
    });
    return new MockQuerySnapshot(docs);
  }

  async add(data) {
    const id = require("crypto").randomBytes(16).toString("hex");
    const ref = this.doc(id);
    await ref.set(data);
    return ref;
  }

  where(field, op, value) {
    this._whereFilters.push({ field, op, value });
    return this;
  }

  orderBy(field, direction) {
    this._orderBy = { field, direction: direction || "asc" };
    return this;
  }

  limit(n) {
    this._limitVal = n;
    return this;
  }

  onSnapshot() {
    return () => {};
  }
}

class MockFirestore {
  constructor() {
    this.docs = new Map(); // path -> { data, createdAt, updatedAt }
    this.autoIdCounter = 0;
  }

  collection(path) {
    const col = new MockCollectionReference(this, path);
    col.parent = null;
    return col;
  }

  doc(path) {
    const ref = new MockDocumentReference(this, path);
    ref.parent = null;
    return ref;
  }

  async getDoc(path) {
    const entry = this.docs.get(path);
    if (!entry) return new MockDocumentSnapshot({ path, id: path.split("/").pop() }, null, false);
    return new MockDocumentSnapshot({ path, id: path.split("/").pop() }, entry.data, true);
  }

  async setDoc(path, data, options = {}) {
    const existing = this.docs.get(path);
    const now = new Date().toISOString();
    const merged = options.merge && existing ? { ...existing.data, ...data } : { ...data };
    if (existing && options.merge) {
      merged.updatedAt = now;
    } else {
      merged.createdAt = now;
      merged.updatedAt = now;
    }
    this.docs.set(path, { data: merged, createdAt: merged.createdAt, updatedAt: merged.updatedAt });
  }

  async updateDoc(path, data) {
    const existing = this.docs.get(path);
    if (!existing) {
      const err = new Error("Document does not exist");
      err.code = "not-found";
      throw err;
    }
    const merged = { ...existing.data, ...data };
    // Only set updatedAt if not explicitly provided in the data
    if (!merged.updatedAt) {
      merged.updatedAt = new Date().toISOString();
    }
    this.docs.set(path, { data: merged, createdAt: existing.createdAt, updatedAt: merged.updatedAt });
  }

  async deleteDoc(path) {
    this.docs.delete(path);
  }

  async queryDocs(collectionPath, filters = {}) {
    const prefix = collectionPath + "/";
    let results = [];
    for (const [path, entry] of this.docs) {
      if (path.startsWith(prefix)) {
        const remaining = path.slice(prefix.length);
        if (remaining.includes("/")) continue; // only direct children
        results.push({ path, id: remaining, data: entry.data });
      }
    }

    if (filters.where && filters.where.length > 0) {
      for (const f of filters.where) {
        results = results.filter((r) => {
          const val = r.data[f.field];
          switch (f.op) {
            case "==": return val === f.value;
            case "!=": return val !== f.value;
            case "<": return val < f.value;
            case "<=": return val <= f.value;
            case ">": return val > f.value;
            case ">=": return val >= f.value;
            case "array-contains": return Array.isArray(val) && val.includes(f.value);
            default: return true;
          }
        });
      }
    }

    if (filters.orderBy) {
      const dir = filters.orderBy.direction === "desc" ? -1 : 1;
      results.sort((a, b) => {
        const av = a.data[filters.orderBy.field];
        const bv = b.data[filters.orderBy.field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1 * dir;
        if (bv === null || bv === undefined) return -1 * dir;
        return (av < bv ? -1 : 1) * dir;
      });
    }

    if (filters.limit !== null && filters.limit !== undefined) {
      results = results.slice(0, filters.limit);
    }

    return results.map((r) => new MockDocumentSnapshot(
      { path: r.path, id: r.id },
      r.data,
      true
    ));
  }

  async runTransaction(fn) {
    const tx = new MockTransaction(this);
    const result = await fn(tx);
    await tx.commit();
    return result;
  }

  clear() {
    this.docs.clear();
  }

  getAllDocs() {
    return new Map(this.docs);
  }
}

class MockTransaction {
  constructor(firestore) {
    this.firestore = firestore;
    this.writes = [];
    this.committed = false;
  }

  async get(docRef) {
    return this.firestore.getDoc(docRef.path);
  }

  create(docRef, data) {
    this.writes.push({ type: "create", path: docRef.path, data });
  }

  set(docRef, data, options = {}) {
    const merge = options.merge || false;
    if (merge) {
      const existing = this.firestore.docs.get(docRef.path);
      if (existing) {
        this.writes.push({ type: "update", path: docRef.path, data });
      } else {
        this.writes.push({ type: "create", path: docRef.path, data });
      }
    } else {
      this.writes.push({ type: "create", path: docRef.path, data });
    }
  }

  update(docRef, data) {
    this.writes.push({ type: "update", path: docRef.path, data });
  }

  delete(docRef) {
    this.writes.push({ type: "delete", path: docRef.path });
  }

  async commit() {
    if (this.committed) throw new Error("Transaction already committed");
    this.committed = true;
    for (const w of this.writes) {
      if (w.type === "create") {
        const existing = this.firestore.docs.get(w.path);
        if (existing) {
          const err = new Error("Document already exists");
          err.code = "already-exists";
          throw err;
        }
        await this.firestore.setDoc(w.path, w.data, { merge: false });
      } else if (w.type === "update") {
        await this.firestore.updateDoc(w.path, w.data);
      } else if (w.type === "delete") {
        await this.firestore.deleteDoc(w.path);
      }
    }
  }
}

module.exports = {
  MockFirestore,
  MockDocumentReference,
  MockCollectionReference,
  MockDocumentSnapshot,
  MockQuerySnapshot,
  MockTransaction,
};
