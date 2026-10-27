import {
  Interface,
  ZeroAddress,
  getAddress,
  type EventFragment,
  type InterfaceAbi,
  type ParamType,
} from 'ethers';

export const V2_ERC20_ACTION_ABI = [
  'function approve(address spender,uint256 amount)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
] as const;

export const V2_HUB_ACTION_ABI = [
  'function openPosition(address collateral,uint256 minCollateral,uint256 initialCollateral,uint256 mintingMaximum,uint40 initPeriodSeconds,uint40 expirationSeconds,uint40 challengeSeconds,uint24 riskPremiumPPM,uint256 liquidationPrice,uint24 reservePPM)',
  'function clone(address owner,address parent,uint256 initialCollateral,uint256 initialMint,uint40 expiration)',
  'function challenge(address position,uint256 collateralAmount,uint256 minimumPrice)',
  'function bid(uint32 challengeNumber,uint256 size,bool postponeCollateralReturn)',
  'function returnPostponedCollateral(address collateral,address target)',
  'function buyExpiredCollateral(address position,uint256 upToAmount)',
  'event PositionOpened(address indexed owner,address indexed position,address original,address collateral)',
  'event ChallengeStarted(address indexed challenger,address indexed position,uint256 size,uint256 number)',
  'event ChallengeAverted(address indexed position,uint256 number,uint256 size)',
  'event ChallengeSucceeded(address indexed position,uint256 number,uint256 bid,uint256 acquiredCollateral,uint256 challengeSize)',
  'event PostPonedReturn(address collateral,address indexed beneficiary,uint256 amount)',
  'event ForcedSale(address pos,uint256 amount,uint256 priceE36MinusDecimals)',
] as const;

export const V2_POSITION_ACTION_ABI = [
  'function mint(address target,uint256 amount)',
  'function adjust(uint256 newMinted,uint256 newCollateral,uint256 newPrice)',
  'function adjustPrice(uint256 newPrice)',
  'function repay(uint256 amount)',
  'function withdrawCollateral(address target,uint256 amount)',
  'function withdraw(address token,address target,uint256 amount)',
  'function transferOwnership(address newOwner)',
  'function deny(address[] helpers,string message)',
  'event MintingUpdate(uint256 collateral,uint256 price,uint256 minted)',
  'event PositionDenied(address indexed sender,string message)',
  'event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)',
] as const;

export const V2_BRIDGE_ACTION_ABI = [
  'function mintTo(address target,uint256 amount)',
  'function burnAndSend(address target,uint256 amount)',
  'function burnAndCredit(address target,uint256 amount)',
  'function payoutCredit(address target)',
  'event Mint(address indexed target,uint256 amount)',
  'event Burn(address indexed holder,uint256 amount)',
  'event Credit(address indexed target,uint256 amount)',
  'event Payout(address indexed target,uint256 amount)',
] as const;

export const V2_SAVINGS_ACTION_ABI = [
  'function save(uint192 amount)',
  'function save(address owner,uint192 amount)',
  'function withdraw(address target,uint192 amount)',
  'function adjust(uint192 targetAmount)',
  'function refreshMyBalance()',
  'function refreshBalance(address owner)',
  'function proposeChange(uint24 newRatePPM,address[] helpers)',
  'function applyChange()',
  'event Saved(address indexed account,uint192 amount)',
  'event Withdrawn(address indexed account,uint192 amount)',
  'event InterestCollected(address indexed account,uint256 interest)',
  'event RateProposed(address who,uint24 nextRate,uint40 nextChange)',
  'event RateChanged(uint24 newRate)',
] as const;

export const V2_EQUITY_ACTION_ABI = [
  'function invest(uint256 amount,uint256 expectedShares)',
  'function redeemExpected(address target,uint256 shares,uint256 expectedProceeds)',
  'function delegateVoteTo(address delegate)',
  'function kamikaze(address[] targets,uint256 votesToDestroy)',
  'function restructureCapTable(address[] helpers,address[] addressesToWipe)',
  'event Trade(address who,int256 amount,uint256 totPrice,uint256 newprice)',
  'event Delegation(address indexed from,address indexed to)',
] as const;

export const V2_ROLLER_ACTION_ABI = [
  'function rollFully(address source,address targetPosition)',
  'function rollFullyWithExpiration(address source,address targetPosition,uint40 expiration)',
  'function roll(address source,uint256 repay,uint256 collateralWithdraw,address targetPosition,uint256 mint,uint256 collateralDeposit,uint40 expiration)',
  'event Roll(address source,uint256 collWithdraw,uint256 repay,address target,uint256 collDeposit,uint256 mint)',
] as const;

export const V2_TOKEN_ACTION_ABI = [
  'function suggestMinter(address minter,uint256 applicationPeriod,uint256 applicationFee,string message)',
  'function denyMinter(address minter,address[] helpers,string message)',
  'event MinterApplied(address indexed minter,uint256 applicationPeriod,uint256 applicationFee,string message)',
  'event MinterDenied(address indexed minter,string message)',
  'event Loss(address indexed reportingMinter,uint256 amount)',
  'event Profit(address indexed reportingMinter,uint256 amount)',
] as const;

export const V2_ACTION_ABI: InterfaceAbi = [
  ...V2_ERC20_ACTION_ABI,
  ...V2_HUB_ACTION_ABI,
  ...V2_POSITION_ACTION_ABI,
  ...V2_BRIDGE_ACTION_ABI,
  ...V2_SAVINGS_ACTION_ABI,
  ...V2_EQUITY_ACTION_ABI,
  ...V2_ROLLER_ACTION_ABI,
  ...V2_TOKEN_ACTION_ABI,
];

export const V2_ACTION_INTERFACE = new Interface(V2_ACTION_ABI);

export interface V2ActionArgsByOperation {
  'erc20.approve': { spender: string; amount: bigint };
  'hub.openPosition': {
    collateral: string;
    minCollateral: bigint;
    initialCollateral: bigint;
    mintingMaximum: bigint;
    initPeriodSeconds: bigint;
    expirationSeconds: bigint;
    challengeSeconds: bigint;
    riskPremiumPPM: bigint;
    liquidationPrice: bigint;
    reservePPM: bigint;
  };
  'hub.clone': {
    owner: string;
    parent: string;
    initialCollateral: bigint;
    initialMint: bigint;
    expiration: bigint;
  };
  'hub.challenge': { position: string; collateralAmount: bigint; minimumPrice: bigint };
  'hub.bid': { challengeNumber: bigint; size: bigint; postponeCollateralReturn: boolean };
  'hub.returnPostponedCollateral': { collateral: string; target: string };
  'hub.buyExpiredCollateral': { position: string; upToAmount: bigint };
  'position.mint': { target: string; amount: bigint };
  'position.adjust': { newMinted: bigint; newCollateral: bigint; newPrice: bigint };
  'position.adjustPrice': { newPrice: bigint };
  'position.repay': { amount: bigint };
  'position.withdrawCollateral': { target: string; amount: bigint };
  'position.withdraw': { token: string; target: string; amount: bigint };
  'position.transferOwnership': { newOwner: string };
  'position.deny': { helpers: readonly string[]; message: string };
  'bridge.mintTo': { target: string; amount: bigint };
  'bridge.burnAndSend': { target: string; amount: bigint };
  'bridge.burnAndCredit': { target: string; amount: bigint };
  'bridge.payoutCredit': { target: string };
  'savings.save': { amount: bigint };
  'savings.saveFor': { owner: string; amount: bigint };
  'savings.withdraw': { target: string; amount: bigint };
  'savings.adjust': { targetAmount: bigint };
  'savings.refreshMyBalance': Record<string, never>;
  'savings.refreshBalance': { owner: string };
  'savings.proposeChange': { newRatePPM: bigint; helpers: readonly string[] };
  'savings.applyChange': Record<string, never>;
  'equity.invest': { amount: bigint; expectedShares: bigint };
  'equity.redeemExpected': { target: string; shares: bigint; expectedProceeds: bigint };
  'equity.delegateVoteTo': { delegate: string };
  'equity.kamikaze': { targets: readonly string[]; votesToDestroy: bigint };
  'equity.restructureCapTable': { helpers: readonly string[]; addressesToWipe: readonly string[] };
  'roller.rollFully': { source: string; targetPosition: string };
  'roller.rollFullyWithExpiration': { source: string; targetPosition: string; expiration: bigint };
  'roller.roll': {
    source: string;
    repay: bigint;
    collateralWithdraw: bigint;
    targetPosition: string;
    mint: bigint;
    collateralDeposit: bigint;
    expiration: bigint;
  };
  'token.suggestMinter': {
    minter: string;
    applicationPeriod: bigint;
    applicationFee: bigint;
    message: string;
  };
  'token.denyMinter': { minter: string; helpers: readonly string[]; message: string };
}

export type V2Operation = keyof V2ActionArgsByOperation;
export type V2Action = {
  [K in V2Operation]: {
    readonly operation: K;
    readonly target: string;
    readonly args: V2ActionArgsByOperation[K];
  };
}[V2Operation];

export interface V2ActionMetadata {
  readonly contract: 'erc20' | 'hub' | 'position' | 'bridge' | 'savings' | 'equity' | 'roller' | 'token';
  readonly signature: string;
}

export const V2_ACTION_METADATA: Readonly<Record<V2Operation, V2ActionMetadata>> = Object.freeze({
  'erc20.approve': { contract: 'erc20', signature: 'approve(address,uint256)' },
  'hub.openPosition': {
    contract: 'hub',
    signature: 'openPosition(address,uint256,uint256,uint256,uint40,uint40,uint40,uint24,uint256,uint24)',
  },
  'hub.clone': { contract: 'hub', signature: 'clone(address,address,uint256,uint256,uint40)' },
  'hub.challenge': { contract: 'hub', signature: 'challenge(address,uint256,uint256)' },
  'hub.bid': { contract: 'hub', signature: 'bid(uint32,uint256,bool)' },
  'hub.returnPostponedCollateral': { contract: 'hub', signature: 'returnPostponedCollateral(address,address)' },
  'hub.buyExpiredCollateral': { contract: 'hub', signature: 'buyExpiredCollateral(address,uint256)' },
  'position.mint': { contract: 'position', signature: 'mint(address,uint256)' },
  'position.adjust': { contract: 'position', signature: 'adjust(uint256,uint256,uint256)' },
  'position.adjustPrice': { contract: 'position', signature: 'adjustPrice(uint256)' },
  'position.repay': { contract: 'position', signature: 'repay(uint256)' },
  'position.withdrawCollateral': { contract: 'position', signature: 'withdrawCollateral(address,uint256)' },
  'position.withdraw': { contract: 'position', signature: 'withdraw(address,address,uint256)' },
  'position.transferOwnership': { contract: 'position', signature: 'transferOwnership(address)' },
  'position.deny': { contract: 'position', signature: 'deny(address[],string)' },
  'bridge.mintTo': { contract: 'bridge', signature: 'mintTo(address,uint256)' },
  'bridge.burnAndSend': { contract: 'bridge', signature: 'burnAndSend(address,uint256)' },
  'bridge.burnAndCredit': { contract: 'bridge', signature: 'burnAndCredit(address,uint256)' },
  'bridge.payoutCredit': { contract: 'bridge', signature: 'payoutCredit(address)' },
  'savings.save': { contract: 'savings', signature: 'save(uint192)' },
  'savings.saveFor': { contract: 'savings', signature: 'save(address,uint192)' },
  'savings.withdraw': { contract: 'savings', signature: 'withdraw(address,uint192)' },
  'savings.adjust': { contract: 'savings', signature: 'adjust(uint192)' },
  'savings.refreshMyBalance': { contract: 'savings', signature: 'refreshMyBalance()' },
  'savings.refreshBalance': { contract: 'savings', signature: 'refreshBalance(address)' },
  'savings.proposeChange': { contract: 'savings', signature: 'proposeChange(uint24,address[])' },
  'savings.applyChange': { contract: 'savings', signature: 'applyChange()' },
  'equity.invest': { contract: 'equity', signature: 'invest(uint256,uint256)' },
  'equity.redeemExpected': { contract: 'equity', signature: 'redeemExpected(address,uint256,uint256)' },
  'equity.delegateVoteTo': { contract: 'equity', signature: 'delegateVoteTo(address)' },
  'equity.kamikaze': { contract: 'equity', signature: 'kamikaze(address[],uint256)' },
  'equity.restructureCapTable': { contract: 'equity', signature: 'restructureCapTable(address[],address[])' },
  'roller.rollFully': { contract: 'roller', signature: 'rollFully(address,address)' },
  'roller.rollFullyWithExpiration': {
    contract: 'roller',
    signature: 'rollFullyWithExpiration(address,address,uint40)',
  },
  'roller.roll': {
    contract: 'roller',
    signature: 'roll(address,uint256,uint256,address,uint256,uint256,uint40)',
  },
  'token.suggestMinter': {
    contract: 'token',
    signature: 'suggestMinter(address,uint256,uint256,string)',
  },
  'token.denyMinter': { contract: 'token', signature: 'denyMinter(address,address[],string)' },
});

export interface V2TransactionDescriptor {
  readonly to: string;
  readonly data: string;
  readonly operation: V2Operation;
  readonly signature: string;
}

export interface V2DecodedAction extends V2TransactionDescriptor {
  readonly args: Readonly<Record<string, unknown>>;
}

function uint(value: unknown, bits: number, label: string): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`${label} must be a bigint`);
  if (value < 0n || value > (1n << BigInt(bits)) - 1n) {
    throw new RangeError(`${label} must be between 0 and 2^${bits}-1`);
  }
  return value;
}

function address(value: unknown, label: string, allowZero = false): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an address string`);
  let normalized: string;
  try {
    normalized = getAddress(value);
  } catch {
    throw new TypeError(`${label} must be a valid address`);
  }
  if (!allowZero && normalized === ZeroAddress) throw new TypeError(`${label} must not be the zero address`);
  return normalized;
}

function addresses(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an address array`);
  return value.map((entry, index) => address(entry, `${label}[${index}]`));
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function encode(
  action: V2Action,
  values: readonly unknown[],
): V2TransactionDescriptor {
  const metadata = V2_ACTION_METADATA[action.operation];
  return {
    to: address(action.target, 'target'),
    data: V2_ACTION_INTERFACE.encodeFunctionData(metadata.signature, values),
    operation: action.operation,
    signature: metadata.signature,
  };
}

export function encodeV2Action(action: V2Action): V2TransactionDescriptor {
  switch (action.operation) {
    case 'erc20.approve':
      return encode(action, [address(action.args.spender, 'args.spender'), uint(action.args.amount, 256, 'args.amount')]);
    case 'hub.openPosition':
      return encode(action, [
        address(action.args.collateral, 'args.collateral'),
        uint(action.args.minCollateral, 256, 'args.minCollateral'),
        uint(action.args.initialCollateral, 256, 'args.initialCollateral'),
        uint(action.args.mintingMaximum, 256, 'args.mintingMaximum'),
        uint(action.args.initPeriodSeconds, 40, 'args.initPeriodSeconds'),
        uint(action.args.expirationSeconds, 40, 'args.expirationSeconds'),
        uint(action.args.challengeSeconds, 40, 'args.challengeSeconds'),
        uint(action.args.riskPremiumPPM, 24, 'args.riskPremiumPPM'),
        uint(action.args.liquidationPrice, 256, 'args.liquidationPrice'),
        uint(action.args.reservePPM, 24, 'args.reservePPM'),
      ]);
    case 'hub.clone':
      return encode(action, [
        address(action.args.owner, 'args.owner'),
        address(action.args.parent, 'args.parent'),
        uint(action.args.initialCollateral, 256, 'args.initialCollateral'),
        uint(action.args.initialMint, 256, 'args.initialMint'),
        uint(action.args.expiration, 40, 'args.expiration'),
      ]);
    case 'hub.challenge':
      return encode(action, [
        address(action.args.position, 'args.position'),
        uint(action.args.collateralAmount, 256, 'args.collateralAmount'),
        uint(action.args.minimumPrice, 256, 'args.minimumPrice'),
      ]);
    case 'hub.bid':
      return encode(action, [
        uint(action.args.challengeNumber, 32, 'args.challengeNumber'),
        uint(action.args.size, 256, 'args.size'),
        bool(action.args.postponeCollateralReturn, 'args.postponeCollateralReturn'),
      ]);
    case 'hub.returnPostponedCollateral':
      return encode(action, [
        address(action.args.collateral, 'args.collateral'),
        address(action.args.target, 'args.target'),
      ]);
    case 'hub.buyExpiredCollateral':
      return encode(action, [
        address(action.args.position, 'args.position'),
        uint(action.args.upToAmount, 256, 'args.upToAmount'),
      ]);
    case 'position.mint':
      return encode(action, [
        address(action.args.target, 'args.target'),
        uint(action.args.amount, 256, 'args.amount'),
      ]);
    case 'position.adjust':
      return encode(action, [
        uint(action.args.newMinted, 256, 'args.newMinted'),
        uint(action.args.newCollateral, 256, 'args.newCollateral'),
        uint(action.args.newPrice, 256, 'args.newPrice'),
      ]);
    case 'position.adjustPrice':
      return encode(action, [uint(action.args.newPrice, 256, 'args.newPrice')]);
    case 'position.repay':
      return encode(action, [uint(action.args.amount, 256, 'args.amount')]);
    case 'position.withdrawCollateral':
      return encode(action, [
        address(action.args.target, 'args.target'),
        uint(action.args.amount, 256, 'args.amount'),
      ]);
    case 'position.withdraw':
      return encode(action, [
        address(action.args.token, 'args.token'),
        address(action.args.target, 'args.target'),
        uint(action.args.amount, 256, 'args.amount'),
      ]);
    case 'position.transferOwnership':
      return encode(action, [address(action.args.newOwner, 'args.newOwner')]);
    case 'position.deny':
      return encode(action, [addresses(action.args.helpers, 'args.helpers'), text(action.args.message, 'args.message')]);
    case 'bridge.mintTo':
    case 'bridge.burnAndSend':
    case 'bridge.burnAndCredit':
      return encode(action, [
        address(action.args.target, 'args.target'),
        uint(action.args.amount, 256, 'args.amount'),
      ]);
    case 'bridge.payoutCredit':
      return encode(action, [address(action.args.target, 'args.target')]);
    case 'savings.save':
      return encode(action, [uint(action.args.amount, 192, 'args.amount')]);
    case 'savings.saveFor':
      return encode(action, [
        address(action.args.owner, 'args.owner'),
        uint(action.args.amount, 192, 'args.amount'),
      ]);
    case 'savings.withdraw':
      return encode(action, [
        address(action.args.target, 'args.target'),
        uint(action.args.amount, 192, 'args.amount'),
      ]);
    case 'savings.adjust':
      return encode(action, [uint(action.args.targetAmount, 192, 'args.targetAmount')]);
    case 'savings.refreshMyBalance':
    case 'savings.applyChange':
      return encode(action, []);
    case 'savings.refreshBalance':
      return encode(action, [address(action.args.owner, 'args.owner')]);
    case 'savings.proposeChange':
      return encode(action, [
        uint(action.args.newRatePPM, 24, 'args.newRatePPM'),
        addresses(action.args.helpers, 'args.helpers'),
      ]);
    case 'equity.invest':
      return encode(action, [
        uint(action.args.amount, 256, 'args.amount'),
        uint(action.args.expectedShares, 256, 'args.expectedShares'),
      ]);
    case 'equity.redeemExpected':
      return encode(action, [
        address(action.args.target, 'args.target'),
        uint(action.args.shares, 256, 'args.shares'),
        uint(action.args.expectedProceeds, 256, 'args.expectedProceeds'),
      ]);
    case 'equity.delegateVoteTo':
      return encode(action, [address(action.args.delegate, 'args.delegate', true)]);
    case 'equity.kamikaze':
      return encode(action, [
        addresses(action.args.targets, 'args.targets'),
        uint(action.args.votesToDestroy, 256, 'args.votesToDestroy'),
      ]);
    case 'equity.restructureCapTable':
      return encode(action, [
        addresses(action.args.helpers, 'args.helpers'),
        addresses(action.args.addressesToWipe, 'args.addressesToWipe'),
      ]);
    case 'roller.rollFully':
      return encode(action, [
        address(action.args.source, 'args.source'),
        address(action.args.targetPosition, 'args.targetPosition'),
      ]);
    case 'roller.rollFullyWithExpiration':
      return encode(action, [
        address(action.args.source, 'args.source'),
        address(action.args.targetPosition, 'args.targetPosition'),
        uint(action.args.expiration, 40, 'args.expiration'),
      ]);
    case 'roller.roll':
      return encode(action, [
        address(action.args.source, 'args.source'),
        uint(action.args.repay, 256, 'args.repay'),
        uint(action.args.collateralWithdraw, 256, 'args.collateralWithdraw'),
        address(action.args.targetPosition, 'args.targetPosition'),
        uint(action.args.mint, 256, 'args.mint'),
        uint(action.args.collateralDeposit, 256, 'args.collateralDeposit'),
        uint(action.args.expiration, 40, 'args.expiration'),
      ]);
    case 'token.suggestMinter':
      return encode(action, [
        address(action.args.minter, 'args.minter'),
        uint(action.args.applicationPeriod, 256, 'args.applicationPeriod'),
        uint(action.args.applicationFee, 256, 'args.applicationFee'),
        text(action.args.message, 'args.message'),
      ]);
    case 'token.denyMinter':
      return encode(action, [
        address(action.args.minter, 'args.minter'),
        addresses(action.args.helpers, 'args.helpers'),
        text(action.args.message, 'args.message'),
      ]);
    default:
      throw new TypeError(`Unsupported V2 operation ${String((action as { operation?: unknown }).operation)}`);
  }
}

function normalizeValue(param: ParamType, value: unknown): unknown {
  if (param.baseType === 'array') {
    if (!Array.isArray(value)) throw new TypeError(`Expected an array for ${param.name || param.type}`);
    const child = (param as ParamType & { arrayChildren: ParamType }).arrayChildren;
    return value.map((entry) => normalizeValue(child, entry));
  }
  if (param.type === 'address') return address(value, param.name || 'address', true);
  if (/^u?int[0-9]*$/.test(param.type)) {
    if (typeof value !== 'bigint') return BigInt(value as string | number);
    return value;
  }
  return value;
}

function normalizeArgs(inputs: readonly ParamType[], values: readonly unknown[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(inputs.map((input, index) => [
    input.name || `arg${index}`,
    normalizeValue(input, values[index]),
  ]));
}

export function decodeV2Action(transaction: { readonly to: string; readonly data: string }): V2DecodedAction {
  if (typeof transaction.data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(transaction.data) || transaction.data.length < 10) {
    throw new TypeError('data must be hex calldata with a four-byte selector');
  }
  const fragment = V2_ACTION_INTERFACE.getFunction(transaction.data.slice(0, 10));
  if (!fragment) throw new TypeError(`Unknown V2 action selector ${transaction.data.slice(0, 10)}`);
  const signature = fragment.format('sighash');
  const entry = Object.entries(V2_ACTION_METADATA).find(([, metadata]) => metadata.signature === signature);
  if (!entry) throw new TypeError(`No V2 operation registered for ${signature}`);
  const values = V2_ACTION_INTERFACE.decodeFunctionData(fragment, transaction.data);
  return {
    to: address(transaction.to, 'to'),
    data: transaction.data,
    operation: entry[0] as V2Operation,
    signature,
    args: normalizeArgs(fragment.inputs, values),
  };
}

export interface V2ReceiptLog {
  readonly address: string;
  readonly data: string;
  readonly topics: readonly string[];
  readonly logIndex?: number | null;
  readonly transactionHash?: string | null;
  readonly blockNumber?: number | null;
}

export interface V2Receipt {
  readonly logs: readonly V2ReceiptLog[];
  readonly transactionHash?: string | null;
  readonly blockNumber?: number | null;
}

export interface V2DecodedEvent {
  readonly name: string;
  readonly signature: string;
  readonly emitter: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly index?: bigint;
  readonly logIndex: number | null;
  readonly transactionHash: string | null;
  readonly blockNumber: number | null;
}

function eventFragment(fragment: EventFragment): string {
  return fragment.format('sighash');
}

export function decodeV2Event(log: V2ReceiptLog, expectedEmitter?: string): V2DecodedEvent {
  const emitter = address(log.address, 'log.address');
  if (expectedEmitter !== undefined) {
    const expected = address(expectedEmitter, 'expectedEmitter');
    if (emitter !== expected) throw new Error(`Event emitter ${emitter} does not match ${expected}`);
  }
  if (!Array.isArray(log.topics) || log.topics.length === 0) throw new TypeError('Event log has no signature topic');
  const fragment = V2_ACTION_INTERFACE.getEvent(log.topics[0]);
  if (!fragment) throw new TypeError(`Unknown V2 event topic ${log.topics[0]}`);
  const values = V2_ACTION_INTERFACE.decodeEventLog(fragment, log.data, log.topics);
  const args = normalizeArgs(fragment.inputs, values);
  const signature = eventFragment(fragment);
  return {
    name: fragment.name,
    signature,
    emitter,
    args,
    ...(fragment.name === 'ChallengeStarted' ? { index: args.number as bigint } : {}),
    logIndex: typeof log.logIndex === 'number' ? log.logIndex : null,
    transactionHash: typeof log.transactionHash === 'string' ? log.transactionHash : null,
    blockNumber: typeof log.blockNumber === 'number' ? log.blockNumber : null,
  };
}

export function decodeV2Receipt(
  receipt: V2Receipt,
  sources: { readonly mintingHub?: string } = {},
): readonly V2DecodedEvent[] {
  const mintingHub = sources.mintingHub === undefined ? undefined : address(sources.mintingHub, 'sources.mintingHub');
  const decoded: V2DecodedEvent[] = [];
  for (const log of receipt.logs) {
    if (!Array.isArray(log.topics) || log.topics.length === 0 || !V2_ACTION_INTERFACE.getEvent(log.topics[0])) continue;
    const fragment = V2_ACTION_INTERFACE.getEvent(log.topics[0])!;
    const guarded = fragment.name === 'PositionOpened' || fragment.name === 'ChallengeStarted';
    if (guarded && mintingHub === undefined) {
      throw new Error(`${fragment.name} requires sources.mintingHub for emitter validation`);
    }
    const event = decodeV2Event(log, guarded ? mintingHub : undefined);
    decoded.push({
      ...event,
      transactionHash: event.transactionHash ?? (typeof receipt.transactionHash === 'string' ? receipt.transactionHash : null),
      blockNumber: event.blockNumber ?? (typeof receipt.blockNumber === 'number' ? receipt.blockNumber : null),
    });
  }
  return decoded;
}

function requiredReceiptEvent(
  receipt: V2Receipt,
  mintingHub: string,
  name: 'PositionOpened' | 'ChallengeStarted',
): V2DecodedEvent {
  const matches = decodeV2Receipt(receipt, { mintingHub }).filter((event) => event.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${name} event, found ${matches.length}`);
  return matches[0];
}

export function decodePositionOpened(receipt: V2Receipt, mintingHub: string): V2DecodedEvent {
  return requiredReceiptEvent(receipt, mintingHub, 'PositionOpened');
}

export function decodeChallengeStarted(receipt: V2Receipt, mintingHub: string): V2DecodedEvent {
  return requiredReceiptEvent(receipt, mintingHub, 'ChallengeStarted');
}
