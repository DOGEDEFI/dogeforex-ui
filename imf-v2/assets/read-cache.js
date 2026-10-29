(() => {
  'use strict';

  // Hourly read cache for public read-only V2 dashboard analytics.
  // Foundation module: no consumer is required to load it. When loaded before
  // v2.js/discovery.js it exposes window.IMF_READ_CACHE; those modules use it
  // only when present and only for public read-only analytics. Guided action,
  // quote and prepare paths always read fresh state and never consult cache.

  const SCHEMA = 'imf.v2.readcache.v1';
  const IDENTITY_SCHEMA = 1;
  const TTL_MS = 3600000;
  const ERROR_TTL_MS = 300000;
  const MAX_ENTRIES = 240;
  const MAX_ENTRY_BYTES = 262144;
  const MAX_STORE_BYTES = 4194304;
  const BIG_INT_TAG = '$bigint';

  function sha256Hex(message) {
    const bytes = new TextEncoder().encode(message);
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const bitLengthHi = Math.floor(bytes.length / 0x20000000);
    const bitLengthLo = (bytes.length << 3) >>> 0;
    const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, bitLengthHi);
    view.setUint32(paddedLength - 4, bitLengthLo);
    const w = new Uint32Array(64);
    for (let block = 0; block < paddedLength; block += 64) {
      for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(block + t * 4);
      for (let t = 16; t < 64; t += 1) {
        const s0 = (rotr(w[t - 15], 7)) ^ (rotr(w[t - 15], 18)) ^ (w[t - 15] >>> 3);
        const s1 = (rotr(w[t - 2], 17)) ^ (rotr(w[t - 2], 19)) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let t = 0; t < 64; t += 1) {
        const s1 = (rotr(e, 6)) ^ (rotr(e, 11)) ^ (rotr(e, 25));
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choose + K[t] + w[t]) >>> 0;
        const s0 = (rotr(a, 2)) ^ (rotr(a, 13)) ^ (rotr(a, 22));
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
  }

  function rotr(value, shift) {
    return ((value >>> shift) | (value << (32 - shift))) >>> 0;
  }

  function canonicalize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }

  function digestJson(value) {
    return sha256Hex(canonicalize(value === undefined ? null : value));
  }

  function encodeBigInts(value) {
    return JSON.parse(JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? { [BIG_INT_TAG]: entry.toString() } : entry));
  }

  function decodeBigInts(value) {
    return JSON.parse(JSON.stringify(value), (_, entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length === 1 && typeof entry[BIG_INT_TAG] === 'string') {
        try {
          return BigInt(entry[BIG_INT_TAG]);
        } catch {
          return entry;
        }
      }
      return entry;
    });
  }

  function identityFor({ chainId, rpcUrl, source, registry }) {
    const raw = registry && typeof registry === 'object' && registry.linkedData ? registry.linkedData : registry;
    return {
      schema: IDENTITY_SCHEMA,
      chainId: String(chainId),
      rpcUrl: String(rpcUrl),
      source: String(source),
      registryDigest: digestJson(raw ?? null),
    };
  }

  function sameIdentity(left, right) {
    return Boolean(left && right)
      && left.schema === IDENTITY_SCHEMA
      && right.schema === IDENTITY_SCHEMA
      && left.chainId === right.chainId
      && left.rpcUrl === right.rpcUrl
      && left.source === right.source
      && left.registryDigest === right.registryDigest;
  }

  function isFixtureIdentity(identity) {
    return identity.source === 'fixture' || identity.rpcUrl === 'fixture://v2';
  }

  function compoundKey(kind, key, currency) {
    return `${kind}${key}${currency ?? ''}`;
  }

  function defaultStorage() {
    try {
      const storage = window.localStorage;
      const probe = '__imf_read_cache_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    } catch {
      return null;
    }
  }

  function byteSize(text) {
    return new TextEncoder().encode(text).length;
  }

  function createCache(identity, options = {}) {
    if (!identity || !sameIdentity(identity, identity)) throw new Error('read-cache: a complete identity (chainId, rpcUrl, source, registryDigest) is required');
    const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : TTL_MS;
    const errorTtlMs = Number.isFinite(options.errorTtlMs) ? options.errorTtlMs : ERROR_TTL_MS;
    const storage = options.storage !== undefined ? options.storage : defaultStorage();
    const persist = options.persist !== undefined ? options.persist : !isFixtureIdentity(identity) && storage !== null;
    const memory = new Map();
    const memoryErrors = new Map();
    let epoch = 0;
    let lastReceipt = null;
    let persisted = false;

    function envelope() {
      return {
        schema: SCHEMA,
        identity,
        epoch,
        lastReceipt,
        entries: [...memory.values()],
        errors: [...memoryErrors.values()],
      };
    }

    function loadStored() {
      if (!persist || !storage) return false;
      let raw;
      try {
        raw = storage.getItem(SCHEMA);
      } catch {
        return false;
      }
      if (!raw) return false;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return false;
      }
      if (!parsed || parsed.schema !== SCHEMA || !sameIdentity(parsed.identity, identity)) return false;
      epoch = Number.isSafeInteger(parsed.epoch) ? parsed.epoch : 0;
      lastReceipt = parsed.lastReceipt ?? null;
      for (const entry of Array.isArray(parsed.entries) ? parsed.entries : []) {
        if (entry && typeof entry.kind === 'string' && typeof entry.key === 'string' && typeof entry.fetchedAt === 'number') {
          memory.set(compoundKey(entry.kind, entry.key, entry.currency), entry);
        }
      }
      for (const error of Array.isArray(parsed.errors) ? parsed.errors : []) {
        if (error && typeof error.kind === 'string' && typeof error.key === 'string' && typeof error.retryAfter === 'number') {
          memoryErrors.set(compoundKey(error.kind, error.key, error.currency), error);
        }
      }
      evict();
      persisted = true;
      return true;
    }

    function evict() {
      const entries = [...memory.values()].sort((left, right) => left.fetchedAt - right.fetchedAt);
      while (memory.size > MAX_ENTRIES || envelopeBytes() > MAX_STORE_BYTES) {
        const oldest = entries.shift();
        if (!oldest) break;
        memory.delete(compoundKey(oldest.kind, oldest.key, oldest.currency));
      }
    }

    function envelopeBytes() {
      return byteSize(JSON.stringify(envelope()));
    }

    function save() {
      if (!persist || !storage) return false;
      try {
        evict();
        storage.setItem(SCHEMA, JSON.stringify(envelope()));
        persisted = true;
        return true;
      } catch {
        return false;
      }
    }

    function get(kind, key, currency, now = Date.now()) {
      const entry = memory.get(compoundKey(kind, key, currency));
      if (!entry) return { status: 'miss' };
      if (currency !== undefined && currency !== null && entry.currency !== currency) return { status: 'miss' };
      if (entry.epoch < epoch) return { status: 'stale', reason: 'written before the last recorded on-chain receipt', fetchedAt: entry.fetchedAt };
      if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) return { status: 'expired', value: decodeBigInts(entry.value), fetchedAt: entry.fetchedAt, sourceBlock: entry.sourceBlock ?? null, coverage: entry.coverage ?? null };
      return {
        status: 'hit',
        value: decodeBigInts(entry.value),
        currency: entry.currency ?? null,
        fetchedAt: entry.fetchedAt,
        remainingMs: entry.expiresAt - now,
        sourceBlock: entry.sourceBlock ?? null,
        coverage: entry.coverage ?? null,
      };
    }

    function set(kind, key, currency, value, meta = {}) {
      const now = Number.isFinite(meta.fetchedAt) ? meta.fetchedAt : Date.now();
      const entry = {
        kind,
        key,
        currency: currency ?? null,
        fetchedAt: now,
        expiresAt: now + ttlMs,
        epoch,
        sourceBlock: meta.sourceBlock ?? null,
        coverage: meta.coverage ?? null,
        value: encodeBigInts(value),
      };
      if (byteSize(JSON.stringify(entry)) > MAX_ENTRY_BYTES) return { stored: false, reason: 'entry exceeds the local read-cache size cap' };
      memory.set(compoundKey(kind, key, currency), entry);
      evict();
      save();
      return { stored: true, fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt };
    }

    function getError(kind, key, currency, now = Date.now()) {
      const error = memoryErrors.get(compoundKey(kind, key, currency));
      if (!error) return null;
      if (currency !== undefined && currency !== null && error.currency !== currency) return null;
      if (error.retryAfter <= now) return null;
      return { message: error.message, failedAt: error.failedAt, retryAfter: error.retryAfter };
    }

    function setError(kind, key, currency, message, now = Date.now()) {
      memoryErrors.set(compoundKey(kind, key, currency), {
        kind,
        key,
        currency: currency ?? null,
        failedAt: now,
        retryAfter: now + errorTtlMs,
        message: String(message).slice(0, 300),
      });
      save();
    }

    function onReceipt(receipt = {}) {
      epoch += 1;
      lastReceipt = {
        at: Date.now(),
        blockNumber: Number.isSafeInteger(receipt.blockNumber) ? receipt.blockNumber : null,
        transactionHash: typeof receipt.transactionHash === 'string' ? receipt.transactionHash : null,
      };
      memoryErrors.clear();
      save();
      return lastReceipt;
    }

    function invalidateCurrency(code) {
      let removed = 0;
      for (const [compound, entry] of memory) {
        if (entry.currency === code) {
          memory.delete(compound);
          removed += 1;
        }
      }
      for (const [compound, error] of memoryErrors) {
        if (error.currency === code) memoryErrors.delete(compound);
      }
      save();
      return removed;
    }

    function invalidateIdentity(next = identity) {
      if (!sameIdentity(next, identity)) return 0;
      const removed = memory.size;
      memory.clear();
      memoryErrors.clear();
      epoch += 1;
      save();
      return removed;
    }

    function stats() {
      const entries = [...memory.values()];
      return {
        schema: SCHEMA,
        identity,
        persist,
        persisted,
        entries: entries.length,
        errors: memoryErrors.size,
        epoch,
        lastReceipt,
        oldestFetchedAt: entries.length ? Math.min(...entries.map((entry) => entry.fetchedAt)) : null,
        newestFetchedAt: entries.length ? Math.max(...entries.map((entry) => entry.fetchedAt)) : null,
        bytes: persist ? envelopeBytes() : 0,
        byKind: entries.reduce((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] ?? 0) + 1 }), {}),
      };
    }

    loadStored();
    return {
      identity,
      ttlMs,
      errorTtlMs,
      persist,
      get,
      set,
      getError,
      setError,
      onReceipt,
      invalidateCurrency,
      invalidateIdentity,
      stats,
      flush: save,
    };
  }

  let shared = null;

  function configureShared(identity, options = {}) {
    if (shared && sameIdentity(shared.identity, identity)) return shared;
    shared = createCache(identity, options);
    return shared;
  }

  window.IMF_READ_CACHE = {
    schema: SCHEMA,
    version: 1,
    identitySchema: IDENTITY_SCHEMA,
    ttlMs: TTL_MS,
    errorTtlMs: ERROR_TTL_MS,
    maxEntries: MAX_ENTRIES,
    maxEntryBytes: MAX_ENTRY_BYTES,
    maxStoreBytes: MAX_STORE_BYTES,
    sha256Hex,
    digestJson,
    encode: encodeBigInts,
    decode: decodeBigInts,
    identityFor,
    sameIdentity,
    isFixtureIdentity,
    create: createCache,
    configureShared,
    shared: () => shared,
    clearShared: () => {
      shared = null;
    },
  };
})();
