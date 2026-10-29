import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';

// Operational check for the IMF hourly read-cache foundation. Runs the real
// browser modules (assets/read-cache.js, assets/discovery.js, assets/v2.js
// hooks) in a vm sandbox with a controllable clock and localStorage stub.
// No provider, signer, build step or network access is involved.

const root = new URL('../', import.meta.url).pathname;
let now = 1700000000000;
class FakeDate extends Date {
  static now() {
    return now;
  }
}

function makeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    size: () => data.size,
  };
}

function makeContext(storage) {
  const context = {
    console,
    URL,
    TextEncoder,
    TextDecoder,
    Date: FakeDate,
    JSON,
    Math,
    Promise,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    BigInt,
    Intl,
  };
  context.window = context;
  context.self = context;
  context.localStorage = storage;
  context.document = { querySelector: () => null, querySelectorAll: () => [] };
  vm.createContext(context);
  return context;
}

function run(context, file) {
  vm.runInContext(fs.readFileSync(`${root}${file}`, 'utf8'), context, { filename: file });
}

const storage = makeStorage();
const context = makeContext(storage);
run(context, 'assets/read-cache.js');
run(context, 'assets/discovery.js');
run(context, 'assets/v2.js');
const READ_CACHE = context.IMF_READ_CACHE;
const DISCOVERY = context.IMF_DISCOVERY;
const V2_APP = context.IMF_V2_APP;
assert.ok(READ_CACHE, 'window.IMF_READ_CACHE is exposed');
assert.equal(READ_CACHE.schema, 'imf.v2.readcache.v1');
assert.equal(READ_CACHE.ttlMs, 3600000);
assert.equal(READ_CACHE.errorTtlMs, 300000);
assert.equal(READ_CACHE.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

// BigInt-safe serialization round-trip, including nested values.
const original = { amount: 123456789012345678901234567890n, list: [1n, 'plain', { inner: -42n }], flag: true };
const restored = READ_CACHE.decode(READ_CACHE.encode(original));
assert.equal(restored.amount, original.amount);
assert.equal(restored.list[0], 1n);
assert.equal(restored.list[2].inner, -42n);
assert.equal(restored.flag, true);
assert.equal(typeof JSON.parse(JSON.stringify(READ_CACHE.encode(original))).amount, 'object');

// Identity digests are canonical and cover chainId + rpcUrl + source + registry.
const registryRaw = { linkedData: { network: 'chikyuV2', code: 'USD', addresses: { Token: '0xtoken' } } };
const identity = READ_CACHE.identityFor({ chainId: 6281971, rpcUrl: 'https://rpc.testnet.dogeos.com', source: 'runtime-config', registry: registryRaw });
const identityReordered = READ_CACHE.identityFor({ chainId: 6281971, rpcUrl: 'https://rpc.testnet.dogeos.com', source: 'runtime-config', registry: { linkedData: { addresses: { Token: '0xtoken' }, code: 'USD', network: 'chikyuV2' } } });
assert.equal(identity.registryDigest, identityReordered.registryDigest, 'registry digest is canonical across key order');
assert.ok(!READ_CACHE.sameIdentity(identity, { ...identity, rpcUrl: 'https://else.example' }));
assert.ok(!READ_CACHE.sameIdentity(identity, { ...identity, registryDigest: READ_CACHE.digestJson({ other: true }) }));
assert.ok(!READ_CACHE.sameIdentity(identity, { ...identity, chainId: '1' }));
assert.ok(!READ_CACHE.sameIdentity(identity, { ...identity, source: 'local-file' }));

// TTL semantics: hourly hit, then expiry.
const cache = READ_CACHE.create(identity, { storage });
now += 1000;
assert.equal(cache.set('snapshot', 'token', 'USD', original, { sourceBlock: { number: 5, hash: '0xh', timestamp: '99' }, coverage: { complete: true } }).stored, true);
let hit = cache.get('snapshot', 'token', 'USD');
assert.equal(hit.status, 'hit');
assert.equal(hit.value.amount, original.amount);
assert.equal(hit.sourceBlock.number, 5);
assert.equal(hit.coverage.complete, true);
assert.equal(hit.remainingMs, 3600000);
now += 3600000 + 1;
assert.equal(cache.get('snapshot', 'token', 'USD').status, 'expired');
assert.equal(cache.get('snapshot', 'token', 'EUR').status, 'miss', 'wrong currency is a miss');

// Transient error window: 300000 ms.
now += 1000;
cache.setError('snapshot', 'token', 'USD', 'rpc down');
assert.equal(cache.getError('snapshot', 'token', 'USD').message, 'rpc down');
now += 300000 + 1;
assert.equal(cache.getError('snapshot', 'token', 'USD'), null);

// Malformed storage and wrong-identity storage are rejected, not served.
const evilStorage = makeStorage();
evilStorage.setItem('imf.v2.readcache.v1', '{not json');
let evilCache = READ_CACHE.create(identity, { storage: evilStorage });
assert.equal(evilCache.get('snapshot', 'token', 'USD').status, 'miss');
evilStorage.setItem('imf.v2.readcache.v1', JSON.stringify({ schema: 'something.else', identity, entries: [{ kind: 'snapshot', key: 'token', currency: 'USD', fetchedAt: now, expiresAt: now + 999, value: {} }] }));
evilCache = READ_CACHE.create(identity, { storage: evilStorage });
assert.equal(evilCache.get('snapshot', 'token', 'USD').status, 'miss');
evilStorage.setItem('imf.v2.readcache.v1', JSON.stringify({ schema: 'imf.v2.readcache.v1', identity: { ...identity, chainId: '999' }, entries: [{ kind: 'snapshot', key: 'token', currency: 'USD', fetchedAt: now, expiresAt: now + 999, value: {} }] }));
evilCache = READ_CACHE.create(identity, { storage: evilStorage });
assert.equal(evilCache.get('snapshot', 'token', 'USD').status, 'miss');

// Persistence across instances with the same identity, rejection across identities.
const before = cache.stats().entries;
assert.ok(before >= 1);
now += 1;
cache.set('snapshot', 'token', 'USD', original);
const reloaded = READ_CACHE.create(identity, { storage });
assert.equal(reloaded.get('snapshot', 'token', 'USD').status, 'hit', 'stored entries survive a new instance with the same identity');
const otherIdentity = READ_CACHE.identityFor({ chainId: 6281971, rpcUrl: 'https://rpc.testnet.dogeos.com', source: 'local-file', registry: registryRaw });
const other = READ_CACHE.create(otherIdentity, { storage });
assert.equal(other.get('snapshot', 'token', 'USD').status, 'miss', 'wrong identity is rejected');
assert.equal(other.stats().persisted, false);

// Fixture identity never persists to storage.
const fixtureStorage = makeStorage();
const fixtureCache = READ_CACHE.create(READ_CACHE.identityFor({ chainId: 6281971, rpcUrl: 'fixture://v2', source: 'fixture', registry: registryRaw }), { storage: fixtureStorage });
assert.equal(fixtureCache.persist, false);
fixtureCache.set('snapshot', 'token', 'USD', original);
assert.equal(fixtureStorage.size(), 0, 'no fixture persistence');
assert.equal(fixtureCache.get('snapshot', 'token', 'USD').status, 'hit', 'fixture cache still works in memory');

const multiCurrencyCache = READ_CACHE.create(identity, { persist: false });
const currencyCodes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CNY', 'BRL', 'PKR', 'BDT', 'INR', 'NGN', 'CHF'];
for (const code of currencyCodes) {
  multiCurrencyCache.set('verification', 'contract-links', code, { code });
  multiCurrencyCache.set('system', 'snapshot', code, { code });
  multiCurrencyCache.set('dashboard-discovery', 'all', code, { code });
}
assert.equal(multiCurrencyCache.stats().byKind.verification, 12, 'verification entries must not overwrite other currencies');
assert.equal(multiCurrencyCache.stats().byKind.system, 12, 'system entries must not overwrite other currencies');
assert.equal(multiCurrencyCache.stats().byKind['dashboard-discovery'], 12, 'discovery entries must not overwrite other currencies');
for (const code of currencyCodes) {
  assert.equal(multiCurrencyCache.get('verification', 'contract-links', code).value.code, code);
  assert.equal(multiCurrencyCache.get('system', 'snapshot', code).value.code, code);
  assert.equal(multiCurrencyCache.get('dashboard-discovery', 'all', code).value.code, code);
}

// Size caps: oversized entry refused; eviction keeps the store bounded.
const big = { payload: 'x'.repeat(READ_CACHE.maxEntryBytes) };
assert.equal(cache.set('snapshot', 'big', 'USD', big).stored, false);
for (let index = 0; index < READ_CACHE.maxEntries + 20; index += 1) cache.set('snapshot', `k${index}`, 'USD', { index });
assert.ok(cache.stats().entries <= READ_CACHE.maxEntries);
assert.equal(cache.get('snapshot', 'k0', 'USD').status, 'miss', 'oldest entries are evicted first');

// Post-receipt epoch: pre-receipt entries stop being served.
now += 1;
cache.set('snapshot', 'fresh', 'USD', { ok: 1 });
assert.equal(cache.get('snapshot', 'fresh', 'USD').status, 'hit');
cache.onReceipt({ blockNumber: 123, transactionHash: '0xreceipt' });
assert.equal(cache.get('snapshot', 'fresh', 'USD').status, 'stale');
assert.equal(cache.get('snapshot', 'fresh', 'USD').reason.includes('receipt'), true);
cache.set('snapshot', 'fresh', 'USD', { ok: 2 });
assert.equal(cache.get('snapshot', 'fresh', 'USD').value.ok, 2);

// Invalidate by currency and by identity.
cache.set('snapshot', 'eur', 'EUR', { ok: 3 });
assert.equal(cache.invalidateCurrency('USD') >= 1, true);
assert.equal(cache.get('snapshot', 'eur', 'EUR').status, 'hit');
assert.equal(cache.get('snapshot', 'fresh', 'USD').status, 'miss');
assert.ok(cache.invalidateIdentity() >= 1);
assert.equal(cache.stats().entries, 0);

// Discovery with cached resume: mock provider and client.
const POS_TOPIC = '0xpositionopened';
const CHA_TOPIC = '0xchallengestarted';
const allLogs = [
  { blockNumber: 100, logIndex: 0, transactionHash: '0xp1', topics: [POS_TOPIC], args: { position: '0xposA', owner: '0xowner1' } },
  { blockNumber: 101, logIndex: 0, transactionHash: '0xc1', topics: [CHA_TOPIC], args: { number: 1n, position: '0xposA' } },
  { blockNumber: 103, logIndex: 0, transactionHash: '0xp2', topics: [POS_TOPIC], args: { position: '0xposB', owner: '0xowner2' } },
];
function makeProvider(latest) {
  return {
    getLogsCalls: [],
    async getTransactionReceipt(tx) {
      return { blockNumber: 100, transactionHash: tx };
    },
    async getBlockNumber() {
      return latest;
    },
    async getLogs(filter) {
      this.getLogsCalls.push(filter);
      return allLogs.filter((entry) => entry.topics[0] === filter.topics[0] && entry.blockNumber >= filter.fromBlock && entry.blockNumber <= filter.toBlock);
    },
    async getBlock(number) {
      return { number, hash: '0xblock', timestamp: 1700000000 };
    },
  };
}
const iface = {
  getEvent(name) {
    return { topicHash: name === 'PositionOpened' ? POS_TOPIC : CHA_TOPIC };
  },
  parseLog(entry) {
    return { args: entry.args };
  },
};
function makeClient(code) {
  return {
    instance: {
      code,
      mintingHub: '0xhub',
      transactions: { deployments: { MintingHub: '0xdeploytx' } },
    },
    mintingHub: { interface: iface },
    positionReads: [],
    challengeReads: [],
    async positionState(address) {
      this.positionReads.push(address);
      return { address, hubMatchesRegistry: true, tokenMatchesRegistry: true };
    },
    async challengeSnapshot(index) {
      this.challengeReads.push(index);
      return { position: '0xposA', empty: false };
    },
  };
}
const discoveryIdentity = READ_CACHE.identityFor({ chainId: 6281971, rpcUrl: 'https://rpc.testnet.dogeos.com', source: 'runtime-config', registry: registryRaw });
const discoveryCache = READ_CACHE.create(discoveryIdentity, { storage: makeStorage() });
const registryState = { fixture: false, provider: makeProvider(101) };
const client = makeClient('USD');

// First pass: full scan from the deployment block, result cached.
const first = await DISCOVERY.discover(registryState, client, null, { resume: true, cache: discoveryCache });
assert.equal(first.fromBlock, 100);
assert.equal(first.toBlock, 101);
assert.equal(first.complete, true);
assert.equal(first.coverage.cache, 'miss');
assert.equal(first.events.length, 2);
assert.equal(first.positions.length, 1);
assert.equal(first.challenges.length, 1);
assert.deepEqual(registryState.provider.getLogsCalls.map((call) => call.fromBlock), [100, 100]);
assert.equal(discoveryCache.get('discovery', 'events', 'USD').status, 'hit');

// Second pass: resume after the cached toBlock only, merge/dedupe, re-read state.
const secondState = { fixture: false, provider: makeProvider(105) };
const secondClient = makeClient('USD');
const second = await DISCOVERY.discover(secondState, secondClient, null, { resume: true, cache: discoveryCache });
assert.equal(second.coverage.resumed, true);
assert.equal(second.coverage.cache, 'hit');
assert.deepEqual(secondState.provider.getLogsCalls.map((call) => call.fromBlock), [102, 102], 'resume scans only after the cached toBlock');
assert.equal(second.events.length, 3, 'cached and fresh events are merged');
assert.equal(new Set(second.events.map((event) => `${event.transactionHash}:${event.logIndex}`)).size, 3, 'events are deduplicated');
assert.deepEqual(secondClient.positionReads, ['0xposB', '0xposA'], 'position state is re-read fresh on refresh');
assert.equal(second.positions.length, 2);
assert.equal(second.positions.find((item) => item.address === '0xposA').createdBy, '0xowner1', 'cached creation metadata is reused');
assert.equal(second.positions.find((item) => item.address === '0xposB').transactionHash, '0xp2');
assert.equal(second.challenges.length, 1);
assert.equal(second.sourceBlock.number, 105);
assert.equal(typeof second.fetchedAt, 'number');

// Original API fallback: no options means a full-range scan, same shape as before.
const fallbackState = { fixture: false, provider: makeProvider(105) };
const fallback = await DISCOVERY.discover(fallbackState, makeClient('USD'), null);
assert.deepEqual(fallbackState.provider.getLogsCalls.map((call) => call.fromBlock), [100, 100], 'default discovery still scans the full range');
assert.equal(fallback.events.length, 3);
assert.equal(fallback.complete, true);
assert.equal(fallback.coverage.cache, 'disabled');

// Fixture path is unchanged and nothing is cached for it.
const fixtureState = { fixture: true, provider: makeProvider(105) };
const fixtureResult = await DISCOVERY.discover(fixtureState, makeClient('USD'), null, { resume: true, cache: discoveryCache });
assert.equal(fixtureResult.synthetic, true);
assert.equal(fixtureResult.complete, true);
assert.equal(fixtureResult.positions.length, 0);
assert.equal(fixtureResult.events.length, 0);

// Discovery hooks: invalidate by currency/identity and post-receipt epoch.
READ_CACHE.configureShared(discoveryIdentity, { storage: makeStorage() });
assert.equal(DISCOVERY.invalidate('USD'), true);
assert.equal(DISCOVERY.onReceipt({ blockNumber: 110 }), true);
const sharedAfterReceipt = READ_CACHE.shared();
assert.equal(sharedAfterReceipt.stats().epoch, 1);

// v2.js read-cache hooks: public read-only analytics reuse only.
assert.equal(typeof V2_APP.readDashboardAnalytics, 'function');
assert.equal(V2_APP.readCacheIdentity(), null, 'no identity before connect');
assert.equal(V2_APP.invalidateReadCache(), false, 'no cache before connect');
assert.equal(V2_APP.verificationProgress(), null);
V2_APP.state.readCache = discoveryCache;
V2_APP.state.fixture = false;
let produced = 0;
const producer = async () => {
  produced += 1;
  return { supply: 77n };
};
const meta = { sourceBlock: { number: 9, hash: '0xs', timestamp: '1' }, coverage: { complete: true } };
const miss = await V2_APP.readDashboardAnalytics('dashboard', 'token', 'USD', producer, meta);
assert.equal(miss.cache, 'miss');
assert.equal(miss.value.supply, 77n);
const hitAgain = await V2_APP.readDashboardAnalytics('dashboard', 'token', 'USD', producer, meta);
assert.equal(hitAgain.cache, 'hit');
assert.equal(produced, 1, 'producer ran once; the second read reused the cache');
assert.equal(hitAgain.value.supply, 77n);
V2_APP.onReadReceipt({ blockNumber: 111 });
const afterReceipt = await V2_APP.readDashboardAnalytics('dashboard', 'token', 'USD', producer, meta);
assert.equal(afterReceipt.cache, 'miss');
assert.equal(produced, 2, 'post-receipt analytics read fresh again');
assert.equal(V2_APP.invalidateReadCache('USD'), true);

console.log(JSON.stringify({ ok: true, fixtureOnly: true, serialization: true, identity: true, ttlMs: READ_CACHE.ttlMs, errorTtlMs: READ_CACHE.errorTtlMs, malformedRejection: true, fixturePersistence: false, caps: true, receiptEpoch: true, discoveryResume: true, v2Hooks: true }, null, 2));
