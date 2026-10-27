import { Interface, Network, ZeroAddress, getAddress, type Provider } from 'ethers';
import {
  V2_BRIDGE_ABI,
  V2_EQUITY_ABI,
  V2_ERC20_ABI,
  V2_MINTING_HUB_ABI,
  V2_POSITION_ABI,
  V2_POSITION_ROLLER_ABI,
  V2_SAVINGS_ABI,
  V2_TOKEN_ABI,
  grossMintForUsable,
  quoteFeePPM,
  quoteUsableMint,
} from '@dogeforex/sdk/v2';

const FIXTURE_REGISTRY_JSON = String.raw`{
  "address": "0xf17e000000000000000000000000000000000003",
  "abi": [],
  "linkedData": {
    "schemaVersion": "2.0",
    "network": "fixture-v2",
    "chainId": "6281971",
    "code": "USD",
    "sourceEvidence": {
      "synthetic": true,
      "evidenceType": "synthetic",
      "message": "SYNTHETIC V2 FIXTURE — not deployed or live state",
      "address": "0xf17e000000000000000000000000000000000002",
      "decimals": "6",
      "onchainDecimals": "6",
      "decimalMultiplier": "1000000000000",
      "bytecodeValidated": false,
      "fundingMode": "synthetic reads only; no funding or deployment"
    },
    "rateEvidence": {
      "synthetic": true,
      "evidenceType": "synthetic",
      "message": "SYNTHETIC V2 FIXTURE — not an observed or live rate",
      "code": "USD",
      "leadratePPM": 59400
    },
    "constructorArgs": {
      "TestUSDC": [],
      "Token": ["86400", "SYNTHETIC V2 Fixture Dollar", "sK9USD"],
      "Equity": ["0xf17e000000000000000000000000000000000003", "SYNTHETIC V2 Fixture Dollar", "sK9USD"],
      "PositionFactory": [],
      "PositionRoller": ["0xf17e000000000000000000000000000000000003"],
      "Savings": ["0xf17e000000000000000000000000000000000003", "59400"],
      "MintingHub": [
        "0xf17e000000000000000000000000000000000003",
        "0xf17e000000000000000000000000000000000007",
        "0xf17e000000000000000000000000000000000006",
        "0xf17e000000000000000000000000000000000005"
      ],
      "Bridge": [
        "0xf17e000000000000000000000000000000000002",
        "0xf17e000000000000000000000000000000000003",
        "2000000000000000000000000"
      ]
    },
    "addresses": {
      "deployer": "0xf17e000000000000000000000000000000000001",
      "source": "0xf17e000000000000000000000000000000000002",
      "Token": "0xf17e000000000000000000000000000000000003",
      "Equity": "0xf17e000000000000000000000000000000000004",
      "PositionFactory": "0xf17e000000000000000000000000000000000005",
      "PositionRoller": "0xf17e000000000000000000000000000000000006",
      "Savings": "0xf17e000000000000000000000000000000000007",
      "MintingHub": "0xf17e000000000000000000000000000000000008",
      "Bridge": "0xf17e000000000000000000000000000000000009"
    },
    "transactions": {
      "deployments": {
        "TestUSDC": null,
        "Token": null,
        "Equity": null,
        "PositionFactory": null,
        "PositionRoller": null,
        "Savings": null,
        "MintingHub": null,
        "Bridge": null
      },
      "initialize": {},
      "sourceFunding": null,
      "sourceApproval": null,
      "bridgeMint": null,
      "equityInvestment": null
    },
    "postconditions": {
      "complete": false,
      "synthetic": true,
      "deployed": false,
      "message": "SYNTHETIC V2 FIXTURE — postconditions are intentionally incomplete"
    }
  }
}`;

type FixtureAddressKey =
  | 'deployer'
  | 'source'
  | 'Token'
  | 'Equity'
  | 'PositionFactory'
  | 'PositionRoller'
  | 'Savings'
  | 'MintingHub'
  | 'Bridge';

interface FixtureRegistryArtifact {
  readonly address: string;
  readonly abi: readonly unknown[];
  readonly linkedData: {
    readonly sourceEvidence: {
      readonly onchainDecimals: string;
      readonly decimalMultiplier: string;
    };
    readonly constructorArgs: {
      readonly Token: readonly [string, string, string];
      readonly Savings: readonly [string, string];
      readonly Bridge: readonly [string, string, string];
      readonly [key: string]: readonly unknown[];
    };
    readonly addresses: Record<FixtureAddressKey, string>;
  };
}

export const fixtureRegistry = JSON.parse(FIXTURE_REGISTRY_JSON) as FixtureRegistryArtifact;

export const fixturePosition = '0xF17e00000000000000000000000000000000000A';
export const fixtureAccount = '0xF17e00000000000000000000000000000000000B';
export const fixtureCollateral = '0xf17e00000000000000000000000000000000000c';
const fixtureChallenger = '0xF17e00000000000000000000000000000000000D';

export const fixtureScenarios = [
  'valid',
  'wrong-chain',
  'missing-code',
  'rpc-error',
  'no-votes',
  'cooldown',
  'expired',
  'challenged',
  'zero-balance',
] as const;

export type FixtureScenario = (typeof fixtureScenarios)[number];
let scenario: FixtureScenario = 'valid';

export const fixtureControls = Object.freeze({
  get scenario(): FixtureScenario {
    return scenario;
  },
  setScenario(next: FixtureScenario): FixtureScenario {
    if (!(fixtureScenarios as readonly string[]).includes(next)) {
      throw new Error(`SYNTHETIC V2 FIXTURE: unknown scenario ${String(next)}`);
    }
    scenario = next;
    return scenario;
  },
  reset(): FixtureScenario {
    scenario = 'valid';
    return scenario;
  },
});

const LINKED = fixtureRegistry.linkedData;
const ADDRESSES = LINKED.addresses;
const TOKEN_NAME = LINKED.constructorArgs.Token[1];
const TOKEN_SYMBOL = LINKED.constructorArgs.Token[2];
const MIN_APPLICATION_PERIOD = BigInt(LINKED.constructorArgs.Token[0]);
const SAVINGS_RATE_PPM = BigInt(LINKED.constructorArgs.Savings[1]);
const SOURCE_DECIMALS = BigInt(LINKED.sourceEvidence.onchainDecimals);
const DECIMAL_MULTIPLIER = BigInt(LINKED.sourceEvidence.decimalMultiplier);
const BRIDGE_LIMIT_LOCAL = BigInt(LINKED.constructorArgs.Bridge[2]);

const CHAIN_ID = 6_281_971n;
const BLOCK_NUMBER = 6_281_971;
const BLOCK_HASH = `0x${'f17e'.repeat(16)}`;
const NOW = 1_800_000_000n;
const DAY = 86_400n;
const YEAR = 365n * DAY;
const E18 = 10n ** 18n;
const LOCAL_DECIMALS = 18n;
const COLLATERAL_DECIMALS = 6n;
const SOURCE_UNIT = 10n ** SOURCE_DECIMALS;
const COLLATERAL_UNIT = 10n ** COLLATERAL_DECIMALS;
const RISK_PREMIUM_PPM = 20_000n;
const ANNUAL_INTEREST_PPM = SAVINGS_RATE_PPM + RISK_PREMIUM_PPM;
const RESERVE_CONTRIBUTION_PPM = 200_000n;
const PPM = 1_000_000n;
const POSITION_PRICE = 2n * 10n ** 30n;
const POSITION_LIMIT = 1_000_000n * E18;
const POSITION_MINTED = 100_000n * E18;
const POSITION_COLLATERAL = 100_000n * COLLATERAL_UNIT;
const POSITION_MINIMUM_COLLATERAL = 5_000n * COLLATERAL_UNIT;
const POSITION_START = NOW - 30n * DAY;
const POSITION_HEALTHY_EXPIRATION = NOW + 180n * DAY;
const CHALLENGE_PERIOD = 2n * DAY;
const CHALLENGE_START = NOW - 3_600n;
const CHALLENGED_COLLATERAL = 10_000n * COLLATERAL_UNIT;
const MINTER_RESERVE = 20_000n * E18;
const RESERVE_LOCAL_BALANCE = 1_000_000n * E18;
const EQUITY_AMOUNT = RESERVE_LOCAL_BALANCE - MINTER_RESERVE;
const LOCAL_TOTAL_SUPPLY = 5_000_000n * E18;
const ACCOUNT_LOCAL_BALANCE = 250_000n * E18;
const ACCOUNT_SOURCE_BALANCE = 500_000n * SOURCE_UNIT;
const ACCOUNT_COLLATERAL_BALANCE = 1_000_000n * COLLATERAL_UNIT;
const SOURCE_LOCKED = 1_000_000n * SOURCE_UNIT;
const BRIDGE_MINTED_LOCAL = SOURCE_LOCKED * DECIMAL_MULTIPLIER;
const ACCOUNT_CREDIT = 125n * SOURCE_UNIT;
const BRIDGE_HORIZON = NOW + 180n * DAY;
const SAVINGS_ANCHOR = NOW - 30n * DAY;
const SAVINGS_TICKS_ANCHOR = 0n;
const INTEREST_DELAY = 3n * DAY;
const ACCOUNT_SAVED = 25_000n * E18;
const TOTAL_SHARES = 1_000n * E18;
const ACCOUNT_SHARES = 100n * E18;
const HOLDING_DURATION = 180n * DAY;
const TIME_RESOLUTION_BITS = 20n;
const MIN_HOLDING_DURATION = 90n * DAY * 2n ** TIME_RESOLUTION_BITS;
const VALUATION_FACTOR = 3n;
const MINTER_VALIDITY_START = NOW - 200n * DAY;
const SYNTHETIC_CODE = '0x60006000';

export const fixtureBlock = Object.freeze({
  number: BLOCK_NUMBER,
  hash: BLOCK_HASH,
  timestamp: NOW,
});

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function fixtureError(message: string): Error {
  return new Error(`SYNTHETIC V2 FIXTURE: ${message}`);
}

function assertReadable(): void {
  if (scenario === 'rpc-error') throw fixtureError('rpc-error forced read failure');
  if (scenario === 'wrong-chain') {
    throw fixtureError(`wrong-chain: registry ${CHAIN_ID}, provider ${CHAIN_ID + 1n}`);
  }
}

function assertBlockTag(tag: unknown): void {
  if (
    tag === undefined ||
    tag === 'latest' ||
    tag === BLOCK_NUMBER ||
    tag === BLOCK_HASH ||
    tag === String(BLOCK_NUMBER)
  ) return;
  throw fixtureError(`unexpected block tag ${String(tag)}`);
}

function addressArg(args: readonly unknown[], index: number): string {
  const value = args[index];
  if (typeof value !== 'string') throw fixtureError(`expected address argument ${index}`);
  return getAddress(value).toLowerCase();
}

function bigintArg(args: readonly unknown[], index: number): bigint {
  const value = args[index];
  if (typeof value !== 'bigint') throw fixtureError(`expected integer argument ${index}`);
  return value;
}

function booleanArg(args: readonly unknown[], index: number): boolean {
  const value = args[index];
  if (typeof value !== 'boolean') throw fixtureError(`expected boolean argument ${index}`);
  return value;
}

function addressArrayArg(args: readonly unknown[], index: number): readonly string[] {
  const value = args[index];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw fixtureError(`expected address array argument ${index}`);
  }
  return value as string[];
}

function isZeroBalance(): boolean {
  return scenario === 'zero-balance';
}

function localBalance(owner: string): bigint {
  if (sameAddress(owner, fixtureAccount)) return isZeroBalance() ? 0n : ACCOUNT_LOCAL_BALANCE;
  if (sameAddress(owner, ADDRESSES.Equity)) return RESERVE_LOCAL_BALANCE;
  return 0n;
}

function sourceBalance(owner: string): bigint {
  if (sameAddress(owner, fixtureAccount)) return isZeroBalance() ? 0n : ACCOUNT_SOURCE_BALANCE;
  if (sameAddress(owner, ADDRESSES.Bridge)) return SOURCE_LOCKED;
  return 0n;
}

function collateralBalance(owner: string): bigint {
  if (sameAddress(owner, fixtureAccount)) return isZeroBalance() ? 0n : ACCOUNT_COLLATERAL_BALANCE;
  if (sameAddress(owner, fixturePosition)) return POSITION_COLLATERAL;
  return 0n;
}

function equityShares(owner: string): bigint {
  if (sameAddress(owner, fixtureAccount)) return isZeroBalance() ? 0n : ACCOUNT_SHARES;
  return 0n;
}

function localAllowance(owner: string, spender: string): bigint {
  if (!sameAddress(owner, fixtureAccount)) return 0n;
  if (sameAddress(spender, fixturePosition) || sameAddress(spender, ADDRESSES.MintingHub)) {
    return ACCOUNT_LOCAL_BALANCE;
  }
  return 0n;
}

function sourceAllowance(owner: string, spender: string): bigint {
  return sameAddress(owner, fixtureAccount) && sameAddress(spender, ADDRESSES.Bridge)
    ? 250_000n * SOURCE_UNIT
    : 0n;
}

function collateralAllowance(owner: string, spender: string): bigint {
  if (!sameAddress(owner, fixtureAccount)) return 0n;
  if (sameAddress(spender, ADDRESSES.MintingHub)) return 500_000n * COLLATERAL_UNIT;
  if (sameAddress(spender, ADDRESSES.PositionRoller)) return POSITION_COLLATERAL;
  return 0n;
}

interface Erc20State {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: bigint;
  readonly totalSupply: bigint;
  balanceOf(owner: string): bigint;
  allowance(owner: string, spender: string): bigint;
}

type View = (args: readonly unknown[]) => readonly unknown[];
type ViewMap = Readonly<Record<string, View>>;

function erc20Views(state: Erc20State): ViewMap {
  return {
    'name()': () => [state.name],
    'symbol()': () => [state.symbol],
    'decimals()': () => [state.decimals],
    'totalSupply()': () => [state.totalSupply],
    'balanceOf(address)': (args) => [state.balanceOf(addressArg(args, 0))],
    'allowance(address,address)': (args) => [state.allowance(addressArg(args, 0), addressArg(args, 1))],
  };
}

function positionExpiration(): bigint {
  return scenario === 'expired' ? NOW : POSITION_HEALTHY_EXPIRATION;
}

function positionCooldown(): bigint {
  return scenario === 'cooldown' ? NOW : NOW - 1n;
}

function positionFee(expiration: bigint): bigint {
  return quoteFeePPM(expiration, POSITION_START, NOW, ANNUAL_INTEREST_PPM);
}

function availableForMinting(): bigint {
  return POSITION_LIMIT - POSITION_MINTED;
}

function availableForClones(): bigint {
  const potential = (collateralBalance(fixturePosition) * POSITION_PRICE) / E18;
  const unusedPotential = POSITION_MINTED > potential ? 0n : potential - POSITION_MINTED;
  const reserved = POSITION_MINTED + unusedPotential;
  return reserved >= POSITION_LIMIT ? 0n : POSITION_LIMIT - reserved;
}

function adjustedReservePPM(reservePPM: bigint): bigint {
  const currentReserve = localBalance(ADDRESSES.Equity);
  return currentReserve < MINTER_RESERVE
    ? (reservePPM * currentReserve) / MINTER_RESERVE
    : reservePPM;
}

function calculateAssignedReserve(mintedAmount: bigint, reservePPM: bigint): bigint {
  const theoreticalReserve = (reservePPM * mintedAmount) / PPM;
  const currentReserve = localBalance(ADDRESSES.Equity);
  return currentReserve < MINTER_RESERVE
    ? (theoreticalReserve * currentReserve) / MINTER_RESERVE
    : theoreticalReserve;
}

function calculateFreedAmount(amount: bigint, reservePPM: bigint): bigint {
  const denominator = PPM - adjustedReservePPM(reservePPM);
  if (denominator <= 0n) throw fixtureError('calculateFreedAmount denominator is not positive');
  return (PPM * amount) / denominator;
}

function findRepaymentAmount(): bigint {
  const target = POSITION_MINTED;
  if (target === 0n) return 0n;
  let lowerBound = 0n;
  let lowerResult = 0n;
  let higherBound = target;
  let higherResult = calculateFreedAmount(target, RESERVE_CONTRIBUTION_PPM);
  if (higherResult === target) return target;
  for (let steps = 0; steps < 256; steps += 1) {
    const middle = (lowerBound + higherBound) / 2n;
    if (middle === lowerBound) return higherBound;
    const middleResult = calculateFreedAmount(middle, RESERVE_CONTRIBUTION_PPM);
    if (middleResult === target) return middle;
    if (middleResult < target) {
      lowerBound = middle;
      lowerResult = middleResult;
    } else {
      higherBound = middle;
      higherResult = middleResult;
    }
  }
  throw fixtureError(`repayment search did not converge ${String([lowerResult, higherResult])}`);
}

function expiredPurchasePrice(): bigint {
  const expiration = positionExpiration();
  if (NOW <= expiration) return 10n * POSITION_PRICE;
  const timePassed = NOW - expiration;
  if (timePassed <= CHALLENGE_PERIOD) {
    const timeLeft = CHALLENGE_PERIOD - timePassed;
    return POSITION_PRICE + ((9n * POSITION_PRICE) / CHALLENGE_PERIOD) * timeLeft;
  }
  if (timePassed < 2n * CHALLENGE_PERIOD) {
    return (POSITION_PRICE / CHALLENGE_PERIOD) * (2n * CHALLENGE_PERIOD - timePassed);
  }
  return 0n;
}

function challengePrice(): bigint {
  const secondPhaseStart = CHALLENGE_START + CHALLENGE_PERIOD;
  if (NOW <= secondPhaseStart) return POSITION_PRICE;
  if (NOW >= secondPhaseStart + CHALLENGE_PERIOD) return 0n;
  const timeLeft = CHALLENGE_PERIOD - (NOW - secondPhaseStart);
  return (POSITION_PRICE / CHALLENGE_PERIOD) * timeLeft;
}

function savingsTicks(timestamp: bigint): bigint {
  if (timestamp < SAVINGS_ANCHOR) throw fixtureError('savings timestamp precedes its anchor');
  return SAVINGS_TICKS_ANCHOR + (timestamp - SAVINGS_ANCHOR) * SAVINGS_RATE_PPM;
}

function savingsAccountTicks(): bigint {
  return savingsTicks(NOW) - 7n * DAY * SAVINGS_RATE_PPM;
}

function savingsSaved(owner: string): bigint {
  return sameAddress(owner, fixtureAccount) && !isZeroBalance() ? ACCOUNT_SAVED : 0n;
}

function accruedInterest(owner: string, timestamp: bigint): bigint {
  const ticks = savingsTicks(timestamp);
  const accountTicks = savingsAccountTicks();
  const saved = savingsSaved(owner);
  if (ticks <= accountTicks || accountTicks === 0n || saved === 0n) return 0n;
  const interest = ((ticks - accountTicks) * saved) / PPM / YEAR;
  return interest > EQUITY_AMOUNT ? EQUITY_AMOUNT : interest;
}

function holdingDuration(owner: string): bigint {
  if (!sameAddress(owner, fixtureAccount) || scenario === 'no-votes') return 0n;
  return HOLDING_DURATION;
}

function votes(owner: string): bigint {
  return equityShares(owner) * (holdingDuration(owner) << TIME_RESOLUTION_BITS);
}

function totalVotes(): bigint {
  if (scenario === 'no-votes') return 0n;
  return TOTAL_SHARES * (HOLDING_DURATION << TIME_RESOLUTION_BITS);
}

function delegatedVotes(owner: string, helpers: readonly string[]): bigint {
  if (helpers.length !== 0) throw fixtureError('delegated helper reads are not configured');
  return votes(owner);
}

function notQualified(): never {
  const error = fixtureError('NotQualified') as Error & { data?: string; errorName?: string };
  error.data = new Interface(V2_EQUITY_ABI).encodeErrorResult('NotQualified', []);
  error.errorName = 'NotQualified';
  throw error;
}

function mulD18(left: bigint, right: bigint): bigint {
  return (left * right) / E18;
}

function divD18(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw fixtureError('D18 division by zero');
  return (numerator * E18) / denominator;
}

function power3(value: bigint): bigint {
  return mulD18(mulD18(value, value), value);
}

function cubicRoot(value: bigint): bigint {
  let x = value > E18 && value < 10n ** 19n ? ((value - E18) / 3n + E18) : E18;
  for (let steps = 0; steps < 256; steps += 1) {
    const powX3 = power3(x);
    const next = (x * (powX3 + 2n * value)) / (2n * powX3 + value);
    const difference = next > x ? next - x : x - next;
    x = next;
    if (difference <= 1_000_000n) return x;
  }
  throw fixtureError('equity cubic root did not converge');
}

function calculateShares(investment: bigint): bigint {
  const investmentExFees = (investment * 997n) / 1_000n;
  const newTotalShares = EQUITY_AMOUNT < 100n * E18 || TOTAL_SHARES === 0n
    ? TOTAL_SHARES + 1_000n * E18
    : mulD18(TOTAL_SHARES, cubicRoot(divD18(EQUITY_AMOUNT + investmentExFees, EQUITY_AMOUNT)));
  return newTotalShares - TOTAL_SHARES;
}

function calculateProceeds(shares: bigint): bigint {
  if (shares + E18 >= TOTAL_SHARES) throw fixtureError('too many shares');
  const reductionAfterFees = (shares * 997n) / 1_000n;
  const newCapital = mulD18(EQUITY_AMOUNT, power3(divD18(TOTAL_SHARES - reductionAfterFees, TOTAL_SHARES)));
  return EQUITY_AMOUNT - newCapital;
}

const sourceViews = erc20Views({
  name: 'SYNTHETIC V2 Source USD',
  symbol: 'sfUSD',
  decimals: SOURCE_DECIMALS,
  totalSupply: 10_000_000n * SOURCE_UNIT,
  balanceOf: sourceBalance,
  allowance: sourceAllowance,
});

const collateralViews = erc20Views({
  name: 'SYNTHETIC V2 Collateral',
  symbol: 'sfCOLL',
  decimals: COLLATERAL_DECIMALS,
  totalSupply: 10_000_000n * COLLATERAL_UNIT,
  balanceOf: collateralBalance,
  allowance: collateralAllowance,
});

const tokenViews: ViewMap = {
  ...erc20Views({
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    decimals: LOCAL_DECIMALS,
    totalSupply: LOCAL_TOTAL_SUPPLY,
    balanceOf: localBalance,
    allowance: localAllowance,
  }),
  'MIN_APPLICATION_PERIOD()': () => [MIN_APPLICATION_PERIOD],
  'MIN_FEE()': () => [1_000n * E18],
  'minterReserve()': () => [MINTER_RESERVE],
  'equity()': () => [EQUITY_AMOUNT],
  'reserve()': () => [ADDRESSES.Equity],
  'minters(address)': (args) => {
    const candidate = addressArg(args, 0);
    const active = [ADDRESSES.Savings, ADDRESSES.PositionFactory, ADDRESSES.PositionRoller, ADDRESSES.MintingHub, ADDRESSES.Bridge]
      .some((address) => sameAddress(candidate, address));
    return [active ? MINTER_VALIDITY_START : 0n];
  },
  'isMinter(address)': (args) => {
    const candidate = addressArg(args, 0);
    const active = [ADDRESSES.Savings, ADDRESSES.PositionFactory, ADDRESSES.PositionRoller, ADDRESSES.MintingHub, ADDRESSES.Bridge]
      .some((address) => sameAddress(candidate, address));
    return [active && NOW >= MINTER_VALIDITY_START];
  },
  'positions(address)': (args) => [sameAddress(addressArg(args, 0), fixturePosition) ? ADDRESSES.MintingHub : ZeroAddress],
  'getPositionParent(address)': (args) => [sameAddress(addressArg(args, 0), fixturePosition) ? ADDRESSES.MintingHub : ZeroAddress],
  'calculateAssignedReserve(uint256,uint32)': (args) => [calculateAssignedReserve(bigintArg(args, 0), bigintArg(args, 1))],
  'calculateFreedAmount(uint256,uint32)': (args) => [calculateFreedAmount(bigintArg(args, 0), bigintArg(args, 1))],
};

const hubViews: ViewMap = {
  'OPENING_FEE()': () => [1_000n * E18],
  'CHALLENGER_REWARD()': () => [20_000n],
  'EXPIRED_PRICE_FACTOR()': () => [10n],
  'ofd()': () => [ADDRESSES.Token],
  'rate()': () => [ADDRESSES.Savings],
  'roller()': () => [ADDRESSES.PositionRoller],
  'pendingReturns(address,address)': () => [0n],
  'challenges(uint256)': (args) => {
    if (bigintArg(args, 0) !== 0n) throw fixtureError('only challenge index zero is configured');
    return scenario === 'challenged'
      ? [fixtureChallenger, CHALLENGE_START, fixturePosition, CHALLENGED_COLLATERAL]
      : [ZeroAddress, 0n, ZeroAddress, 0n];
  },
  'price(uint32)': (args) => {
    if (bigintArg(args, 0) !== 0n) throw fixtureError('only challenge index zero is configured');
    return [scenario === 'challenged' ? challengePrice() : 0n];
  },
  'expiredPurchasePrice(address)': (args) => {
    if (!sameAddress(addressArg(args, 0), fixturePosition)) throw fixtureError('unknown position');
    return [expiredPurchasePrice()];
  },
};

const positionViews: ViewMap = {
  'owner()': () => [fixtureAccount],
  'collateral()': () => [fixtureCollateral],
  'price()': () => [POSITION_PRICE],
  'limit()': () => [POSITION_LIMIT],
  'minted()': () => [POSITION_MINTED],
  'minimumCollateral()': () => [POSITION_MINIMUM_COLLATERAL],
  'challengedAmount()': () => [scenario === 'challenged' ? CHALLENGED_COLLATERAL : 0n],
  'challengeData()': () => [POSITION_PRICE, CHALLENGE_PERIOD],
  'challengePeriod()': () => [CHALLENGE_PERIOD],
  'start()': () => [POSITION_START],
  'cooldown()': () => [positionCooldown()],
  'expiration()': () => [positionExpiration()],
  'original()': () => [fixturePosition],
  'hub()': () => [ADDRESSES.MintingHub],
  'ofd()': () => [ADDRESSES.Token],
  'isClosed()': () => [false],
  'reserveContribution()': () => [RESERVE_CONTRIBUTION_PPM],
  'riskPremiumPPM()': () => [RISK_PREMIUM_PPM],
  'annualInterestPPM()': () => [ANNUAL_INTEREST_PPM],
  'availableForMinting()': () => [availableForMinting()],
  'availableForClones()': () => [availableForClones()],
  'calculateCurrentFee()': () => [positionFee(positionExpiration())],
  'calculateFee(uint256)': (args) => [positionFee(bigintArg(args, 0))],
  'getUsableMint(uint256,bool)': (args) => {
    const gross = bigintArg(args, 0);
    const fee = booleanArg(args, 1) ? positionFee(positionExpiration()) : 0n;
    return [quoteUsableMint(gross, RESERVE_CONTRIBUTION_PPM, fee).usableAmount];
  },
  'getMintAmount(uint256)': (args) => [
    grossMintForUsable(bigintArg(args, 0), RESERVE_CONTRIBUTION_PPM, positionFee(positionExpiration())),
  ],
};

const rollerViews: ViewMap = {
  'findRepaymentAmount(address)': (args) => {
    if (!sameAddress(addressArg(args, 0), fixturePosition)) throw fixtureError('unknown position');
    return [findRepaymentAmount()];
  },
};

const equityViews: ViewMap = {
  ...erc20Views({
    name: `${TOKEN_NAME} Pool Share`,
    symbol: `${TOKEN_SYMBOL}PS`,
    decimals: LOCAL_DECIMALS,
    totalSupply: TOTAL_SHARES,
    balanceOf: equityShares,
    allowance: () => 0n,
  }),
  'price()': () => [EQUITY_AMOUNT === 0n || TOTAL_SHARES === 0n ? E18 : (VALUATION_FACTOR * EQUITY_AMOUNT * E18) / TOTAL_SHARES],
  'ofd()': () => [ADDRESSES.Token],
  'VALUATION_FACTOR()': () => [VALUATION_FACTOR],
  'MIN_HOLDING_DURATION()': () => [MIN_HOLDING_DURATION],
  'calculateShares(uint256)': (args) => [calculateShares(bigintArg(args, 0))],
  'calculateProceeds(uint256)': (args) => [calculateProceeds(bigintArg(args, 0))],
  'canRedeem(address)': (args) => [
    holdingDuration(addressArg(args, 0)) * 2n ** TIME_RESOLUTION_BITS >= MIN_HOLDING_DURATION,
  ],
  'holdingDuration(address)': (args) => [holdingDuration(addressArg(args, 0))],
  'votes(address)': (args) => [votes(addressArg(args, 0))],
  'totalVotes()': () => [totalVotes()],
  'relativeVotes(address)': (args) => {
    const total = totalVotes();
    if (total === 0n) throw fixtureError('relative votes with zero total votes');
    return [(E18 * votes(addressArg(args, 0))) / total];
  },
  'votesDelegated(address,address[])': (args) => [delegatedVotes(addressArg(args, 0), addressArrayArg(args, 1))],
  'checkQualified(address,address[])': (args) => {
    const qualified = delegatedVotes(addressArg(args, 0), addressArrayArg(args, 1)) * 10_000n > 200n * totalVotes();
    if (!qualified) notQualified();
    return [];
  },
  'delegates(address)': () => [ZeroAddress],
};

const savingsViews: ViewMap = {
  'ofd()': () => [ADDRESSES.Token],
  'equity()': () => [ADDRESSES.Equity],
  'currentRatePPM()': () => [SAVINGS_RATE_PPM],
  'nextRatePPM()': () => [SAVINGS_RATE_PPM],
  'nextChange()': () => [SAVINGS_ANCHOR],
  'INTEREST_DELAY()': () => [INTEREST_DELAY],
  'currentTicks()': () => [savingsTicks(NOW)],
  'ticks(uint256)': (args) => [savingsTicks(bigintArg(args, 0))],
  'savings(address)': (args) => {
    const owner = addressArg(args, 0);
    return [savingsSaved(owner), sameAddress(owner, fixtureAccount) ? savingsAccountTicks() : 0n];
  },
  'accruedInterest(address)': (args) => [accruedInterest(addressArg(args, 0), NOW)],
  'accruedInterest(address,uint256)': (args) => [accruedInterest(addressArg(args, 0), bigintArg(args, 1))],
};

const bridgeViews: ViewMap = {
  'usd()': () => [ADDRESSES.source],
  'ofd()': () => [ADDRESSES.Token],
  'decimalMultiplier()': () => [DECIMAL_MULTIPLIER],
  'limit()': () => [BRIDGE_LIMIT_LOCAL],
  'minted()': () => [BRIDGE_MINTED_LOCAL],
  'horizon()': () => [BRIDGE_HORIZON],
  'credits(address)': (args) => [
    sameAddress(addressArg(args, 0), fixtureAccount) && !isZeroBalance() ? ACCOUNT_CREDIT : 0n,
  ],
  'balanceOf(address)': (args) => [
    sameAddress(addressArg(args, 0), fixtureAccount) && !isZeroBalance() ? ACCOUNT_CREDIT : 0n,
  ],
};

interface FixtureContract {
  readonly interface: Interface;
  readonly views: ViewMap;
}

const erc20Interface = new Interface(V2_ERC20_ABI);
const contracts = new Map<string, FixtureContract>([
  [ADDRESSES.source.toLowerCase(), { interface: erc20Interface, views: sourceViews }],
  [fixtureCollateral.toLowerCase(), { interface: erc20Interface, views: collateralViews }],
  [ADDRESSES.Token.toLowerCase(), { interface: new Interface(V2_TOKEN_ABI), views: tokenViews }],
  [ADDRESSES.MintingHub.toLowerCase(), { interface: new Interface(V2_MINTING_HUB_ABI), views: hubViews }],
  [fixturePosition.toLowerCase(), { interface: new Interface(V2_POSITION_ABI), views: positionViews }],
  [ADDRESSES.PositionRoller.toLowerCase(), { interface: new Interface(V2_POSITION_ROLLER_ABI), views: rollerViews }],
  [ADDRESSES.Equity.toLowerCase(), { interface: new Interface(V2_EQUITY_ABI), views: equityViews }],
  [ADDRESSES.Savings.toLowerCase(), { interface: new Interface(V2_SAVINGS_ABI), views: savingsViews }],
  [ADDRESSES.Bridge.toLowerCase(), { interface: new Interface(V2_BRIDGE_ABI), views: bridgeViews }],
]);

const codeAddresses = new Set([
  ...Object.values(ADDRESSES).map((address) => address.toLowerCase()),
  fixturePosition.toLowerCase(),
  fixtureCollateral.toLowerCase(),
]);

function call(transaction: { to?: string | null; data?: string | null; blockTag?: unknown }): string {
  assertReadable();
  assertBlockTag(transaction.blockTag);
  if (typeof transaction.to !== 'string') throw fixtureError('read call is missing a target address');
  const target = getAddress(transaction.to).toLowerCase();
  const contract = contracts.get(target);
  if (!contract) throw fixtureError(`unexpected call target ${target}`);
  if (typeof transaction.data !== 'string' || !/^0x[0-9a-fA-F]+$/.test(transaction.data) || transaction.data.length < 10) {
    throw fixtureError('read call has invalid calldata');
  }
  const selector = transaction.data.slice(0, 10).toLowerCase();
  const fragment = contract.interface.getFunction(selector);
  if (!fragment) throw fixtureError(`unexpected selector ${selector} for ${target}`);
  const signature = fragment.format('sighash');
  const view = contract.views[signature];
  if (!view) throw fixtureError(`unexpected view ${signature} for ${target}`);
  const args = contract.interface.decodeFunctionData(fragment, transaction.data);
  return contract.interface.encodeFunctionResult(fragment, view(args));
}

export function createFixtureProvider(): Provider {
  return {
    call: async (transaction: { to?: string | null; data?: string | null; blockTag?: unknown }) => call(transaction),
    getBlock: async (blockTag?: unknown) => {
      assertReadable();
      assertBlockTag(blockTag);
      return { number: BLOCK_NUMBER, hash: BLOCK_HASH, timestamp: Number(NOW) };
    },
    getCode: async (address: string, blockTag?: unknown) => {
      assertReadable();
      assertBlockTag(blockTag);
      const normalized = getAddress(address).toLowerCase();
      if (scenario === 'missing-code') return '0x';
      return codeAddresses.has(normalized) ? SYNTHETIC_CODE : '0x';
    },
    getNetwork: async () => {
      if (scenario === 'rpc-error') throw fixtureError('rpc-error forced network failure');
      return new Network('fixture-v2', scenario === 'wrong-chain' ? CHAIN_ID + 1n : CHAIN_ID);
    },
  } as unknown as Provider;
}
