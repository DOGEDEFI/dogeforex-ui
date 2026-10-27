import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSource = readFileSync(resolve(root, 'src/fixture.ts'), 'utf8');
const browserSource = readFileSync(resolve(root, 'src/browser-fixture.ts'), 'utf8');
const runtime = JSON.parse(readFileSync(resolve(root, 'config/runtime.fixture.json'), 'utf8'));
const defaultRuntime = JSON.parse(readFileSync(resolve(root, 'config/runtime.json'), 'utf8'));

const registryMatch = fixtureSource.match(/const FIXTURE_REGISTRY_JSON = String\.raw`([\s\S]*?)`;/);
assert.ok(registryMatch, 'fixture registry must be statically readable JSON');
const registry = JSON.parse(registryMatch[1]);
assert.deepEqual(runtime.registry, registry, 'runtime and TypeScript registries have drifted');

assert.deepEqual(
  Object.keys(runtime).sort(),
  [...Object.keys(defaultRuntime), 'fixture', 'chain'].sort(),
  'fixture runtime must retain the default runtime shape plus fixture and static chain metadata',
);
for (const key of ['schema', 'protocolVersion', 'mode']) assert.equal(runtime[key], defaultRuntime[key], key);
assert.equal(runtime.fixture, true);
assert.equal(runtime.status, 'fixture');
assert.match(runtime.message, /^SYNTHETIC V2 FIXTURE — not deployed or live state/);
assert.equal(runtime.rpcUrl, 'fixture://v2');
const testnetRuntime = JSON.parse(readFileSync(resolve(root, 'config/runtime.testnet.json'), 'utf8'));
assert.deepEqual(runtime.chain, testnetRuntime.chain, 'fixture wallet metadata must match the approved static DogeOS chain');

assert.deepEqual(Object.keys(registry).sort(), ['abi', 'address', 'linkedData']);
assert.ok(Array.isArray(registry.abi) && registry.abi.length === 0, 'outer ABI must be empty');
const linked = registry.linkedData;
assert.equal(linked.schemaVersion, '2.0');
assert.equal(linked.network, 'fixture-v2');
assert.equal(String(linked.chainId), '6281971');
assert.equal(linked.code, 'USD');
assert.equal(registry.address, linked.addresses.Token);

const addressKeys = [
  'deployer',
  'source',
  'Token',
  'Equity',
  'PositionFactory',
  'PositionRoller',
  'Savings',
  'MintingHub',
  'Bridge',
];
assert.deepEqual(Object.keys(linked.addresses).sort(), [...addressKeys].sort());
const addresses = addressKeys.map((key) => linked.addresses[key]);
for (const address of addresses) {
  assert.match(address, /^0x[0-9a-fA-F]{40}$/, 'invalid registry address');
  assert.notEqual(address.toLowerCase(), `0x${'0'.repeat(40)}`, 'zero address is forbidden');
  assert.match(address.toLowerCase(), /^0xf17e[0-9a-f]{36}$/, 'addresses must use the synthetic namespace');
}
assert.equal(new Set(addresses.map((address) => address.toLowerCase())).size, addresses.length, 'addresses must be unique');

for (const [name, expected] of [
  ['fixtureAccount', '0xF17e00000000000000000000000000000000000B'],
  ['fixturePosition', '0xF17e00000000000000000000000000000000000A'],
  ['fixtureCollateral', '0xf17e00000000000000000000000000000000000c'],
]) {
  const match = fixtureSource.match(new RegExp(`export const ${name} = '([^']+)';`));
  assert.ok(match, `${name} export is missing`);
  assert.match(match[1], /^0x[0-9a-fA-F]{40}$/);
  assert.ok(!addresses.map((address) => address.toLowerCase()).includes(match[1].toLowerCase()), `${name} must be distinct`);
  assert.equal(match[1], expected);
}

assert.equal(linked.sourceEvidence.address, linked.addresses.source);
assert.equal(String(linked.sourceEvidence.decimals), '6');
assert.equal(String(linked.sourceEvidence.onchainDecimals), '6');
assert.equal(BigInt(linked.sourceEvidence.decimalMultiplier), 10n ** 12n);
assert.equal(linked.sourceEvidence.synthetic, true);
assert.equal(linked.sourceEvidence.evidenceType, 'synthetic');
assert.equal(linked.sourceEvidence.bytecodeValidated, false);
assert.equal(linked.rateEvidence.synthetic, true);
assert.equal(linked.rateEvidence.evidenceType, 'synthetic');
assert.equal(linked.rateEvidence.leadratePPM, 59400);
assert.equal(linked.postconditions.complete, false);
assert.equal(linked.postconditions.synthetic, true);
assert.equal(linked.postconditions.deployed, false);
assert.match(JSON.stringify(registry), /SYNTHETIC V2 FIXTURE/);
assert.doesNotMatch(JSON.stringify(registry), /(?:https?|wss?):\/\//i);
assert.ok(Object.values(linked.transactions.deployments).every((value) => value === null), 'synthetic deployment hashes are forbidden');
assert.deepEqual(linked.transactions.initialize, {});
for (const key of ['sourceFunding', 'sourceApproval', 'bridgeMint', 'equityInvestment']) {
  assert.equal(linked.transactions[key], null, `${key} must not claim a transaction`);
}

const args = linked.constructorArgs;
assert.deepEqual(args.TestUSDC, []);
assert.equal(args.Token.length, 3);
assert.equal(args.Equity.length, 3);
assert.deepEqual(args.PositionFactory, []);
assert.deepEqual(args.PositionRoller, [linked.addresses.Token]);
assert.deepEqual(args.Savings, [linked.addresses.Token, '59400']);
assert.equal(args.MintingHub.length, 4);
assert.deepEqual(args.MintingHub, [
  linked.addresses.Token,
  linked.addresses.Savings,
  linked.addresses.PositionRoller,
  linked.addresses.PositionFactory,
]);
assert.equal(args.Bridge.length, 3);
assert.equal(args.Bridge[0], linked.addresses.source);
assert.equal(args.Bridge[1], linked.addresses.Token);
assert.equal(args.Bridge[2], '2000000000000000000000000');
assert.equal(args.Equity[0], linked.addresses.Token);
assert.deepEqual(args.Equity.slice(1), args.Token.slice(1));
assert.match(args.Token[1], /SYNTHETIC V2 FIXTURE/i);

const scenariosMatch = fixtureSource.match(/export const fixtureScenarios = \[([\s\S]*?)\] as const;/);
assert.ok(scenariosMatch, 'scenario list is missing');
const scenarios = [...scenariosMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(scenarios, [
  'valid',
  'wrong-chain',
  'missing-code',
  'rpc-error',
  'no-votes',
  'cooldown',
  'expired',
  'challenged',
  'zero-balance',
]);
assert.match(fixtureSource, /setScenario\(next: FixtureScenario\)/);
assert.match(fixtureSource, /scenario === 'cooldown' \? NOW/);
assert.match(fixtureSource, /scenario === 'expired' \? NOW/);
assert.match(fixtureSource, /scenario === 'wrong-chain' \? CHAIN_ID \+ 1n : CHAIN_ID/);
assert.match(fixtureSource, /scenario === 'missing-code'\) return '0x'/);
assert.match(fixtureSource, /scenario === 'rpc-error'/);
assert.match(fixtureSource, /scenario === 'no-votes'/);
assert.match(fixtureSource, /scenario === 'challenged'/);
assert.match(fixtureSource, /isZeroBalance\(\)/);

assert.match(fixtureSource, /const LOCAL_DECIMALS = 18n;/);
assert.match(fixtureSource, /const COLLATERAL_DECIMALS = 6n;/);
assert.match(fixtureSource, /const POSITION_PRICE = 2n \* 10n \*\* 30n;/);
assert.match(fixtureSource, /const RISK_PREMIUM_PPM = 20_000n;/);
assert.match(fixtureSource, /const RESERVE_CONTRIBUTION_PPM = 200_000n;/);
assert.match(fixtureSource, /const ANNUAL_INTEREST_PPM = SAVINGS_RATE_PPM \+ RISK_PREMIUM_PPM;/);
assert.match(fixtureSource, /quoteUsableMint\(/);
assert.match(fixtureSource, /grossMintForUsable\(/);
assert.match(fixtureSource, /quoteFeePPM\(/);
assert.doesNotMatch(fixtureSource, /Number\([^)]*(?:AMOUNT|BALANCE|PRICE|SUPPLY|MINTED|RESERVE)/);

for (const text of [fixtureSource, browserSource, JSON.stringify(runtime)]) {
  assert.doesNotMatch(text, /guardian|bootstrap|genesis/i, 'forbidden V1 dependency or selector');
  assert.doesNotMatch(text, /JsonRpcProvider|sendTransaction|signTransaction|privateKey|mnemonic/i);
}
assert.match(browserSource, /export \* from '@dogeforex\/sdk\/v2';/);
assert.match(browserSource, /export \* from '\.\/fixture\.js';/);
assert.doesNotMatch(fixtureSource, /from '@dogeforex\/sdk'/);
assert.match(fixtureSource, /contract\.interface\.getFunction\(selector\)/);
assert.match(fixtureSource, /contract\.interface\.decodeFunctionData/);
assert.match(fixtureSource, /contract\.interface\.encodeFunctionResult/);

function signature(fragment) {
  const type = (input) => {
    if (!input.type.startsWith('tuple')) return input.type;
    return `(${input.components.map(type).join(',')})${input.type.slice(5)}`;
  };
  return `${fragment.name}(${(fragment.inputs ?? []).map(type).join(',')})`;
}

const abiSource = readFileSync(resolve(root, '../../dogeforex-sdk-ts/src/v2/abis.ts'), 'utf8');
const abiPattern = /export const (V2_[A-Z0-9_]+_ABI): InterfaceAbi = (\[[\s\S]*?\n\]);/g;
const sdkAbis = new Map();
for (const match of abiSource.matchAll(abiPattern)) sdkAbis.set(match[1], JSON.parse(match[2]));

const canonical = {
  V2_ERC20_ABI: 'ERC20.json',
  V2_TOKEN_ABI: 'OracleFreeDollar.json',
  V2_MINTING_HUB_ABI: 'MintingHub.json',
  V2_POSITION_ABI: 'Position.json',
  V2_POSITION_ROLLER_ABI: 'PositionRoller.json',
  V2_EQUITY_ABI: 'Equity.json',
  V2_SAVINGS_ABI: 'Savings.json',
  V2_BRIDGE_ABI: 'StablecoinBridge.json',
};
assert.deepEqual([...sdkAbis.keys()].sort(), Object.keys(canonical).sort());
const viewSignatures = new Set();
for (const [exportName, abi] of sdkAbis) {
  const canonicalAbi = JSON.parse(readFileSync(resolve(root, '../../dogeforex-protocol/abi', canonical[exportName]), 'utf8'));
  const canonicalFunctions = new Set(canonicalAbi.filter((fragment) => fragment.type === 'function').map(signature));
  for (const fragment of abi.filter((entry) => entry.type === 'function')) {
    const name = signature(fragment);
    assert.ok(canonicalFunctions.has(name), `${exportName} ${name} is absent from the canonical ABI`);
    if (fragment.stateMutability === 'view' || fragment.stateMutability === 'pure') {
      viewSignatures.add(name);
      assert.ok(fixtureSource.includes(`'${name}'`), `${name} has no fixture view handler`);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: 'static structural and ABI validation',
  registry: 'runtime.fixture.json matches src/fixture.ts',
  uniqueRegistryAddresses: addresses.length,
  scenarios,
  sdkAbiExports: sdkAbis.size,
  implementedCanonicalViewSignatures: viewSignatures.size,
  v2ClientIntegration: 'tested separately; this check performs no TypeScript import, SDK compilation, deployment, RPC call, or live connectivity claim',
}, null, 2));
