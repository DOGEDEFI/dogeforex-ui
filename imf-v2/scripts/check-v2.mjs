import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

const bundlePath = '.fixture-dist/app/assets/protocol.js';
if (!fs.existsSync(bundlePath)) throw new Error('Run npm run build:fixture first');
const context = { console, URL, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout };
context.window = context;
context.self = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), context);
const sdk = context.IMF_V2;
const runtime = JSON.parse(fs.readFileSync('config/runtime.fixture.json', 'utf8'));
assert.equal(JSON.stringify(sdk.fixtureRegistry), JSON.stringify(runtime.registry));
assert.equal(sdk.fixtureControls.scenario, 'valid');
const registry = sdk.parseV2Registry(runtime.registry);
const client = sdk.createV2Client(sdk.v2InstanceOf(registry, 'USD'), sdk.createFixtureProvider());
const verification = await client.verify();
assert.equal(verification.verified, true);
assert.equal(verification.chainId, 6281971);
assert.equal(verification.sourceDecimals, 6);
assert.equal(verification.decimalMultiplier, 1000000000000n);
assert.equal(verification.savingsRatePPM, 59400n);

const proposal = await client.newPositionSnapshot({
  caller: sdk.fixtureAccount,
  collateral: sdk.fixtureCollateral,
  minCollateral: sdk.parseDecimal('4000', 6),
  initialCollateral: sdk.parseDecimal('100000', 6),
  mintingMaximum: sdk.parseDecimal('50000', 18),
  initPeriodSeconds: 259200n,
  durationSeconds: 31536000n,
  challengePeriodSeconds: 86400n,
  riskPremiumPPM: 20000n,
  liquidationPrice: sdk.parseLiquidationPrice('2', 6),
  reserveContributionPPM: 200000n,
  plannedMintAmount: sdk.parseDecimal('50000', 18),
});
assert.equal(proposal.valid, true);
assert.equal(proposal.annualInterestPPM, 79400n);
assert.equal(proposal.illustrativeMintQuote.feePPM, 79400n);
assert.equal(proposal.illustrativeMintQuote.usableAmount, sdk.parseDecimal('36030', 18));
assert.equal(proposal.funding.openingFee, sdk.OPENING_FEE);
assert.equal(proposal.terms.collateralDecimals, 6);
assert.equal(sdk.priceDecimals(6), 30);
assert.throws(() => sdk.parseDecimal('1e6', 6), /plain unsigned decimal/);
assert.throws(() => sdk.parseDecimal('0.0000001', 6), /more than 6 decimal places/);
assert.equal(sdk.grossMintForUsable(proposal.illustrativeMintQuote.usableAmount, 200000n, 79400n), proposal.illustrativeMintQuote.grossAmount);

const position = await client.positionSnapshot(sdk.fixturePosition, {
  caller: sdk.fixtureAccount,
  recipient: sdk.fixtureAccount,
  quote: { grossAmount: sdk.parseDecimal('1000', 18) },
});
assert.equal(position.eligible, true);
assert.equal(position.registeredWithHub, true);
assert.equal(position.hubMatchesRegistry, true);
assert.equal(position.tokenMatchesRegistry, true);
assert.equal(position.caller, sdk.fixtureAccount);
assert(position.checks.every((entry) => entry.status === 'pass'));

const clone = await client.cloneSnapshot({
  parent: sdk.fixturePosition,
  collateralFunder: sdk.fixtureAccount,
  childOwner: sdk.fixtureAccount,
  initialCollateral: sdk.parseDecimal('10000', 6),
  initialMint: sdk.parseDecimal('1000', 18),
  expiration: position.expiration,
});
assert.equal(clone.eligible, true);
assert.equal(clone.quote.feePPM, position.currentFeePPM);
assert.equal(clone.originalExpiration, position.expiration);

const repayment = await client.repaymentSnapshot(sdk.fixturePosition, { caller: sdk.fixtureAccount, amount: sdk.parseDecimal('100', 18) });
assert.equal(repayment.quote.walletAmount, sdk.parseDecimal('100', 18));
assert(repayment.quote.grossDebtReduction > repayment.quote.walletAmount);
assert.equal(repayment.simulationRequired, true);
assert.equal(repayment.fullCandidate.complete, true);

const withdrawal = await client.withdrawalSnapshot(sdk.fixturePosition, { caller: sdk.fixtureAccount, amount: sdk.parseDecimal('1', 6) });
assert.equal(withdrawal.eligible, true);
assert.equal(withdrawal.wouldClose, false);

const bridge = await client.bridgeSnapshot({ account: sdk.fixtureAccount, mintSourceAmount: sdk.parseDecimal('100', 6) });
assert.equal(bridge.mintPlan.localAmount, sdk.parseDecimal('100', 18));
assert.equal(bridge.mintPlan.eligible, true);
const burn = await client.bridgeSnapshot({ account: sdk.fixtureAccount, burnLocalAmount: sdk.parseDecimal('100', 18) + 1n, credit: true });
assert.equal(burn.burnPlan.alignedLocalAmount, sdk.parseDecimal('100', 18));
assert.equal(burn.burnPlan.remainderLocalAmount, 1n);
assert.equal(burn.burnPlan.sourceAmount, sdk.parseDecimal('100', 6));
assert.equal(burn.burnPlan.credit, true);

const savings = await client.savingsSnapshot({ account: sdk.fixtureAccount });
assert.equal(savings.currentRatePPM, 59400n);
assert.equal(savings.interestDelay, 259200n);
assert.equal(savings.account.locked, false);
const equity = await client.equitySnapshot({ account: sdk.fixtureAccount, investment: sdk.parseDecimal('100', 18), redemptionShares: sdk.parseDecimal('1', 18) });
assert.equal(equity.account.canRedeem, true);
assert.equal(equity.minimumHoldingDuration >> 20n, 7776000n);
assert.notEqual(equity.quotedShares, null);
assert.notEqual(equity.quotedProceeds, null);
const governance = await client.governanceSnapshot(sdk.fixtureAccount, []);
assert.equal(governance.qualified, true);
assert.equal(sdk.isQualifiedVotes(0n, 0n), false);
assert.equal(sdk.isQualifiedVotes(200n, 10000n), false);
assert.equal(sdk.isQualifiedVotes(201n, 10000n), true);

async function freshClient() {
  return sdk.createV2Client(sdk.v2InstanceOf(registry, 'USD'), sdk.createFixtureProvider());
}
for (const scenario of ['wrong-chain', 'missing-code', 'rpc-error']) {
  sdk.fixtureControls.setScenario(scenario);
  await assert.rejects((await freshClient()).verify());
}
for (const [scenario, code] of [['cooldown', 'COOLDOWN'], ['expired', 'EXPIRATION'], ['challenged', 'NO_CHALLENGE']]) {
  sdk.fixtureControls.setScenario(scenario);
  const snapshot = await (await freshClient()).positionSnapshot(sdk.fixturePosition, { caller: sdk.fixtureAccount, quote: { grossAmount: 1n } });
  assert.equal(snapshot.eligible, false);
  assert(snapshot.checks.some((entry) => entry.code === code && entry.status === 'fail'));
}
sdk.fixtureControls.setScenario('no-votes');
const noVotes = await (await freshClient()).governanceSnapshot(sdk.fixtureAccount, []);
assert.equal(noVotes.totalVotes, 0n);
assert.equal(noVotes.qualified, false);
sdk.fixtureControls.setScenario('zero-balance');
const underfunded = await (await freshClient()).newPositionSnapshot({
  caller: sdk.fixtureAccount,
  collateral: sdk.fixtureCollateral,
  minCollateral: sdk.parseDecimal('4000', 6),
  initialCollateral: sdk.parseDecimal('100000', 6),
  mintingMaximum: sdk.parseDecimal('50000', 18),
  initPeriodSeconds: 259200n,
  durationSeconds: 31536000n,
  challengePeriodSeconds: 86400n,
  riskPremiumPPM: 20000n,
  liquidationPrice: sdk.parseLiquidationPrice('2', 6),
  reserveContributionPPM: 200000n,
});
assert.equal(underfunded.valid, false);
assert.equal(underfunded.funding.openingFeeFunded, false);
sdk.fixtureControls.reset();
await assert.rejects((await freshClient()).provider.call({ to: sdk.fixturePosition, data: '0x12345678' }));
console.log(JSON.stringify({ ok: true, fixtureOnly: true, liveDeployment: false, verifiedProposal: true, positionAndCloneQuotes: true, repaymentAndWithdrawal: true, bridgeCreditsAndRounding: true, savingsEquityGovernance: true, scenarios: sdk.fixtureScenarios }, null, 2));
