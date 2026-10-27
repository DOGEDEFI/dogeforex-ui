import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Interface, ZeroAddress, getAddress } from 'ethers';

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const abiRoot = path.resolve(root, '../../dogeforex-protocol/abi');

async function loadActions() {
  const result = await build({
    entryPoints: [path.join(root, 'src/actions.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: ['node20'],
    logLevel: 'warning',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

const actions = await loadActions();
const {
  V2_ACTION_INTERFACE,
  V2_ACTION_METADATA,
  decodeChallengeStarted,
  decodePositionOpened,
  decodeV2Action,
  decodeV2Event,
  decodeV2Receipt,
  encodeV2Action,
} = actions;

const canonicalFiles = {
  erc20: 'ERC20.json',
  hub: 'MintingHub.json',
  position: 'Position.json',
  bridge: 'StablecoinBridge.json',
  savings: 'Savings.json',
  equity: 'Equity.json',
  roller: 'PositionRoller.json',
  token: 'OracleFreeDollar.json',
};
const canonical = Object.fromEntries(Object.entries(canonicalFiles).map(([key, file]) => [
  key,
  new Interface(JSON.parse(fs.readFileSync(path.join(abiRoot, file), 'utf8'))),
]));

const A = '0x1000000000000000000000000000000000000001';
const B = '0x2000000000000000000000000000000000000002';
const C = '0x3000000000000000000000000000000000000003';
const D = '0x4000000000000000000000000000000000000004';
const E = '0x5000000000000000000000000000000000000005';
const F = '0x6000000000000000000000000000000000000006';
const UINT24_MAX = 2n ** 24n - 1n;
const UINT32_MAX = 2n ** 32n - 1n;
const UINT40_MAX = 2n ** 40n - 1n;
const UINT192_MAX = 2n ** 192n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

const cases = [
  { operation: 'erc20.approve', target: A.toLowerCase(), args: { spender: B, amount: UINT256_MAX } },
  {
    operation: 'hub.openPosition',
    target: A,
    args: {
      collateral: B,
      minCollateral: 1n,
      initialCollateral: 2n,
      mintingMaximum: UINT256_MAX,
      initPeriodSeconds: UINT40_MAX,
      expirationSeconds: UINT40_MAX - 1n,
      challengeSeconds: 0n,
      riskPremiumPPM: UINT24_MAX,
      liquidationPrice: 3n,
      reservePPM: UINT24_MAX - 1n,
    },
  },
  {
    operation: 'hub.clone',
    target: A,
    args: { owner: B, parent: C, initialCollateral: 0n, initialMint: UINT256_MAX, expiration: UINT40_MAX },
  },
  {
    operation: 'hub.challenge',
    target: A,
    args: { position: B, collateralAmount: UINT256_MAX, minimumPrice: 0n },
  },
  {
    operation: 'hub.bid',
    target: A,
    args: { challengeNumber: UINT32_MAX, size: UINT256_MAX, postponeCollateralReturn: true },
  },
  { operation: 'hub.returnPostponedCollateral', target: A, args: { collateral: B, target: C } },
  { operation: 'hub.buyExpiredCollateral', target: A, args: { position: B, upToAmount: UINT256_MAX } },
  { operation: 'position.mint', target: A, args: { target: B, amount: UINT256_MAX } },
  {
    operation: 'position.adjust',
    target: A,
    args: { newMinted: 0n, newCollateral: UINT256_MAX, newPrice: 1n },
  },
  { operation: 'position.adjustPrice', target: A, args: { newPrice: UINT256_MAX } },
  { operation: 'position.repay', target: A, args: { amount: UINT256_MAX } },
  { operation: 'position.withdrawCollateral', target: A, args: { target: B, amount: 0n } },
  { operation: 'position.withdraw', target: A, args: { token: B, target: C, amount: UINT256_MAX } },
  { operation: 'position.transferOwnership', target: A, args: { newOwner: B } },
  { operation: 'position.deny', target: A, args: { helpers: [B, C], message: 'deny ✓' } },
  { operation: 'bridge.mintTo', target: A, args: { target: B, amount: UINT256_MAX } },
  { operation: 'bridge.burnAndSend', target: A, args: { target: B, amount: 0n } },
  { operation: 'bridge.burnAndCredit', target: A, args: { target: B, amount: UINT256_MAX } },
  { operation: 'bridge.payoutCredit', target: A, args: { target: B } },
  { operation: 'savings.save', target: A, args: { amount: UINT192_MAX } },
  { operation: 'savings.saveFor', target: A, args: { owner: B, amount: UINT192_MAX - 1n } },
  { operation: 'savings.withdraw', target: A, args: { target: B, amount: UINT192_MAX } },
  { operation: 'savings.adjust', target: A, args: { targetAmount: 0n } },
  { operation: 'savings.refreshMyBalance', target: A, args: {} },
  { operation: 'savings.refreshBalance', target: A, args: { owner: B } },
  { operation: 'savings.proposeChange', target: A, args: { newRatePPM: UINT24_MAX, helpers: [B, C] } },
  { operation: 'savings.applyChange', target: A, args: {} },
  { operation: 'equity.invest', target: A, args: { amount: UINT256_MAX, expectedShares: 0n } },
  {
    operation: 'equity.redeemExpected',
    target: A,
    args: { target: B, shares: UINT256_MAX, expectedProceeds: 0n },
  },
  { operation: 'equity.delegateVoteTo', target: A, args: { delegate: ZeroAddress } },
  { operation: 'equity.kamikaze', target: A, args: { targets: [B, C], votesToDestroy: UINT256_MAX } },
  {
    operation: 'equity.restructureCapTable',
    target: A,
    args: { helpers: [B], addressesToWipe: [C, D] },
  },
  { operation: 'roller.rollFully', target: A, args: { source: B, targetPosition: C } },
  {
    operation: 'roller.rollFullyWithExpiration',
    target: A,
    args: { source: B, targetPosition: C, expiration: UINT40_MAX },
  },
  {
    operation: 'roller.roll',
    target: A,
    args: {
      source: B,
      repay: UINT256_MAX,
      collateralWithdraw: 0n,
      targetPosition: C,
      mint: 1n,
      collateralDeposit: 2n,
      expiration: UINT40_MAX,
    },
  },
  {
    operation: 'token.suggestMinter',
    target: A,
    args: { minter: B, applicationPeriod: UINT256_MAX, applicationFee: 0n, message: 'minter ✓' },
  },
  {
    operation: 'token.denyMinter',
    target: A,
    args: { minter: B, helpers: [C, D], message: 'denied ✓' },
  },
];

function expectedValue(param, value) {
  if (param.baseType === 'array') return value.map((entry) => expectedValue(param.arrayChildren, entry));
  if (param.type === 'address') return getAddress(value);
  return value;
}

assert.equal(cases.length, 37);
assert.deepEqual(new Set(cases.map((test) => test.operation)), new Set(Object.keys(V2_ACTION_METADATA)));
for (const test of cases) {
  const metadata = V2_ACTION_METADATA[test.operation];
  const descriptor = encodeV2Action(test);
  const iface = canonical[metadata.contract];
  const canonicalFragment = iface.getFunction(metadata.signature);
  const actionFragment = V2_ACTION_INTERFACE.getFunction(metadata.signature);
  assert(canonicalFragment, `${test.operation}: canonical function missing`);
  const values = actionFragment.inputs.map((input) => expectedValue(input, test.args[input.name]));
  const expected = iface.encodeFunctionData(metadata.signature, values);
  assert.equal(descriptor.data, expected, `${test.operation}: calldata`);
  assert.equal(descriptor.data.slice(0, 10), iface.getFunction(metadata.signature).selector, `${test.operation}: selector`);
  assert.equal(descriptor.to, getAddress(test.target), `${test.operation}: target`);
  assert.equal(descriptor.signature, metadata.signature);
  assert.equal(descriptor.operation, test.operation);
  const decoded = decodeV2Action(descriptor);
  assert.equal(decoded.operation, test.operation);
  assert.equal(decoded.signature, metadata.signature);
  assert.equal(decoded.to, getAddress(test.target));
  const expectedArgs = Object.fromEntries(actionFragment.inputs.map((input, index) => [
    input.name,
    expectedValue(input, values[index]),
  ]));
  assert.deepEqual(decoded.args, expectedArgs, `${test.operation}: decoded arguments`);
}

function changed(operation, mutate) {
  const test = structuredClone(cases.find((entry) => entry.operation === operation));
  mutate(test);
  return test;
}

const invalidCases = [
  changed('hub.openPosition', (test) => { test.args.initPeriodSeconds = UINT40_MAX + 1n; }),
  changed('hub.openPosition', (test) => { test.args.expirationSeconds = -1n; }),
  changed('hub.openPosition', (test) => { test.args.riskPremiumPPM = UINT24_MAX + 1n; }),
  changed('hub.openPosition', (test) => { test.args.reservePPM = 24; }),
  changed('hub.bid', (test) => { test.args.challengeNumber = UINT32_MAX + 1n; }),
  changed('savings.save', (test) => { test.args.amount = UINT192_MAX + 1n; }),
  changed('erc20.approve', (test) => { test.args.amount = UINT256_MAX + 1n; }),
  changed('erc20.approve', (test) => { test.args.amount = -1n; }),
  changed('erc20.approve', (test) => { test.args.amount = 1; }),
  changed('erc20.approve', (test) => { test.args.amount = '1'; }),
  changed('position.mint', (test) => { test.target = ZeroAddress; }),
  changed('position.mint', (test) => { test.args.target = ZeroAddress; }),
  changed('hub.clone', (test) => { test.args.owner = ZeroAddress; }),
  changed('savings.saveFor', (test) => { test.args.owner = ZeroAddress; }),
  changed('position.transferOwnership', (test) => { test.args.newOwner = ZeroAddress; }),
  changed('position.mint', (test) => { test.args.target = '0x1234'; }),
  changed('position.mint', (test) => {
    const valid = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    const index = [...valid].findIndex((character) => /[a-f]/i.test(character));
    const character = valid[index];
    test.args.target = `${valid.slice(0, index)}${character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase()}${valid.slice(index + 1)}`;
  }),
  changed('position.deny', (test) => { test.args.helpers = B; }),
  changed('position.deny', (test) => { test.args.helpers = [ZeroAddress]; }),
  changed('hub.bid', (test) => { test.args.postponeCollateralReturn = 1; }),
  changed('position.deny', (test) => { test.args.message = 7; }),
  changed('position.mint', (test) => { test.operation = 'position.unknown'; }),
];
for (const test of invalidCases) assert.throws(() => encodeV2Action(test));
assert.throws(() => decodeV2Action({ to: A, data: '0x12345678' }));
assert.throws(() => decodeV2Action({ to: A, data: 'not hex' }));
assert.throws(() => decodeV2Action({ to: ZeroAddress, data: encodeV2Action(cases[0]).data }));
assert.throws(() => decodeV2Action({ to: A, data: encodeV2Action(cases[0]).data.slice(0, -1) }));

const eventCases = [
  ['erc20', 'Approval', [A, B, 1n]],
  ['hub', 'PositionOpened', [A, B, B, C]],
  ['hub', 'ChallengeStarted', [A, B, 2n, 7n]],
  ['hub', 'ChallengeAverted', [B, 7n, 2n]],
  ['hub', 'ChallengeSucceeded', [B, 7n, 3n, 2n, 2n]],
  ['hub', 'PostPonedReturn', [C, A, 2n]],
  ['hub', 'ForcedSale', [B, 2n, 3n]],
  ['position', 'MintingUpdate', [2n, 3n, 4n]],
  ['position', 'PositionDenied', [A, 'no']],
  ['position', 'OwnershipTransferred', [A, B]],
  ['bridge', 'Mint', [A, 1n]],
  ['bridge', 'Burn', [A, 1n]],
  ['bridge', 'Credit', [A, 1n]],
  ['bridge', 'Payout', [A, 1n]],
  ['savings', 'Saved', [A, 1n]],
  ['savings', 'Withdrawn', [A, 1n]],
  ['savings', 'InterestCollected', [A, 1n]],
  ['savings', 'RateProposed', [A, 20_000n, 100n]],
  ['savings', 'RateChanged', [20_000n]],
  ['equity', 'Trade', [A, -1n, 2n, 3n]],
  ['equity', 'Delegation', [A, B]],
  ['roller', 'Roll', [B, 2n, 3n, C, 2n, 4n]],
  ['token', 'MinterApplied', [B, 10n, 20n, 'apply']],
  ['token', 'MinterDenied', [B, 'no']],
  ['token', 'Loss', [B, 1n]],
  ['token', 'Profit', [B, 1n]],
];
for (const [contract, name, values] of eventCases) {
  const encoded = canonical[contract].encodeEventLog(name, values);
  const log = { address: contract === 'hub' ? A : D, ...encoded };
  const decoded = decodeV2Event(log, contract === 'hub' ? A : D);
  assert.equal(decoded.name, name);
  assert.equal(decoded.emitter, getAddress(log.address));
  const fragment = canonical[contract].getEvent(name);
  assert.equal(decoded.signature, fragment.format('sighash'));
  for (const [index, input] of fragment.inputs.entries()) {
    assert.deepEqual(decoded.args[input.name], expectedValue(input, values[index]), `${name}.${input.name}`);
  }
}

const positionOpened = canonical.hub.encodeEventLog('PositionOpened', [A, B, C, E]);
const challengeStarted = canonical.hub.encodeEventLog('ChallengeStarted', [F, B, 99n, 7n]);
const transactionHash = `0x${'12'.repeat(32)}`;
const receipt = {
  transactionHash,
  blockNumber: 123,
  logs: [
    { address: A, ...positionOpened, logIndex: 4 },
    { address: A, ...challengeStarted, logIndex: 5 },
  ],
};
const opened = decodePositionOpened(receipt, A.toLowerCase());
assert.equal(opened.emitter, getAddress(A));
assert.equal(opened.args.owner, getAddress(A));
assert.equal(opened.args.position, getAddress(B));
assert.equal(opened.args.original, getAddress(C));
assert.equal(opened.args.collateral, getAddress(E));
assert.equal(opened.logIndex, 4);
assert.equal(opened.transactionHash, transactionHash);
assert.equal(opened.blockNumber, 123);
const started = decodeChallengeStarted(receipt, A);
assert.equal(started.args.challenger, getAddress(F));
assert.equal(started.args.position, getAddress(B));
assert.equal(started.args.size, 99n);
assert.equal(started.args.number, 7n);
assert.equal(started.index, 7n);
assert.equal(started.logIndex, 5);
assert.equal(decodeV2Receipt(receipt, { mintingHub: A }).length, 2);
assert.throws(() => decodeV2Receipt(receipt));
assert.throws(() => decodeV2Receipt({ logs: [{ address: D, ...positionOpened }] }, { mintingHub: A }));
assert.throws(() => decodePositionOpened({ logs: [{ address: D, ...positionOpened }] }, A));
assert.throws(() => decodeV2Event({ address: D, ...positionOpened }, A));
assert.throws(() => decodePositionOpened({ logs: [] }, A));

for (const entryPoint of ['src/browser.ts', 'src/browser-fixture.ts']) {
  await build({
    entryPoints: [path.join(root, entryPoint)],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'IMF_V2',
    target: ['es2020'],
    logLevel: 'warning',
  });
}
const actionSource = fs.readFileSync(path.join(root, 'src/actions.ts'), 'utf8');
assert(!/\b(JsonRpcProvider|Wallet|sendTransaction|signTransaction)\b/.test(actionSource));

console.log(JSON.stringify({
  ok: true,
  operations: cases.length,
  canonicalCalldataChecks: cases.length,
  eventDecodingChecks: eventCases.length,
  invalidInputChecks: invalidCases.length + 4,
  receiptSourceValidation: true,
  browserEntries: ['src/browser.ts', 'src/browser-fixture.ts'],
  providerOrSigningAdded: false,
}, null, 2));
