const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const context = { window: {}, crypto: { randomUUID: (() => { let id = 0; return () => `draft-${++id}`; })() }, Date, JSON, Number, Object };
vm.createContext(context);
vm.runInContext(fs.readFileSync('assets/planning.js', 'utf8'), context);
const planning = context.window.IMF_PLANNING;
const inputs = { project: ' Example project ', token: '0x1111111111111111111111111111111111111111', currency: 'USD', collateral: '1000000', gross: '50000', reserve: '20', fee: '1' };
const legacy = planning.legacyPlan(inputs);
assert.equal(legacy.illustrativeResult.net, 39500);
assert.equal(legacy.executionEnabled, false);
assert.equal(legacy.project, 'Example project');
assert.equal(planning.validateLegacyPlan(legacy).illustrativeResult.gross, 50000);
assert.equal(planning.legacyPlan({ ...inputs, reserve: '0', fee: '0' }).illustrativeResult.net, 50000);
for (const invalid of [
  { ...inputs, gross: '1e5' },
  { ...inputs, collateral: '-1' },
  { ...inputs, reserve: '99', fee: '2' },
  { ...inputs, project: '   ' },
  { ...inputs, token: '0x1234' },
]) assert.throws(() => planning.legacyPlan(invalid));
assert.throws(() => planning.validateLegacyPlan({ ...legacy, executionEnabled: true }), /non-executable/);
assert.throws(() => planning.validateLegacyPlan({ ...legacy, illustrativeResult: { gross: 50000, reserve: 10000, fee: 1, net: 39999 } }), /arithmetic/);

const v2 = {
  schema: 'imf.v2-read-plan.v1',
  status: 'local-read-plan',
  executionEnabled: false,
  simulationStatus: 'not-run',
  signatureStatus: 'not-requested',
  action: 'new',
  project: 'Example project',
  currency: 'USD',
  chainId: null,
  inputs: {
    project: 'Example project',
    currency: 'USD',
    account: '0x2222222222222222222222222222222222222222',
    token: { address: '0x1111111111111111111111111111111111111111', decimals: '18' },
    minimumCollateral: { decimal: '4000', decimals: '18', raw: `4000${'0'.repeat(18)}` },
    initialCollateral: { decimal: '100000', decimals: '18', raw: `100000${'0'.repeat(18)}` },
    mintingMaximum: { decimal: '50000', decimals: '18', raw: `50000${'0'.repeat(18)}` },
    initPeriodSeconds: '259200',
    durationSeconds: '31536000',
    challengePeriodSeconds: '86400',
    riskPremiumPPM: '0',
    reserveContributionPPM: '200000',
    liquidationPrice: { decimal: '1', decimals: '18', raw: `1${'0'.repeat(18)}` },
    plannedGrossMint: { decimal: '50000', decimals: '18', raw: `50000${'0'.repeat(18)}` },
  },
  evidence: { registry: { status: 'unconfigured' }, state: null, quote: null },
};
assert.equal(planning.validateV2Plan(v2).status, 'local-read-plan');
assert.throws(() => planning.validateV2Plan({ ...v2, simulationStatus: 'passed' }));
assert.throws(() => planning.validateV2Plan({ ...v2, inputs: { privateKey: 'not-allowed' } }), /Unsupported JSON field/);

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const store = new planning.DraftStore(storage);
assert.equal(store.list().length, 0);
const saved = store.save(legacy);
assert.equal(store.list().length, 1);
assert.equal(store.list()[0].id, 'draft-1');
assert.equal(store.restore(store.backup()), 0);
store.save(v2);
assert.equal(store.list().length, 2);
assert.equal(store.list()[1].simulationStatus, 'not-run');
store.remove(saved.id);
assert.equal(store.list().length, 1);
assert.throws(() => store.remove('missing'), /not found/);
const other = new planning.DraftStore(storage, 'other-key');
assert.equal(other.restore(store.backup()), 1);
assert.equal(other.list()[0].schema, 'imf.v2-read-plan.v1');
assert.equal(other.restore(store.backup()), 0);
values.set('broken', '{not-json');
assert.throws(() => new planning.DraftStore(storage, 'broken').list(), /JSON/);
values.set('invalid', JSON.stringify([{ ...legacy, executionEnabled: true, id: 'bad', savedAt: new Date().toISOString() }]));
assert.throws(() => new planning.DraftStore(storage, 'invalid').list(), /non-executable/);
assert.throws(() => store.restore({ schema: 'imf.draft-backup.v1', plans: [{ ...v2, executionEnabled: true }] }));
console.log('PASS: teaching arithmetic, decimal validation, non-executable schemas, draft save/load/delete, backup deduplication and corrupt-storage errors');
