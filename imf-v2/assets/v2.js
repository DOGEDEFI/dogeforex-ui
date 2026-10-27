(() => {
  'use strict';
  const sdk = window.IMF_V2;
  const planning = window.IMF_PLANNING;
  const $ = (selector) => document.querySelector(selector);
  const form = $('#v2-position-form');
  const state = {
    runtime: null,
    rawRegistry: null,
    registry: null,
    provider: null,
    rpcUrl: null,
    source: null,
    fixture: false,
    clients: new Map(),
    verifying: new Map(),
    verified: new Map(),
    verificationErrors: new Map(),
    currentRead: null,
    lastPlan: null,
    manage: null,
    ecosystem: {},
    nonce: 0,
    manageNonce: 0,
    ecosystemNonce: 0,
  };
  let hooks;

  function json(value) {
    return JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry, 2);
  }

  function serializable(value) {
    return JSON.parse(JSON.stringify(value, (_, entry) => typeof entry === 'bigint' ? entry.toString() : entry));
  }

  function errorMessage(cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return (state.rpcUrl ? message.split(state.rpcUrl).join('<rpc>') : message).slice(0, 700);
  }

  function formError(message = '') {
    const target = $('#v2-form-error');
    target.textContent = message;
    target.hidden = !message;
    if (message) {
      target.setAttribute('tabindex', '-1');
      target.focus();
    }
  }

  function connectionError(message = '') {
    const target = $('#connection-error');
    target.textContent = message;
    target.hidden = !message;
  }

  function address(value, label, optional = false) {
    const candidate = value.trim();
    if (!candidate && optional) return null;
    let normalized;
    try {
      normalized = sdk.getAddress(candidate);
    } catch {
      throw new Error(`${label} must be a valid 20-byte address`);
    }
    if (normalized === sdk.ZeroAddress) throw new Error(`${label} cannot be the zero address`);
    return normalized;
  }

  function uint(value, label) {
    try {
      return sdk.parseDecimal(value.trim(), 0);
    } catch (cause) {
      throw new Error(`${label}: ${errorMessage(cause)}`);
    }
  }

  function amount(value, decimals, label) {
    try {
      return sdk.parseDecimal(value.trim(), decimals);
    } catch (cause) {
      throw new Error(`${label}: ${errorMessage(cause)}`);
    }
  }

  function money(raw, decimals = 18) {
    return sdk.formatDecimal(BigInt(raw), decimals);
  }

  function ppm(raw) {
    return `${sdk.formatPPM(BigInt(raw))}%`;
  }

  function timestamp(raw) {
    const seconds = BigInt(raw);
    if (seconds === 0n) return 'Not set';
    return `${new Date(Number(seconds) * 1000).toISOString()} (${seconds.toString()} seconds)`;
  }

  function block(snapshot) {
    const source = snapshot?.sourceBlock;
    return source ? `block ${source.number} · ${new Date(Number(source.timestamp) * 1000).toISOString()} · ${source.hash}` : 'No source block';
  }

  function freshness(snapshot) {
    if (state.fixture) return { code: 'SYNTHETIC_FIXTURE', status: 'unknown', reason: 'Synthetic fixture reads only; no deployed V2 state is represented.' };
    const source = snapshot.sourceBlock;
    const age = Date.now() - Number(source.timestamp) * 1000;
    if (age > 300000) return { code: 'SOURCE_STALE', status: 'unknown', reason: `Source block ${source.number} is more than five minutes old at observation; refresh before relying on it.` };
    if (age < -300000) return { code: 'BLOCK_CLOCK_MISMATCH', status: 'unknown', reason: 'Source block timestamp is materially ahead of this browser clock. Check the chain and local time.' };
    return { code: 'SOURCE_BLOCK', status: 'pass', reason: `Read at ${block(snapshot)}. This is a block-time read, not a transaction simulation.` };
  }

  function metrics(target, rows) {
    const container = typeof target === 'string' ? $(target) : target;
    container.replaceChildren();
    for (const [label, rawValue] of rows) {
      const row = document.createElement('div');
      row.className = 'metric';
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('strong');
      value.textContent = rawValue === null || rawValue === undefined ? 'Unknown (read or account required)' : typeof rawValue === 'boolean' ? rawValue ? 'Yes' : 'No' : String(rawValue);
      row.append(name, value);
      container.append(row);
    }
  }

  function checks(target, entries) {
    const list = typeof target === 'string' ? $(target) : target;
    list.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement('li');
      item.dataset.state = entry.status;
      item.textContent = entry.reason;
      list.append(item);
    }
  }

  function eligibility(entries) {
    if (entries.some((entry) => entry.status === 'fail')) return false;
    if (entries.some((entry) => entry.status === 'unknown')) return null;
    return true;
  }

  function check(code, status, reason) {
    return { code, status: status === null ? 'unknown' : status ? 'pass' : 'fail', reason };
  }

  function resultText(target, message, isError = false) {
    const container = typeof target === 'string' ? $(target) : target;
    container.replaceChildren();
    const paragraph = document.createElement('p');
    if (isError) paragraph.className = 'error';
    paragraph.textContent = message;
    container.append(paragraph);
  }

  function field(name) {
    const input = form.elements.namedItem(name);
    if (!input) throw new Error(`Missing form field ${name}`);
    return input;
  }

  function action() {
    return form.querySelector('input[name="action"]:checked').value;
  }

  function amountInput(value, decimals) {
    return { decimal: value.trim(), decimals: String(decimals), raw: amount(value, decimals, 'amount').toString() };
  }

  function expirationInput() {
    const local = field('cloneExpiration').value;
    const milliseconds = new Date(local).getTime();
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds % 1000 !== 0) throw new Error('Child expiration must be a valid whole-second timestamp');
    return { local, unix: BigInt(milliseconds / 1000).toString(), browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local' };
  }

  function inputModel() {
    const kind = action();
    const common = { project: field('project').value.trim(), currency: field('currency').value, account: field('account').value.trim() ? address(field('account').value, 'Account') : '' };
    if (kind === 'new') {
      const decimals = Number(uint(field('collateralDecimals').value, 'Collateral decimals'));
      if (!Number.isSafeInteger(decimals) || decimals > 24) throw new Error('Collateral decimals must be an integer from 0 through 24');
      return {
        ...common,
        token: { address: field('token').value.trim() ? address(field('token').value, 'Collateral token') : '', decimals: String(decimals) },
        minimumCollateral: amountInput(field('minimumCollateral').value, decimals),
        initialCollateral: amountInput(field('collateral').value, decimals),
        mintingMaximum: amountInput(field('mintingMaximum').value, 18),
        initPeriodSeconds: uint(field('initPeriodSeconds').value, 'Initialization').toString(),
        durationSeconds: uint(field('durationSeconds').value, 'Duration').toString(),
        challengePeriodSeconds: uint(field('challengePeriodSeconds').value, 'Challenge period').toString(),
        riskPremiumPPM: uint(field('riskPremiumPPM').value, 'Risk premium').toString(),
        reserveContributionPPM: uint(field('reservePPM').value, 'Reserve contribution').toString(),
        liquidationPrice: { decimal: field('liquidationPrice').value.trim(), decimals: String(sdk.priceDecimals(decimals)), raw: sdk.parseLiquidationPrice(field('liquidationPrice').value.trim(), decimals).toString() },
        plannedGrossMint: amountInput(field('gross').value, 18),
      };
    }
    if (kind === 'clone') {
      return {
        ...common,
        parent: field('parent').value.trim() ? address(field('parent').value, 'Parent position') : '',
        initialCollateral: { decimal: field('cloneCollateral').value.trim(), decimals: null, raw: null },
        initialMint: amountInput(field('cloneGross').value, 18),
        expiration: expirationInput(),
        childOwner: field('cloneOwner').value.trim() ? address(field('cloneOwner').value, 'Child owner') : common.account,
      };
    }
    return {
      ...common,
      position: field('position').value.trim() ? address(field('position').value, 'Position') : '',
      grossMint: amountInput(field('mintGross').value, 18),
      recipient: field('recipient').value.trim() ? address(field('recipient').value, 'Recipient') : common.account,
    };
  }

  function signature(kind, inputs) {
    return JSON.stringify({ action: kind, inputs });
  }

  function registryEvidence(code) {
    if (!state.registry) return { status: 'unconfigured' };
    const instance = state.registry.instances[code];
    if (state.fixture) return { status: 'fixture', network: state.registry.network, chainId: String(state.registry.chainId), source: 'synthetic-fixture', addresses: instance?.addresses };
    if (!state.verified.get(code)) return { status: 'unverified', network: state.registry.network, chainId: String(state.registry.chainId), error: state.verificationErrors.get(code) || 'Currency has not been verified' };
    return {
      status: 'verified-read',
      network: state.registry.network,
      chainId: String(state.registry.chainId),
      source: state.source,
      addresses: instance.addresses,
      sourceEvidence: Object.fromEntries(['address', 'onchainDecimals', 'decimalMultiplier', 'symbol', 'isTest', 'fundingMode'].filter((key) => ['string', 'boolean'].includes(typeof instance.sourceEvidence[key])).map((key) => [key, instance.sourceEvidence[key]])),
      rateEvidence: 'Retained in the verified registry by the SDK; current quotes use current on-chain leadrate reads',
      deploymentPostconditionsAreNotCurrentState: true,
    };
  }

  function getPlan() {
    const kind = action();
    const inputs = state.currentRead?.inputs ?? inputModel();
    const current = state.currentRead?.signature === signature(kind, inputs) ? state.currentRead : null;
    const plan = {
      schema: 'imf.v2-read-plan.v1',
      status: current && !state.fixture && state.verified.get(inputs.currency) && current.quote ? 'read-backed-plan' : 'local-read-plan',
      executionEnabled: false,
      simulationStatus: 'not-run',
      signatureStatus: 'not-requested',
      action: kind,
      project: inputs.project,
      currency: inputs.currency,
      chainId: state.registry ? String(state.registry.chainId) : null,
      inputs,
      evidence: {
        registry: registryEvidence(inputs.currency),
        state: current ? serializable(current.snapshot) : null,
        quote: current?.quote ? serializable(current.quote) : null,
        checks: current ? serializable(current.checks) : [],
        readOnlyBoundary: 'Read-derived planning only. No transaction simulation, signing or authorization.',
      },
    };
    state.lastPlan = planning.validateV2Plan(plan);
    return state.lastPlan;
  }

  function updateConnection() {
    const count = [...state.verified.values()].filter(Boolean).length;
    let message = 'V2 registry not configured';
    let notice = 'Read-only V2 preview · No verified deployment registry configured · No simulation, signing or transaction execution';
    if (state.fixture && state.registry) {
      message = `SYNTHETIC V2 FIXTURE · ${count} read model${count === 1 ? '' : 's'}`;
      notice = 'SYNTHETIC V2 FIXTURE · Not deployed or live state · Isolated test wallet only · No live transactions';
    } else if (state.registry) {
      const writes = state.runtime?.mode === 'testnet-metamask' && state.source === 'runtime-config';
      message = count ? writes ? `DogeOS testnet · ${count} verified currenc${count === 1 ? 'y' : 'ies'}` : `V2 read-only · ${count} verified currenc${count === 1 ? 'y' : 'ies'}` : 'V2 registry unverified';
      notice = writes ? 'DogeOS Chikyū testnet · Explicit wallet-confirmed transactions · tUSDC test asset · No production readiness claimed' : 'Read-only V2 registry state · Imported registries and custom RPC cannot authorize transactions';
    }
    $('#sidebar-connection').textContent = message;
    $('#release-notice').textContent = notice;
    $('#connection-status').textContent = message;
    hooks.onRegistry?.();
  }

  function renderRegistry() {
    updateConnection();
    const rows = state.registry ? [
      ['Protocol generation', state.registry.protocolGeneration],
      ['Network', state.registry.network],
      ['Chain ID', state.registry.chainId.toString()],
      ['Registry currencies', state.registry.codes.join(', ')],
      ['Verified read models', [...state.verified.entries()].filter(([, valid]) => valid).map(([code]) => code).join(', ') || 'None'],
      ['Transaction policy', state.fixture ? 'Synthetic test wallet only' : state.runtime?.mode === 'testnet-metamask' && state.source === 'runtime-config' ? 'Explicit DogeOS testnet wallet transactions' : 'Read-only'],
    ] : [['Status', 'No V2 registry configured'], ['V1 substitution', 'Not permitted']];
    for (const [code, message] of state.verificationErrors) rows.push([`${code} verification`, message]);
    metrics('#registry-summary', rows);
    if (state.fixture && state.registry) {
      const label = document.createElement('label');
      label.className = 'field';
      label.textContent = 'Fixture scenario';
      const select = document.createElement('select');
      select.id = 'fixture-scenario';
      for (const scenario of ['valid', 'wrong-chain', 'missing-code', 'rpc-error', 'no-votes', 'cooldown', 'expired', 'challenged', 'zero-balance']) {
        const option = document.createElement('option');
        option.value = scenario;
        option.textContent = scenario;
        select.append(option);
      }
      select.value = sdk.fixtureControls.scenario;
      select.addEventListener('change', async () => {
        try {
          sdk.fixtureControls.setScenario(select.value);
          await connect(state.rawRegistry, 'fixture://v2', 'fixture');
          hooks.notify(`Fixture scenario changed to ${select.value}. No network or transaction was used.`);
        } catch (cause) {
          connectionError(errorMessage(cause));
        }
      });
      label.htmlFor = select.id;
      label.append(select);
      $('#registry-summary').append(label);
    }
  }

  function requireSdk() {
    if (!sdk?.createV2Client) throw new Error('The V2 browser SDK did not load. Offline documentation and teaching remain available; live reads are unavailable.');
  }

  async function clientFor(code) {
    requireSdk();
    if (!state.registry || !state.provider) throw new Error('Configure and verify a V2 registry before reading');
    if (state.verified.get(code)) return state.clients.get(code);
    if (state.verifying.has(code)) return state.verifying.get(code);
    const registry = state.registry;
    const provider = state.provider;
    const instance = registry.instances[code];
    if (!instance) throw new Error(`The supplied V2 registry has no ${code} instance; available: ${registry.codes.join(', ')}`);
    const client = sdk.createV2Client(instance, provider);
    const promise = client.verify().then(() => {
      if (state.registry !== registry || state.provider !== provider) throw new Error('Verification was superseded by a newer connection');
      state.clients.set(code, client);
      state.verified.set(code, true);
      state.verificationErrors.delete(code);
      renderRegistry();
      return client;
    }).catch((cause) => {
      if (state.registry !== registry || state.provider !== provider) throw cause;
      state.verified.set(code, false);
      state.verificationErrors.set(code, errorMessage(cause));
      renderRegistry();
      throw cause;
    }).finally(() => {
      if (state.verifying.get(code) === promise) state.verifying.delete(code);
    });
    state.verifying.set(code, promise);
    return promise;
  }

  function rpcUrl(value) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('RPC URL must use HTTP(S)');
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('RPC URL must use HTTPS outside localhost');
    if (url.username || url.password || url.search || url.hash) throw new Error('RPC URL must not contain credentials, query or hash');
    return url.href;
  }

  async function connect(raw, rpc, source) {
    requireSdk();
    const nonce = ++state.nonce;
    state.registry = null;
    state.provider = null;
    state.rawRegistry = null;
    state.source = null;
    state.rpcUrl = null;
    state.fixture = false;
    state.manage = null;
    state.ecosystem = {};
    state.verifying.clear();
    state.verified.clear();
    state.verificationErrors.clear();
    state.clients.clear();
    state.currentRead = null;
    state.lastPlan = null;
    connectionError();
    let registry;
    try {
      registry = sdk.parseV2Registry(raw);
    } catch (cause) {
      connectionError(errorMessage(cause));
      renderRegistry();
      return;
    }
    state.registry = registry;
    state.rawRegistry = raw;
    state.source = source;
    state.fixture = source === 'fixture';
    try {
      state.rpcUrl = state.fixture ? 'fixture://v2' : rpcUrl(rpc);
      const scenario = state.fixture ? sdk.fixtureControls?.scenario : null;
      state.provider = state.fixture ? sdk.createFixtureProvider() : new sdk.JsonRpcProvider(state.rpcUrl, registry.chainId, { staticNetwork: true });
      if (state.fixture && scenario && scenario !== 'valid') sdk.fixtureControls.setScenario(scenario);
      renderRegistry();
      for (const code of registry.codes) {
        try {
          await clientFor(code);
        } catch (cause) {
          state.verificationErrors.set(code, errorMessage(cause));
        }
        if (nonce !== state.nonce) return;
      }
      if (![...state.verified.values()].some(Boolean)) throw new Error('No V2 currency could be verified against the selected chain and contract links');
      const selected = field('currency').value;
      if (!state.verified.get(selected)) {
        const available = registry.codes.find((code) => state.verified.get(code));
        if (available) field('currency').value = available;
      }
      renderRegistry();
      invalidate();
      hooks.notify(state.fixture ? 'Synthetic V2 fixture connected. These are not live contracts or operational quotes.' : state.runtime?.mode === 'testnet-metamask' && state.source === 'runtime-config' ? 'DogeOS testnet registry verified. Connect MetaMask to prepare explicit transactions; no wallet prompt has been requested.' : 'V2 registry verified for read-only inspection. Local registries and custom RPC cannot authorize transactions.');
    } catch (cause) {
      state.provider = null;
      connectionError(errorMessage(cause));
      renderRegistry();
    }
  }

  function disconnect() {
    state.nonce += 1;
    state.manageNonce += 1;
    state.ecosystemNonce += 1;
    state.registry = null;
    state.rawRegistry = null;
    state.provider = null;
    state.source = null;
    state.rpcUrl = null;
    state.fixture = false;
    state.clients.clear();
    state.verifying.clear();
    state.verified.clear();
    state.verificationErrors.clear();
    state.currentRead = null;
    state.lastPlan = null;
    state.manage = null;
    state.ecosystem = {};
    renderRegistry();
    invalidate();
    $('#manage-state').replaceChildren();
    $('#manage-unavailable').textContent = 'Configure a verified V2 registry before reading position state.';
    for (const selector of ['#bridge-state', '#savings-state', '#equity-state', '#governance-state', '#bridge-quote', '#equity-quote', '#repayment-result', '#withdrawal-result', '#expiry-result']) $(selector).replaceChildren();
    hooks.notify('Disconnected. Registry and read evidence were cleared; local drafts were not deleted.');
  }

  function invalidate() {
    state.currentRead = null;
    state.lastPlan = null;
    $('#v2-quote-kind').textContent = 'Read-backed quote unavailable';
    $('#v2-net').textContent = state.registry ? 'Read required' : 'Connect verified V2 state';
    for (const selector of ['#v2-gross-out', '#v2-reserve-out', '#v2-fee-out']) $(selector).textContent = '—';
    $('#v2-quote-meta').textContent = state.registry ? 'Read current state to calculate an exact quote. No state is inferred from deployment metadata.' : 'Offline inputs can be normalized, but no current leadrate, eligibility or quote is assumed.';
    checks('#v2-eligibility', [{ status: 'unknown', reason: state.registry ? 'Current read required; a verified registry alone does not prove action eligibility.' : 'No verified V2 registry or current position state.' }]);
    try {
      const kind = action();
      $('#v2-raw-preview').textContent = json({ action: kind, chainId: state.registry?.chainId ?? null, inputs: inputModel() });
    } catch (cause) {
      $('#v2-raw-preview').textContent = json({ error: errorMessage(cause) });
    }
    hooks.onPlan();
  }

  async function refresh() {
    const create = Boolean(state.currentRead);
    const manage = Boolean(state.manage);
    const ecosystem = Boolean(state.ecosystem.client);
    state.manageNonce += 1;
    state.ecosystemNonce += 1;
    state.manage = null;
    state.ecosystem = {};
    invalidate();
    const pending = [];
    if (create && form.reportValidity()) pending.push(readAction());
    if (manage && $('#manage-load-form').reportValidity()) pending.push(readManage());
    if (ecosystem && $('#ecosystem-load-form').reportValidity()) pending.push(readEcosystem());
    const results = await Promise.allSettled(pending);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) hooks.notify(`Confirmed, but a follow-up read failed: ${errorMessage(failed.reason)}`, true);
  }

  function setAction() {
    const kind = action();
    for (const name of ['new', 'clone', 'mint']) {
      $(`#${name}-fields`).hidden = name !== kind;
      document.querySelectorAll(`[data-required-action="${name}"]`).forEach((input) => {
        input.required = name === kind;
        input.disabled = name !== kind;
      });
    }
    invalidate();
  }

  function requireAccount() {
    const account = field('account').value.trim();
    if (!account) throw new Error('Enter a public account address for funding and caller-specific checks');
    return address(account, 'Account');
  }

  function newParams(decimals, caller, collateral) {
    return {
      caller,
      collateral,
      minCollateral: amount(field('minimumCollateral').value, decimals, 'Minimum collateral'),
      initialCollateral: amount(field('collateral').value, decimals, 'Initial collateral'),
      mintingMaximum: amount(field('mintingMaximum').value, 18, 'Minting maximum'),
      initPeriodSeconds: uint(field('initPeriodSeconds').value, 'Initialization'),
      durationSeconds: uint(field('durationSeconds').value, 'Duration'),
      challengePeriodSeconds: uint(field('challengePeriodSeconds').value, 'Challenge period'),
      riskPremiumPPM: uint(field('riskPremiumPPM').value, 'Risk premium'),
      liquidationPrice: sdk.parseLiquidationPrice(field('liquidationPrice').value.trim(), decimals),
      reserveContributionPPM: uint(field('reservePPM').value, 'Reserve contribution'),
      plannedMintAmount: amount(field('gross').value, 18, 'Planned gross mint'),
    };
  }

  function displayQuote(quote, symbol) {
    if (!quote || quote.expired || quote.feePPM === null || quote.usableAmount === null) {
      $('#v2-net').textContent = quote?.expired ? 'Unavailable: expired' : 'Unavailable: check terms';
      $('#v2-reserve-out').textContent = quote ? ppm(quote.reservePPM) : '—';
      $('#v2-fee-out').textContent = 'Unavailable';
      return;
    }
    $('#v2-net').textContent = `${money(quote.usableAmount)} ${symbol}`;
    $('#v2-reserve-out').textContent = `${ppm(quote.reservePPM)} (parameter)`;
    $('#v2-fee-out').textContent = `${ppm(quote.feePPM)} (calculated)`;
  }

  function recordRead(kind, inputs, snapshot, quote, entries, meta, label) {
    const fresh = freshness(snapshot);
    const all = [...entries, fresh];
    const eligible = eligibility(entries);
    state.currentRead = { signature: signature(kind, inputs), inputs, snapshot, quote, checks: all, eligible };
    const symbol = state.registry?.instances[inputs.currency]?.symbol ?? `${state.registry?.instances[inputs.currency]?.symbol ?? `K9${inputs.currency}`}`;
    displayQuote(quote, symbol);
    $('#v2-gross-out').textContent = quote?.grossAmount !== null && quote?.grossAmount !== undefined ? `${money(quote.grossAmount)} ${symbol}` : '—';
    $('#v2-quote-kind').textContent = state.fixture ? `FIXTURE · ${label}` : label;
    $('#v2-quote-meta').textContent = `${meta} ${block(snapshot)}. Net proceeds use the combined integer allocation; percentage parameters are not independently rounded cash components.`;
    checks('#v2-eligibility', [
      { status: eligible === null ? 'unknown' : eligible ? 'pass' : 'fail', reason: eligible === null ? 'Some read checks are unknown. They cannot establish eligibility.' : eligible ? 'The listed read checks pass at this source block; this is not a simulation or authorization.' : 'At least one read check fails. Review each reason before any separately authorized operation.' },
      ...all,
    ]);
    getPlan();
    hooks.onPlan();
  }

  async function readAction() {
    formError();
    if (!form.reportValidity()) return null;
    const kind = action();
    const nonce = ++state.nonce;
    const button = kind === 'clone' ? $('#read-parent') : kind === 'mint' ? $('#read-position') : $('#review-v2-plan');
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      const client = await clientFor(field('currency').value);
      const caller = requireAccount();
      if (kind === 'new') {
        const collateral = address(field('token').value, 'Collateral token');
        const hint = Number(uint(field('collateralDecimals').value, 'Collateral decimals'));
        let snapshot = await client.newPositionSnapshot(newParams(hint, caller, collateral));
        if (snapshot.terms.collateralDecimals !== hint) {
          field('collateralDecimals').value = String(snapshot.terms.collateralDecimals);
          snapshot = await client.newPositionSnapshot(newParams(snapshot.terms.collateralDecimals, caller, collateral));
        }
        if (nonce !== state.nonce) return null;
        const inputs = inputModel();
        const entries = snapshot.issues.map((issue) => check(issue, false, `Opening terms: ${issue}`));
        const plannedGross = snapshot.illustrativeMintQuote?.grossAmount ?? 0n;
        entries.push(
          check('OPENING_FEE_FUNDED', snapshot.funding.openingFeeFunded, `Account must already hold ${money(snapshot.funding.openingFee)} ${state.registry?.instances[inputs.currency]?.symbol ?? `K9${inputs.currency}`} for the separate irrevocable opening fee; future mint proceeds cannot pay it.`),
          check('COLLATERAL_FUNDED', snapshot.funding.collateralFunded, `Account must hold the initial ${money(snapshot.terms.initialCollateral, snapshot.terms.collateralDecimals)} ${snapshot.collateralSymbol} collateral.`),
          check('COLLATERAL_APPROVED', snapshot.funding.collateralApproved, 'Collateral allowance must be granted to the MintingHub for the initial collateral; no generic local-currency approval is inferred.'),
          check('PLANNED_MINT_POSITIVE', plannedGross > 0n, 'A useful planned mint must be greater than zero.'),
          check('PLANNED_MINT_CAPACITY', snapshot.illustrativeMintQuote !== null && plannedGross <= snapshot.terms.mintingMaximum, 'Planned gross mint must fit the proposed minting maximum.'),
          check('PLANNED_MINT_BACKING', snapshot.illustrativeMintQuote !== null && snapshot.terms.initialCollateral * snapshot.terms.liquidationPrice <= sdk.UINT256_MAX && plannedGross * 10n ** 18n <= sdk.UINT256_MAX && snapshot.terms.initialCollateral * snapshot.terms.liquidationPrice >= plannedGross * 10n ** 18n, 'Initial collateral at the proposed price must back the planned gross mint without uint256 overflow; this is separate from opening bounds.'),
          check('PLANNED_MINT_USABLE', snapshot.illustrativeMintQuote !== null && snapshot.illustrativeMintQuote.usableAmount > 0n, 'Reserve + fee must leave positive usable proceeds after integer truncation.'),
        );
        const meta = `Pre-opening estimate: current leadrate + proposed risk = ${ppm(snapshot.annualInterestPPM)}; assumed start ${timestamp(snapshot.assumedStart)}; assumed expiration ${timestamp(snapshot.assumedExpiration)}; opening fee ${money(snapshot.funding.openingFee)} ${state.registry.instances[inputs.currency].symbol}. Requote after initialization and any rate change.`;
        recordRead(kind, inputs, snapshot, snapshot.illustrativeMintQuote, entries, meta, 'Pre-opening estimate');
        return snapshot;
      }
      if (kind === 'clone') {
        const parentAddress = address(field('parent').value, 'Parent position');
        const parent = await client.positionState(parentAddress);
        const expiration = expirationInput();
        const params = {
          parent: parentAddress,
          collateralFunder: caller,
          childOwner: field('cloneOwner').value.trim() ? address(field('cloneOwner').value, 'Child owner') : caller,
          initialCollateral: amount(field('cloneCollateral').value, parent.collateral.decimals, 'Initial collateral'),
          initialMint: amount(field('cloneGross').value, 18, 'Initial gross mint'),
          expiration: BigInt(expiration.unix),
        };
        const snapshot = await client.cloneSnapshot(params);
        if (nonce !== state.nonce) return null;
        const inputs = inputModel();
        inputs.initialCollateral = { decimal: field('cloneCollateral').value.trim(), decimals: String(parent.collateral.decimals), raw: params.initialCollateral.toString() };
        const meta = `Parent ${parentAddress}; child owner ${params.childOwner}; absolute expiration ${timestamp(snapshot.expiration)}; original expiration ${timestamp(snapshot.originalExpiration)}; collateral allowance must be to the hub. No new-proposal opening fee.`;
        recordRead(kind, inputs, snapshot, snapshot.quote, snapshot.checks, meta, 'Clone read quote');
        return snapshot;
      }
      const positionAddress = address(field('position').value, 'Position');
      const snapshot = await client.positionSnapshot(positionAddress, {
        caller,
        recipient: field('recipient').value.trim() ? address(field('recipient').value, 'Recipient') : caller,
        quote: { grossAmount: amount(field('mintGross').value, 18, 'Gross mint') },
      });
      if (nonce !== state.nonce) return null;
      const inputs = inputModel();
      const meta = `Position ${positionAddress}; collateral ${snapshot.collateral.symbol} (${snapshot.collateral.decimals} decimals); stored price ${money(snapshot.price, snapshot.priceDecimals)}; available family capacity ${money(snapshot.availableForMinting)} ${state.registry?.instances[inputs.currency]?.symbol ?? `K9${inputs.currency}`}; expiration ${timestamp(snapshot.expiration)}.`;
      recordRead(kind, inputs, snapshot, snapshot.quote, snapshot.checks, meta, 'Existing-position read quote');
      return snapshot;
    } catch (cause) {
      if (nonce === state.nonce) formError(errorMessage(cause));
      return null;
    } finally {
      button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  }

  function loadPlan(plan) {
    try {
      const clean = planning.validateV2Plan(plan);
      const inputs = clean.inputs;
      if (inputs.account) address(inputs.account, 'Account');
      if (clean.action === 'new') address(inputs.token.address, 'Collateral token');
      if (clean.action === 'clone') {
        address(inputs.parent, 'Parent position');
        if (inputs.childOwner) address(inputs.childOwner, 'Child owner');
        const milliseconds = new Date(inputs.expiration.local).getTime();
        if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0 || BigInt(milliseconds / 1000) !== BigInt(inputs.expiration.unix)) throw new Error('Clone expiration does not match its recorded absolute timestamp; edit it explicitly rather than accepting a timezone conversion');
      } else if (clean.action === 'mint') {
        address(inputs.position, 'Position');
        if (inputs.recipient) address(inputs.recipient, 'Recipient');
      }
      form.querySelector(`input[name="action"][value="${clean.action}"]`).checked = true;
      setAction();
      field('project').value = clean.project;
      field('currency').value = clean.currency;
      field('account').value = inputs.account ? address(inputs.account, 'Account') : '';
      if (clean.action === 'new') {
        field('token').value = address(inputs.token.address, 'Collateral token');
        field('collateralDecimals').value = inputs.token.decimals;
        for (const [name, key] of [['minimumCollateral', 'minimumCollateral'], ['collateral', 'initialCollateral'], ['mintingMaximum', 'mintingMaximum'], ['gross', 'plannedGrossMint']]) field(name).value = inputs[key].decimal;
        for (const name of ['initPeriodSeconds', 'durationSeconds', 'challengePeriodSeconds', 'riskPremiumPPM']) field(name).value = inputs[name];
        field('reservePPM').value = inputs.reserveContributionPPM;
        field('liquidationPrice').value = inputs.liquidationPrice.decimal;
      } else if (clean.action === 'clone') {
        field('parent').value = address(inputs.parent, 'Parent position');
        field('cloneCollateral').value = inputs.initialCollateral.decimal;
        field('cloneGross').value = inputs.initialMint.decimal;
        field('cloneExpiration').value = inputs.expiration.local;
        field('cloneOwner').value = inputs.childOwner === inputs.account ? '' : inputs.childOwner;
      } else {
        field('position').value = address(inputs.position, 'Position');
        field('mintGross').value = inputs.grossMint.decimal;
        field('recipient').value = inputs.recipient === inputs.account ? '' : inputs.recipient;
      }
      invalidate();
      hooks.onView('create');
      hooks.notify('Local V2 inputs loaded. Imported registry, quote and eligibility claims were not accepted; read current state again.');
      return true;
    } catch (cause) {
      formError(`Plan could not be loaded: ${errorMessage(cause)}`);
      return false;
    }
  }


  function manageFormValues() {
    const manageForm = $('#manage-load-form');
    return {
      position: manageForm.elements.namedItem('managePosition').value.trim(),
      account: manageForm.elements.namedItem('manageAccount').value.trim(),
    };
  }

  function withAccount(options, account) {
    return account ? { ...options, account } : options;
  }

  function withCaller(options, caller) {
    return caller ? { ...options, caller } : options;
  }

  function renderPosition(snapshot) {
    metrics('#manage-state', [
      ['Source block', block(snapshot)],
      ['Owner', snapshot.owner],
      ['Hub roller', snapshot.roller],
      ['Original position', snapshot.original],
      ['Collateral', `${snapshot.collateral.symbol} · ${snapshot.collateral.decimals} decimals`],
      ['Collateral balance', `${money(snapshot.collateral.balance, snapshot.collateral.decimals)} ${snapshot.collateral.symbol}`],
      ['Minimum collateral', `${money(snapshot.minimumCollateral, snapshot.collateral.decimals)} ${snapshot.collateral.symbol}`],
      ['Gross minted debt', `${money(snapshot.minted)} ${state.registry?.instances[field('currency').value]?.symbol ?? `K9${field('currency').value}`}`],
      ['Family minting capacity', money(snapshot.availableForMinting)],
      ['Clone capacity', money(snapshot.availableForClones)],
      ['Stored liquidation price', money(snapshot.price, snapshot.priceDecimals)],
      ['Reserve contribution', ppm(snapshot.reserveContributionPPM)],
      ['Annual interest', ppm(snapshot.annualInterestPPM)],
      ['Start / veto deadline', timestamp(snapshot.start)],
      ['Cooldown ends', timestamp(snapshot.cooldown)],
      ['Expiration', timestamp(snapshot.expiration)],
      ['Challenged collateral', `${money(snapshot.challengedAmount, snapshot.collateral.decimals)} ${snapshot.collateral.symbol}`],
      ['Closed', snapshot.closed],
      ['Expired', snapshot.expired],
    ]);
    resultText('#expiry-result', `Expired-purchase price at ${block(snapshot)}: ${money(snapshot.expiredPurchasePrice, snapshot.priceDecimals)}. This is not the ordinary challenge-auction quote. Forced sale requires expiration and no outstanding challenge. Rolling and expired purchases use fresh reads, exact simulation and explicit wallet confirmation in their guided journeys.`);
  }

  async function readManage() {
    const loadForm = $('#manage-load-form');
    if (!loadForm.reportValidity()) return null;
    const nonce = ++state.manageNonce;
    const { position, account } = manageFormValues();
    try {
      const client = await clientFor(field('currency').value);
      const snapshot = await client.positionSnapshot(address(position, 'Position'), withCaller({}, account));
      if (nonce !== state.manageNonce) return null;
      state.manage = { client, address: snapshot.address, account: account ? address(account, 'Account') : null, snapshot };
      renderPosition(snapshot);
      $('#manage-unavailable').textContent = `Current position state at ${block(snapshot)}. Repayment and withdrawal are evaluated separately.`;
      return snapshot;
    } catch (cause) {
      if (nonce !== state.manageNonce) return null;
      resultText('#manage-state', errorMessage(cause), true);
      $('#manage-unavailable').textContent = 'Position state could not be read; no zero or empty state has been substituted.';
      return null;
    }
  }

  function renderRepayment(snapshot) {
    const quote = snapshot.quote;
    const candidate = snapshot.fullCandidate;
    metrics('#repayment-result', [
      ['Source block', block(snapshot)],
      ['Wallet amount', money(quote.walletAmount)],
      ['Gross debt reduction', money(quote.grossDebtReduction)],
      ['Assigned reserve used', money(quote.assignedReserve)],
      ['Remaining gross debt', quote.remainingDebt === null ? 'Over-repayment would revert' : money(quote.remainingDebt)],
      ['Reserve contribution (original parameter)', ppm(snapshot.reserveContributionPPM)],
      ['Caller balance', snapshot.callerBalance === null ? null : money(snapshot.callerBalance)],
      ['Wallet funding covers quote', snapshot.quoteFunded],
      ['Full candidate wallet amount', money(candidate.walletAmount)],
      ['Candidate covers all gross debt', candidate.complete],
      ['Candidate would need simulation', candidate.wouldRevert || !candidate.complete],
    ]);
    const note = document.createElement('p');
    note.className = 'smalltext';
    note.textContent = `${snapshot.caveats.join(' ')} Read-only views do not establish token-transfer success or repayment confirmation.`;
    $('#repayment-result').append(note);
  }

  async function quoteRepayment(full = false) {
    if (!state.manage) {
      const snapshot = await readManage();
      if (!snapshot) return;
    }
    try {
      const { client, address: position, account } = state.manage;
      const options = withCaller(full ? {} : { amount: amount($('#repayment-form').elements.namedItem('repayAmount').value, 18, 'Repayment amount') }, account);
      const snapshot = await client.repaymentSnapshot(position, options);
      renderRepayment(snapshot);
    } catch (cause) {
      resultText('#repayment-result', errorMessage(cause), true);
    }
  }

  async function quoteWithdrawal() {
    if (!state.manage) {
      const snapshot = await readManage();
      if (!snapshot) return;
    }
    try {
      const { client, address: position, account, snapshot: current } = state.manage;
      const snapshot = await client.withdrawalSnapshot(position, withCaller({ amount: amount($('#withdrawal-form').elements.namedItem('withdrawAmount').value, current.collateral.decimals, 'Withdrawal amount') }, account));
      state.manage.snapshot = snapshot.position;
      renderPosition(snapshot.position);
      checks('#withdrawal-result', []);
      metrics('#withdrawal-result', [
        ['Source block', block(snapshot)],
        ['Collateral after withdrawal', snapshot.balanceAfter === null ? 'Insufficient collateral' : money(snapshot.balanceAfter, snapshot.position.collateral.decimals)],
        ['Would close below minimum', snapshot.wouldClose],
        ['Read-derived withdrawal eligibility', snapshot.eligible],
      ]);
      const list = document.createElement('ul');
      list.className = 'check-list';
      $('#withdrawal-result').append(list);
      checks(list, snapshot.checks);
    } catch (cause) {
      resultText('#withdrawal-result', errorMessage(cause), true);
    }
  }

  async function readChallenge() {
    if (!state.manage) {
      const snapshot = await readManage();
      if (!snapshot) return;
    }
    try {
      const { client, snapshot: current } = state.manage;
      const index = uint($('#manage-load-form').elements.namedItem('challengeIndex').value, 'Challenge index');
      const challenge = await client.challengeSnapshot(index);
      if (challenge.empty) {
        resultText('#challenge-result', `No challenge record at index ${index}. This is not an array-length or complete-history result.`);
        return;
      }
      const position = challenge.position === current.address ? current : await client.positionState(challenge.position);
      if (!position.hubMatchesRegistry || !position.tokenMatchesRegistry) throw new Error('Challenge position does not belong to the selected currency hub');
      metrics('#challenge-result', [
        ['Source block', block(challenge)],
        ['Position', challenge.position],
        ['Challenger', challenge.challenger],
        ['Challenge size', `${money(challenge.size, position.collateral.decimals)} ${position.collateral.symbol}`],
        ['Started', timestamp(challenge.start)],
        ['First-phase deadline', challenge.deadline === null ? null : timestamp(challenge.deadline)],
        ['Current contract price', money(challenge.currentPrice, position.priceDecimals)],
        ['Phase', challenge.active ? 'Aversion window (through the first deadline)' : 'First deadline passed: auction/settlement must be determined from further reads/events'],
      ]);
      const note = document.createElement('p');
      note.className = 'smalltext';
      note.textContent = 'The first-deadline flag is not a completed-challenge indicator. Existing challenges can continue after position expiration; repayment remains a separate path.';
      $('#challenge-result').append(note);
    } catch (cause) {
      resultText('#challenge-result', errorMessage(cause), true);
    }
  }

  function ecoAccount() {
    const value = $('#ecosystem-load-form').elements.namedItem('ecosystemAccount').value.trim();
    return value ? address(value, 'Ecosystem account') : null;
  }

  async function readEcosystem() {
    const loadForm = $('#ecosystem-load-form');
    if (!loadForm.reportValidity()) return;
    const nonce = ++state.ecosystemNonce;
    const code = $('#ecosystem-currency').value;
    const account = ecoAccount();
    const client = await clientFor(code);
    const options = withAccount({}, account);
    const [bridge, savings, equity, minters, token] = await Promise.allSettled([
      client.bridgeSnapshot(options),
      client.savingsSnapshot(options),
      client.equitySnapshot(options),
      client.minterSnapshot(),
      client.tokenSnapshot(),
    ]);
    if (nonce !== state.ecosystemNonce) return;
    state.ecosystem = { client, account, code };
    for (const [name, result] of Object.entries({ bridge, savings, equity, minters, token })) {
      state.ecosystem[name] = result.status === 'fulfilled' ? result.value : { error: errorMessage(result.reason) };
    }
    renderEcosystem();
  }

  function renderEcosystem() {
    const { bridge, savings, equity, minters, token } = state.ecosystem;
    if (bridge?.error) resultText('#bridge-state', bridge.error, true);
    else if (bridge) {
      metrics('#bridge-state', [
        ['Source block', block(bridge)],
        ['Source asset', `${bridge.sourceSymbol} · ${bridge.sourceDecimals} decimals`],
        ['Decimal multiplier', bridge.decimalMultiplier.toString()],
        ['Local cap / minted', `${money(bridge.limitLocal)} / ${money(bridge.mintedLocal)}`],
        ['Remaining local capacity', money(bridge.capacityLocal)],
        ['Source locked in bridge', `${money(bridge.sourceLocked, bridge.sourceDecimals)} ${bridge.sourceSymbol}`],
        ['Mint horizon', timestamp(bridge.horizon)],
        ['Accepts deposits at this block', bridge.acceptsDeposits],
        ['Unpaid source credit', bridge.creditBalance === null ? null : `${money(bridge.creditBalance, bridge.sourceDecimals)} ${bridge.sourceSymbol}`],
      ]);
      const sourceEvidence = state.registry?.instances[state.ecosystem.code]?.sourceEvidence;
      if (sourceEvidence && /test|tUSDC/i.test(JSON.stringify(sourceEvidence))) {
        const note = document.createElement('p');
        note.className = 'smalltext';
        note.textContent = 'Test source metadata: this fixture has no real value and is not production reserve backing. Decimal normalization is not FX conversion.';
        $('#bridge-state').append(note);
      }
    }
    if (savings?.error) resultText('#savings-state', savings.error, true);
    else if (savings) {
      metrics('#savings-state', [
        ['Source block', block(savings)],
        ['Current leadrate', ppm(savings.currentRatePPM)],
        ['Pending leadrate', savings.rateChangePending ? ppm(savings.nextRatePPM) : 'No pending change'],
        ['Pending change ready / not applied', savings.rateChangePending ? savings.rateChangeReady : null],
        ['Next change timestamp', savings.rateChangePending ? timestamp(savings.nextChange) : 'Not set'],
        ['Interest/withdrawal delay', `${savings.interestDelay.toString()} seconds`],
        ['Account tick anchor (not a timestamp)', savings.account?.ticks.toString()],
        ['Current ticks (not a timestamp)', savings.currentTicks.toString()],
        ['Account saved', savings.account ? money(savings.account.saved) : null],
        ['Accrued interest (view)', savings.account ? money(savings.account.accruedInterest) : null],
        ['Account locked', savings.account ? savings.account.locked : null],
        ['Remaining lock (rate-dependent)', savings.account ? savings.account.remainingLockSeconds === null ? null : `${savings.account.remainingLockSeconds} seconds` : null],
        ['Accepts new savings at this block', savings.acceptsDeposits],
        ['Equity available for interest', money(savings.equityAmount)],
      ]);
    }
    if (equity?.error) resultText('#equity-state', equity.error, true);
    else if (equity) {
      metrics('#equity-state', [
        ['Source block', block(equity)],
        ['Pool-share price', money(equity.sharePrice)],
        ['Total pool shares', money(equity.totalShares)],
        ['System equity', money(equity.equityAmount)],
        ['Valuation factor', equity.valuationFactor.toString()],
        ['Minimum average holding', `${(equity.minimumHoldingDuration >> 20n).toString()} seconds`],
        ['Account shares', equity.account ? money(equity.account.shares) : null],
        ['Account holding duration', equity.account ? `${equity.account.holdingDurationSeconds.toString()} seconds` : null],
        ['Holding rule allows redemption', equity.account ? equity.account.canRedeem : null],
        ['Account own votes (time-weighted)', equity.account?.votes.toString()],
        ['Delegate', equity.account?.delegate],
      ]);
    }
    if (minters?.error) resultText('#minter-state', minters.error, true);
    else if (minters) {
      metrics('#minter-state', [
        ['Source block', block(minters)],
        ['Application period (configured)', `${state.ecosystem.client.instance.minApplicationPeriod.toString()} seconds; not the three-day position window`],
        ...minters.minters.map((minter) => [`${minter.label} active / validity`, `${minter.active} / ${timestamp(minter.validityStart)}`]),
      ]);
    }
    if (token && !token.error) {
      state.ecosystem.token = token;
    }
  }

  async function quoteBridge() {
    try {
      if (!state.ecosystem.client) await readEcosystem();
      const { client, account } = state.ecosystem;
      const decimals = state.ecosystem.bridge?.sourceDecimals ?? client.instance.sourceDecimals;
      const sourceAmount = amount($('#bridge-form').elements.namedItem('sourceAmount').value, decimals, 'Source amount');
      const burnLocalAmount = amount($('#bridge-form').elements.namedItem('burnAmount').value, 18, 'Local burn amount');
      const credit = $('#bridge-form').elements.namedItem('credit').checked;
      const options = withAccount({}, account);
      const [mint, burn] = await Promise.all([
        client.bridgeSnapshot({ ...options, mintSourceAmount: sourceAmount }),
        client.bridgeSnapshot({ ...options, burnLocalAmount, credit }),
      ]);
      state.ecosystem.bridge = mint;
      renderEcosystem();
      metrics('#bridge-quote', [
        ['Mint source block', block(mint)],
        ['Source input', `${money(mint.mintPlan.sourceAmount, mint.sourceDecimals)} ${mint.sourceSymbol}`],
        ['Nominal local output', money(mint.mintPlan.localAmount)],
        ['Within local cap', mint.mintPlan.withinCapacity],
        ['Source funded / approved', `${mint.mintPlan.funded} / ${mint.mintPlan.approved}`],
        ['Read-derived mint eligibility', mint.mintPlan.eligible],
        ['Burn source block', block(burn)],
        ['Requested local burn', money(burn.burnPlan.requestedLocalAmount)],
        ['Actual rounded local burn', money(burn.burnPlan.alignedLocalAmount)],
        ['Unburned local remainder', money(burn.burnPlan.remainderLocalAmount)],
        [`${credit ? 'Unpaid credit' : 'Source redemption'} amount`, `${money(burn.burnPlan.sourceAmount, burn.sourceDecimals)} ${burn.sourceSymbol}`],
        ['Resulting unpaid credit', burn.burnPlan.resultingCredit === null ? null : `${money(burn.burnPlan.resultingCredit, burn.sourceDecimals)} ${burn.sourceSymbol}`],
        ['Within outstanding local bridge amount', burn.burnPlan.withinOutstanding],
        ['Backed by locked source assets', burn.burnPlan.backedBySource],
        ['Credit within uint256 range', burn.burnPlan.creditWithinRange],
        ['Read-derived redemption eligibility', burn.burnPlan.eligible],
      ]);
      const note = document.createElement('p');
      note.className = 'smalltext';
      note.textContent = `${credit ? 'Credit scenario records unpaid source-denominated credit; it is not a payout.' : 'Immediate redemption scenario; token restrictions and source liquidity still apply.'} ${burn.burnPlan.alignedLocalAmount === 0n ? 'The requested amount rounds to zero source raw units: no meaningful redemption is represented.' : ''}`;
      $('#bridge-quote').append(note);
    } catch (cause) {
      resultText('#bridge-quote', errorMessage(cause), true);
    }
  }

  async function quoteEquity() {
    try {
      if (!state.ecosystem.client) await readEcosystem();
      const { client, account } = state.ecosystem;
      const snapshot = await client.equitySnapshot(withAccount({
        investment: amount($('#equity-form').elements.namedItem('investmentAmount').value, 18, 'Investment'),
        redemptionShares: amount($('#equity-form').elements.namedItem('sharesAmount').value, 18, 'Redemption shares'),
      }, account));
      state.ecosystem.equity = snapshot;
      renderEcosystem();
      metrics('#equity-quote', [
        ['Source block', block(snapshot)],
        ['Investment input', money(snapshot.investment)],
        ['Quoted pool shares', snapshot.quotedShares === null ? null : money(snapshot.quotedShares)],
        ['Redemption shares input', snapshot.redemptionShares === null ? null : money(snapshot.redemptionShares)],
        ['Quoted local proceeds', snapshot.quotedProceeds === null ? null : money(snapshot.quotedProceeds)],
        ['Holding-rule eligibility only', snapshot.account?.canRedeem],
      ]);
      const note = document.createElement('p');
      note.className = 'smalltext';
      note.textContent = 'Quotes are nonlinear and state-dependent. Holding eligibility alone does not validate a share amount; redemption must leave more than one share in total supply. The guided transaction requires a minimum output and fresh exact simulation.';
      $('#equity-quote').append(note);
    } catch (cause) {
      resultText('#equity-quote', errorMessage(cause), true);
    }
  }

  async function quoteGovernance() {
    try {
      if (!state.ecosystem.client) await readEcosystem();
      const account = ecoAccount();
      if (!account) throw new Error('Enter a public account for vote qualification');
      const helpers = $('#governance-form').elements.namedItem('helpers').value.split(/[\s,]+/).filter(Boolean).map((value) => address(value, 'Helper'));
      for (let index = 0; index < helpers.length; index += 1) {
        if (helpers[index] === account) throw new Error('Helpers must not include the caller');
        if (index > 0 && BigInt(helpers[index - 1]) >= BigInt(helpers[index])) throw new Error('Helpers must be strictly address-sorted and unique');
      }
      const snapshot = await state.ecosystem.client.governanceSnapshot(account, helpers);
      metrics('#governance-state', [
        ['Source block', block(snapshot)],
        ['Own votes (time-weighted)', snapshot.ownVotes?.toString()],
        ['Votes including helpers', snapshot.votes.toString()],
        ['Total votes', snapshot.totalVotes.toString()],
        ['Relative votes', snapshot.relativeVotes === null ? 'No votes / undefined ratio' : `${sdk.formatDecimal(snapshot.relativeVotes, 16)}%`],
        ['Strictly more than 2%', snapshot.qualifiedByVotes],
        ['Contract checkQualified', snapshot.qualified],
      ]);
      const note = document.createElement('p');
      note.className = 'smalltext';
      note.textContent = 'This is qualification at one block, not a veto, rate proposal or delegation transaction. Helper delegation validity is evaluated by the contract; invalid lists remain errors, not zero votes.';
      $('#governance-state').append(note);
    } catch (cause) {
      resultText('#governance-state', errorMessage(cause), true);
    }
  }

  function submitHandler(selector, handler) {
    $(selector).addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await handler();
      } catch (cause) {
        hooks.notify(errorMessage(cause));
      }
    });
  }

  function init(options) {
    hooks = options;
    form.addEventListener('input', invalidate);
    form.addEventListener('change', (event) => {
      if (event.target.name === 'action') setAction();
      else invalidate();
    });
    $('#v2-currency').addEventListener('change', () => {
      state.manage = null;
      state.ecosystem = {};
      $('#ecosystem-currency').value = $('#v2-currency').value;
    });
    submitHandler('#v2-position-form', async () => {
      const snapshot = await readAction();
      if (!snapshot) return;
      const plan = getPlan();
      hooks.notify(plan.status === 'read-backed-plan' ? 'Read-backed V2 plan prepared. This is not a simulation, signature or transaction.' : state.fixture ? 'Fixture plan prepared with synthetic reads; no live V2 state or execution is represented.' : 'Local V2 plan prepared with read evidence where available. No simulation or signing was performed.');
    });
    $('#read-parent').addEventListener('click', readAction);
    $('#read-position').addEventListener('click', readAction);
    $('#save-v2-plan').addEventListener('click', () => {
      try {
        const plan = getPlan();
        hooks.store.save(plan);
        hooks.notify('V2 read plan saved on this app origin. It grants no execution authority.');
      } catch (cause) {
        formError(errorMessage(cause));
      }
    });
    $('#export-v2-plan').addEventListener('click', () => {
      try {
        const plan = getPlan();
        planning.download(plan, `imf-${plan.currency.toLowerCase()}-${plan.action}-read-plan.json`);
        hooks.notify('V2 read plan exported. No transaction, simulation or signing authority was created.');
      } catch (cause) {
        formError(errorMessage(cause));
      }
    });
    submitHandler('#registry-form', async () => {
      const file = $('#registry-file').files[0];
      let raw = state.runtime?.registry;
      let source = state.runtime?.fixture ? 'fixture' : 'runtime-config';
      if (file) {
        if (file.size > 5000000) throw new Error('Registry file must be smaller than 5 MB');
        raw = JSON.parse(await file.text());
        source = 'local-file';
      }
      if (!raw) throw new Error('Choose a V2 registry JSON file');
      await connect(raw, $('#rpc-url').value.trim(), source);
    });
    $('#disconnect-registry').addEventListener('click', disconnect);
    submitHandler('#manage-load-form', readManage);
    submitHandler('#repayment-form', () => quoteRepayment(false));
    $('#full-repayment').addEventListener('click', () => quoteRepayment(true).catch((cause) => resultText('#repayment-result', errorMessage(cause), true)));
    submitHandler('#withdrawal-form', quoteWithdrawal);
    $('#read-challenge').addEventListener('click', () => readChallenge().catch((cause) => resultText('#challenge-result', errorMessage(cause), true)));
    submitHandler('#ecosystem-load-form', async () => {
      try {
        await readEcosystem();
      } catch (cause) {
        for (const selector of ['#bridge-state', '#savings-state', '#equity-state', '#minter-state']) resultText(selector, errorMessage(cause), true);
      }
    });
    submitHandler('#bridge-form', quoteBridge);
    submitHandler('#equity-form', quoteEquity);
    submitHandler('#governance-form', quoteGovernance);
    setAction();
    renderRegistry();
    fetch(window.IMF_LINKS.assets('runtime.json')).then((response) => {
      if (!response.ok) throw new Error(`Runtime configuration failed (${response.status})`);
      return response.json();
    }).then(async (runtime) => {
      state.runtime = runtime;
      $('#runtime-message').textContent = runtime.message || 'Configure a V2 registry for read-only access.';
      $('#rpc-url').value = runtime.rpcUrl || '';
      if (runtime.registry && runtime.rpcUrl) await connect(runtime.registry, runtime.rpcUrl, runtime.fixture ? 'fixture' : 'runtime-config');
    }).catch((cause) => {
      connectionError(`Runtime configuration could not be loaded: ${errorMessage(cause)}`);
    });
    return { getPlan, loadPlan, readAction, clientFor, refresh, state };
  }

  window.IMF_V2_APP = { init, get state() { return state; } };
})();
