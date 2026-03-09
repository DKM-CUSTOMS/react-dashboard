class Cache {
  store = /* @__PURE__ */ new Map();
  ttlMs;
  constructor(ttlSeconds = 60) {
    this.ttlMs = ttlSeconds * 1e3;
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }
  set(key, data) {
    this.store.set(key, { data, timestamp: Date.now() });
  }
  clear() {
    this.store.clear();
  }
}
const monitoringCache = new Cache(60);
export {
  Cache,
  monitoringCache
};
