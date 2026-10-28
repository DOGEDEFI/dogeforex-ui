(() => {
  'use strict';

  const PANELS = ['overview', 'collateral', 'positions', 'markets', 'risk', 'activity', 'parameters'];
  const PANEL_LABELS = {
    overview: 'Overview',
    collateral: 'Collateral',
    positions: 'Positions',
    markets: 'Markets',
    risk: 'Risk Lab',
    activity: 'Activity',
    parameters: 'Parameters',
  };
  const STATUS_LABELS = {
    pass: 'Live read',
    warn: 'Planning',
    fail: 'Unavailable',
    info: 'Read-only',
    neutral: 'Unknown',
  };
  const READINESS_GATES = [
    ['Independent V2 audit', 'Required before production; upstream audits do not cover IMF V2 changes.'],
    ['Production source asset', 'tUSDC is a deployer-minted test asset, not production USDC or a reserve.'],
    ['Refreshed economics', 'Initial leadrates are dated deployment inputs and require production review.'],
    ['Historical indexer', 'History, volume and complete event coverage require a real indexer.'],
    ['Market/reference feed', 'Reference marks and executable liquidity analytics require a verified market adapter.'],
    ['Legal and custody review', 'MiCA/legal, custody, issuer controls and production parameters remain separate gates.'],
  ];

  const state = {
    panel: 'overview',
    code: 'USD',
    account: '',
    positionScope: 'all',
    nonce: 0,
    system: null,
    discovery: null,
    discoveryPending: false,
    challenge: null,
    parametersTab: 'current',
    position: { search: '', collateral: 'ALL', status: 'ALL', sort: 'collateralRatio', dir: 'asc', page: 1, perPage: 8 },
    scenario: { collateral: -20, fx: 0, liquidity: 15, threshold: 150, preset: 'moderate' },
    replay: { progress: 0, playing: false, timer: null },
  };
  let hooks = {};
  let root = null;
  let drawer = null;
  let backdrop = null;

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function notify(message, isError = false) {
    hooks.notify?.(message, isError);
  }

  function sdk() {
    return window.IMF_V2;
  }

  function app() {
    return hooks.getV2?.() ?? window.IMF_V2_APP;
  }

  function registryState() {
    return app()?.state ?? null;
  }

  function currentCode() {
    const selected = $('#v2-currency')?.value;
    return state.code || selected || 'USD';
  }

  function currentInstance(code = currentCode()) {
    return registryState()?.registry?.instances?.[code] ?? null;
  }

  function currentSymbol(code = currentCode()) {
    return currentInstance(code)?.symbol ?? `K9${code}`;
  }

  function currentExplorer() {
    return registryState()?.runtime?.chain?.explorerUrl ?? window.IMF_SITE?.origins?.docs ?? '';
  }

  function txLink(hash) {
    if (!hash || !currentExplorer()) return '';
    const url = `${currentExplorer().replace(/\/$/, '')}/tx/${hash}`;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Explorer</a>`;
  }

  function bigintOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  function formatRaw(value, unavailable = 'Unavailable') {
    const raw = bigintOrNull(value);
    return raw === null ? unavailable : raw.toString();
  }

  function formatAmount(value, decimals = 18, symbol = '') {
    const raw = bigintOrNull(value);
    if (raw === null) return 'Unavailable';
    const text = sdk().formatDecimal(raw, decimals);
    return symbol ? `${text} ${symbol}` : text;
  }

  function formatPPM(value) {
    const raw = bigintOrNull(value);
    return raw === null ? 'Unavailable' : `${sdk().formatPPM(raw)}%`;
  }

  function formatTimestamp(value) {
    const raw = bigintOrNull(value);
    if (raw === null || raw === 0n) return 'Not set';
    return `${new Date(Number(raw) * 1000).toISOString()} (${raw.toString()} seconds)`;
  }

  function formatBlock(sourceBlock) {
    if (!sourceBlock) return 'No source block';
    return `block ${sourceBlock.number} · ${new Date(Number(sourceBlock.timestamp) * 1000).toISOString()} · ${sourceBlock.hash}`;
  }

  function freshness(sourceBlock) {
    const runtime = registryState();
    if (runtime?.fixture) return { status: 'warn', label: 'SYNTHETIC', message: 'Synthetic fixture reads only; no deployed V2 state is represented.' };
    if (!sourceBlock) return { status: 'neutral', label: 'UNKNOWN', message: 'No source block is available.' };
    const age = Date.now() - Number(sourceBlock.timestamp) * 1000;
    if (age > 300000) return { status: 'warn', label: 'STALE', message: `Source block ${sourceBlock.number} is more than five minutes old at observation.` };
    if (age < -300000) return { status: 'fail', label: 'CLOCK MISMATCH', message: 'Source block timestamp is materially ahead of this browser clock.' };
    return { status: 'pass', label: 'CURRENT', message: `Read at ${formatBlock(sourceBlock)}.` };
  }

  function statusPill(status, label = STATUS_LABELS[status] ?? status) {
    return `<span class="status-pill ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  function unavailableCard(title, message) {
    return `<div class="unavailable-card"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  }

  function metricCard(label, value, sub = '', status = 'pass') {
    return `<div class="dash-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${statusPill(status)} ${escapeHtml(sub)}</small></div>`;
  }

  function metricList(rows) {
    return `<div class="dash-metric-list">${rows.map(([label, value]) => `<div class="dash-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 'Unavailable')}</strong></div>`).join('')}</div>`;
  }

  function compactNumber(value) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 1) return value.toFixed(2);
    return value.toPrecision(2);
  }

  function parseDecimalNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getCapabilities(code = currentCode()) {
    const runtime = registryState();
    const instance = currentInstance(code);
    const verified = Boolean(runtime?.verified?.get(code));
    const fixture = Boolean(runtime?.fixture);
    const imported = verified && runtime?.source === 'local-file';
    const live = verified && !fixture && runtime?.source === 'runtime-config' && code === 'USD';
    return {
      code,
      verified,
      fixture,
      imported,
      live,
      unconfigured: !runtime?.registry,
      registry: runtime?.registry ? { network: runtime.registry.network, chainId: runtime.registry.chainId.toString(), codes: runtime.registry.codes } : null,
      instance: instance ? { symbol: instance.symbol, name: instance.name, addresses: instance.addresses } : null,
      explorer: currentExplorer(),
      capabilities: {
        systemSnapshot: verified,
        discoveredPositions: verified && !fixture,
        challenge: verified,
        events: verified && !fixture,
        history: false,
        referenceMarks: false,
        markets: false,
      },
    };
  }

  async function getSystemSnapshot(code = currentCode()) {
    const capabilities = getCapabilities(code);
    if (!capabilities.verified) {
      return { code, capabilities, error: capabilities.unconfigured ? 'Configure and verify a V2 registry before reading dashboard state.' : `${code} is not verified against the selected registry and chain.` };
    }
    try {
      const client = await app().clientFor(code);
      const requested = {
        token: () => client.tokenSnapshot(),
        bridge: () => client.bridgeSnapshot({}),
        savings: () => client.savingsSnapshot({}),
        equity: () => client.equitySnapshot({}),
        minters: () => client.minterSnapshot(),
      };
      const entries = await Promise.all(Object.entries(requested).map(async ([name, read]) => {
        try {
          return [name, { status: 'fulfilled', value: await read() }];
        } catch (cause) {
          return [name, { status: 'rejected', error: cause instanceof Error ? cause.message : String(cause) }];
        }
      }));
      return { code, capabilities, sections: Object.fromEntries(entries) };
    } catch (cause) {
      return { code, capabilities, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function getDiscoveredPositions(code = currentCode(), coverage = {}) {
    const capabilities = getCapabilities(code);
    if (!capabilities.verified) return { code, capabilities, error: 'Position discovery requires a verified V2 registry.' };
    if (capabilities.fixture) {
      return { code, capabilities, positions: [], challenges: [], events: [], account: coverage.account ?? null, fromBlock: null, toBlock: null, complete: false, synthetic: true, warnings: ['Synthetic fixture: no deployed event history is represented.'] };
    }
    try {
      const client = await app().clientFor(code);
      const discovered = await window.IMF_DISCOVERY.discover(registryState(), client, coverage.account ?? null);
      return { code, capabilities, ...discovered, account: coverage.account ?? null };
    } catch (cause) {
      return { code, capabilities, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function getChallenge(code = currentCode(), index = 0n) {
    const capabilities = getCapabilities(code);
    if (!capabilities.verified) return { code, capabilities, error: 'Challenge reads require a verified V2 registry.' };
    try {
      const client = await app().clientFor(code);
      const challenge = await client.challengeSnapshot(BigInt(index));
      let positionState = null;
      if (!challenge.empty) {
        positionState = await client.positionState(challenge.position);
      }
      return { code, capabilities, challenge, positionState };
    } catch (cause) {
      return { code, capabilities, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  function getHistory() {
    return { status: 'unavailable', reason: 'History unavailable — indexer not configured.' };
  }

  function getReferenceMarks() {
    return { status: 'unavailable', reason: 'Reference marks unavailable — verified market/indexer feed not configured.' };
  }

  async function getEvents(code = currentCode(), range = {}) {
    const discovered = await getDiscoveredPositions(code, { account: range.account ?? null });
    if (discovered.error) return { code, capabilities: discovered.capabilities, status: 'unavailable', reason: discovered.error, events: [] };
    return {
      code,
      capabilities: discovered.capabilities,
      status: discovered.synthetic ? 'synthetic-fixture' : 'discovered-events',
      reason: discovered.synthetic ? 'Synthetic fixture has no deployed event history.' : 'Real discovered PositionOpened and ChallengeStarted events.',
      events: discovered.events ?? [],
      coverage: { fromBlock: discovered.fromBlock ?? null, toBlock: discovered.toBlock ?? null, complete: discovered.complete ?? null, account: discovered.account ?? null },
    };
  }

  function section(snapshot, name) {
    const entry = snapshot?.sections?.[name];
    if (!entry) return null;
    return entry.status === 'fulfilled' ? entry.value : { error: entry.error };
  }

  function sectionSource(snapshot, names) {
    for (const name of names) {
      const value = section(snapshot, name);
      if (value?.sourceBlock) return value.sourceBlock;
    }
    return null;
  }

  function systemError(snapshot) {
    return snapshot?.error ?? null;
  }

  function scaleRatio(value, maximum) {
    const safeMaximum = maximum && maximum > 0n ? maximum : 1n;
    const capped = value > safeMaximum ? safeMaximum : value < 0n ? 0n : value;
    return Number(capped) / Number(safeMaximum);
  }

  function axisValue(maximum, line) {
    return (maximum * BigInt(3 - line) / 3n).toString();
  }

  function allPositions() {
    return state.discovery?.positions ?? [];
  }

  function visiblePositions() {
    const account = normalizedAccount();
    const positions = state.positionScope === 'account' && account
      ? allPositions().filter((position) => sameAddress(position.owner, account) || sameAddress(position.createdBy, account))
      : allPositions();
    const filter = state.position;
    const query = filter.search.trim().toLowerCase();
    return positions.filter((position) => {
      if (query && ![position.address, position.owner, position.createdBy, position.collateral.symbol].some((value) => String(value ?? '').toLowerCase().includes(query))) return false;
      if (filter.collateral !== 'ALL' && position.collateral.symbol !== filter.collateral) return false;
      const status = positionStatus(position).key;
      if (filter.status !== 'ALL' && status !== filter.status) return false;
      return true;
    });
  }

  function normalizedAccount() {
    const value = state.account?.trim();
    if (!value) return '';
    try {
      return sdk().getAddress(value);
    } catch {
      return '';
    }
  }

  function sameAddress(left, right) {
    return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
  }

  function positionCollateralRatio(position) {
    const debt = bigintOrNull(position.minted);
    const collateral = bigintOrNull(position.collateral?.balance);
    const price = bigintOrNull(position.price);
    if (!debt || debt === 0n || !collateral || !price) return null;
    return collateral * price * 10000n / (debt * 10n ** 18n);
  }

  function formatCollateralRatio(position) {
    const bips = positionCollateralRatio(position);
    return bips === null ? 'Unavailable' : `${sdk().formatDecimal(bips, 2)}%`;
  }

  function positionStatus(position) {
    const sourceBlock = position.sourceBlock ?? sectionSource(state.system, ['token', 'bridge', 'savings', 'equity']);
    const now = sourceBlock?.timestamp ?? 0n;
    const challenged = bigintOrNull(position.challengedAmount) ?? 0n;
    const debt = bigintOrNull(position.minted) ?? 0n;
    if (challenged > 0n) return { key: 'challenged', label: 'Challenged', status: 'fail' };
    if (now && bigintOrNull(position.expiration) !== null && now >= bigintOrNull(position.expiration)) return { key: 'expired', label: 'Expired', status: 'neutral' };
    if (debt === 0n) return { key: 'no-debt', label: 'No debt', status: 'info' };
    if (now && bigintOrNull(position.cooldown) !== null && now <= bigintOrNull(position.cooldown)) return { key: 'initializing', label: 'Initializing', status: 'info' };
    const bips = positionCollateralRatio(position);
    if (bips !== null && bips < 10000n) return { key: 'critical', label: 'Critical', status: 'fail' };
    if (bips !== null && bips < BigInt(state.scenario.threshold * 100)) return { key: 'watch', label: 'Watch', status: 'warn' };
    return { key: 'active', label: 'Active', status: 'pass' };
  }

  function sortedPositions() {
    const key = state.position.sort;
    const direction = state.position.dir === 'asc' ? 1 : -1;
    return visiblePositions().slice().sort((left, right) => {
      let leftValue;
      let rightValue;
      if (key === 'collateralRatio') {
        leftValue = positionCollateralRatio(left) ?? -1n;
        rightValue = positionCollateralRatio(right) ?? -1n;
      } else if (key === 'debt') {
        leftValue = bigintOrNull(left.minted) ?? -1n;
        rightValue = bigintOrNull(right.minted) ?? -1n;
      } else if (key === 'collateral') {
        leftValue = bigintOrNull(left.collateral?.balance) ?? -1n;
        rightValue = bigintOrNull(right.collateral?.balance) ?? -1n;
      } else if (key === 'expiration') {
        leftValue = bigintOrNull(left.expiration) ?? -1n;
        rightValue = bigintOrNull(right.expiration) ?? -1n;
      } else {
        leftValue = String(left.address);
        rightValue = String(right.address);
      }
      if (typeof leftValue === 'bigint' && typeof rightValue === 'bigint') return leftValue === rightValue ? 0 : leftValue > rightValue ? direction : -direction;
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    });
  }

  function sortButton(label, key) {
    const active = state.position.sort === key;
    const arrow = active ? (state.position.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button type="button" data-sort="${escapeHtml(key)}" aria-pressed="${active}">${escapeHtml(label)}${arrow}</button>`;
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv(filename, headers, rows) {
    downloadText(filename, [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n'), 'text/csv');
  }

  function exportJson(filename, value) {
    window.IMF_PLANNING.download(value, filename);
  }

  function panelRoot(name = state.panel) {
    return $(`#dashboard-${name}`, root);
  }

  function setPanelHtml(name, html) {
    const target = panelRoot(name);
    if (target) target.innerHTML = html;
  }

  function renderSourceStatus() {
    const capabilities = getCapabilities();
    const sourceBlock = sectionSource(state.system, ['token', 'bridge', 'savings', 'equity']) ?? state.discovery?.positions?.[0]?.sourceBlock ?? state.challenge?.challenge?.sourceBlock;
    const fresh = freshness(sourceBlock);
    const mode = capabilities.live ? 'LIVE USD' : capabilities.fixture ? 'SYNTHETIC FIXTURE' : capabilities.imported ? 'IMPORTED READ-ONLY' : capabilities.verified ? 'READ-ONLY' : 'UNCONFIGURED';
    const target = $('#dashboard-source-status', root);
    if (!target) return;
    target.innerHTML = `
      <div><strong>${escapeHtml(currentCode())} · ${escapeHtml(capabilities.registry?.network ?? 'No registry')} · chain ${escapeHtml(capabilities.registry?.chainId ?? '—')}</strong><br><span>${escapeHtml(fresh.message)}</span></div>
      <div class="dash-actions">${statusPill(fresh.status, mode)}</div>`;
  }

  function systemOverviewRows() {
    const token = section(state.system, 'token');
    const bridge = section(state.system, 'bridge');
    const savings = section(state.system, 'savings');
    const equity = section(state.system, 'equity');
    return [
      ['Currency token', token?.error ? `Unavailable: ${token.error}` : `${token?.name ?? 'Unavailable'} (${token?.symbol ?? '—'})`],
      ['Token supply', token?.error ? 'Unavailable' : formatAmount(token?.totalSupply, 18, token?.symbol ?? currentSymbol())],
      ['Minter reserve', token?.error ? 'Unavailable' : formatAmount(token?.minterReserve, 18, token?.symbol ?? currentSymbol())],
      ['System equity', equity?.error ? 'Unavailable' : formatAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol())],
      ['Pool-share price', equity?.error ? 'Unavailable' : formatAmount(equity?.sharePrice, 18, token?.symbol ?? currentSymbol())],
      ['Current leadrate', savings?.error ? 'Unavailable' : formatPPM(savings?.currentRatePPM)],
      ['Pending leadrate', savings?.error ? 'Unavailable' : savings?.rateChangePending ? formatPPM(savings?.nextRatePPM) : 'No pending change'],
      ['Bridge cap / minted', bridge?.error ? 'Unavailable' : `${formatAmount(bridge?.limitLocal, 18, token?.symbol ?? currentSymbol())} / ${formatAmount(bridge?.mintedLocal, 18, token?.symbol ?? currentSymbol())}`],
      ['Remaining bridge capacity', bridge?.error ? 'Unavailable' : formatAmount(bridge?.capacityLocal, 18, token?.symbol ?? currentSymbol())],
      ['Source locked in bridge', bridge?.error ? 'Unavailable' : formatAmount(bridge?.sourceLocked, bridge?.sourceDecimals ?? 6, bridge?.sourceSymbol ?? 'source')],
      ['Discovered positions', state.discoveryPending ? 'Read in progress' : state.discovery?.error ? 'Unavailable' : String(state.discovery?.positions?.length ?? 0)],
      ['Discovered challenges', state.discoveryPending ? 'Read in progress' : state.discovery?.error ? 'Unavailable' : String(state.discovery?.challenges?.length ?? 0)],
    ];
  }

  function renderOverview() {
    if (systemError(state.system)) {
      setPanelHtml('overview', `<div class="dash-stack">${unavailableCard('USD V2 state is not verified', state.system.error)}${sourceNote()}</div>`);
      return;
    }
    const token = section(state.system, 'token');
    const bridge = section(state.system, 'bridge');
    const savings = section(state.system, 'savings');
    const equity = section(state.system, 'equity');
    const history = getHistory();
    const positions = state.discovery?.positions ?? [];
    const challenges = state.discovery?.challenges ?? [];
    const kpis = [
      metricCard('Token supply', token?.error ? 'Unavailable' : formatAmount(token?.totalSupply, 18, token?.symbol ?? currentSymbol()), token?.error ?? formatBlock(token?.sourceBlock), token?.error ? 'fail' : 'pass'),
      metricCard('Minter reserve', token?.error ? 'Unavailable' : formatAmount(token?.minterReserve, 18, token?.symbol ?? currentSymbol()), token?.error ?? 'Current read', token?.error ? 'fail' : 'pass'),
      metricCard('System equity', equity?.error ? 'Unavailable' : formatAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol()), equity?.error ?? formatBlock(equity?.sourceBlock), equity?.error ? 'fail' : 'pass'),
      metricCard('Bridge capacity', bridge?.error ? 'Unavailable' : formatAmount(bridge?.capacityLocal, 18, token?.symbol ?? currentSymbol()), bridge?.error ?? formatBlock(bridge?.sourceBlock), bridge?.error ? 'fail' : 'pass'),
      metricCard('Current leadrate', savings?.error ? 'Unavailable' : formatPPM(savings?.currentRatePPM), savings?.error ?? formatBlock(savings?.sourceBlock), savings?.error ? 'fail' : 'pass'),
      metricCard('Discovered positions', state.discoveryPending ? 'Read in progress' : state.discovery?.error ? 'Unavailable' : String(positions.length), state.discovery?.error ?? discoveryCoverageText(), state.discoveryPending ? 'info' : state.discovery?.error ? 'fail' : 'pass'),
      metricCard('Challenges', state.discoveryPending ? 'Read in progress' : state.discovery?.error ? 'Unavailable' : String(challenges.length), state.discovery?.error ?? 'Event-derived, then current-state verified', state.discoveryPending ? 'info' : state.discovery?.error ? 'fail' : 'pass'),
      metricCard('Pool shares', equity?.error ? 'Unavailable' : formatAmount(equity?.totalShares, 18, 'shares'), equity?.error ?? formatBlock(equity?.sourceBlock), equity?.error ? 'fail' : 'pass'),
    ].join('');
    setPanelHtml('overview', `
      <div class="dash-stack">
        <div class="dash-kpis">${kpis}</div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>System snapshot</h3><p>Current reads from the selected USD registry. Each value retains its own source block.</p></div></div>${metricList(systemOverviewRows())}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Historical charts</h3><p>No indexer is configured for this release.</p></div></div>${unavailableCard('History unavailable — indexer not configured', history.reason)}</article>
          <article class="dash-card span-12"><div class="dash-card-head"><div><h3>Cross-currency comparison</h3><p>Native K9 units are not summed across independent systems.</p></div></div>${unavailableCard('Cross-currency comparison unavailable', 'Explicit FX provenance and verified registries for the other systems are required before any comparison can be shown.')}</article>
        </div>
        ${sourceNote()}
      </div>`);
  }

  function sourceNote() {
    const capabilities = getCapabilities();
    if (capabilities.live) return `<div class="dash-note">Live dashboard reads are available for runtime-config verified USD only. Other currency codes remain planning identifiers until their own V2 registries are configured and verified.</div>`;
    if (capabilities.fixture) return `<div class="dash-note danger">SYNTHETIC FIXTURE — values are teaching inputs and are not deployed contract state.</div>`;
    if (capabilities.imported) return `<div class="dash-note">Imported registry reads are read-only. Only runtime-config verified USD may be presented as live deployed V2 state.</div>`;
    return `<div class="dash-note">Configure a verified V2 registry under Wallet, registry & network. Missing reads remain unavailable rather than zero.</div>`;
  }

  function discoveryCoverageText() {
    if (state.discoveryPending) return 'Discovery read in progress; current position totals are not yet asserted.';
    if (!state.discovery) return 'No discovery read';
    if (state.discovery.error) return state.discovery.error;
    if (state.discovery.synthetic) return 'Synthetic fixture has no deployed event history.';
    return `Scanned blocks ${state.discovery.fromBlock ?? 'unknown'}–${state.discovery.toBlock ?? 'unknown'}${state.discovery.complete ? '' : ' · partial'}${state.discovery.account ? ` · account ${state.discovery.account}` : ''}`;
  }

  function collateralGroups() {
    const groups = new Map();
    for (const position of allPositions()) {
      const symbol = position.collateral?.symbol ?? 'Unknown';
      if (!groups.has(symbol)) groups.set(symbol, { symbol, positions: 0, collateral: 0n, challenged: 0n, debt: 0n });
      const group = groups.get(symbol);
      group.positions += 1;
      group.collateral += bigintOrNull(position.collateral?.balance) ?? 0n;
      group.challenged += bigintOrNull(position.challengedAmount) ?? 0n;
      group.debt += bigintOrNull(position.minted) ?? 0n;
    }
    return [...groups.values()].sort((left, right) => right.collateral > left.collateral ? 1 : right.collateral < left.collateral ? -1 : left.symbol.localeCompare(right.symbol));
  }

  function renderCollateral() {
    if (state.discoveryPending) {
      setPanelHtml('collateral', `<div class="dash-stack">${unavailableCard('Collateral discovery is in progress', 'The dashboard is scanning verified events and rereading current position state. No zero or empty collateral state is asserted yet.')}${sourceNote()}</div>`);
      return;
    }
    if (state.discovery?.error) {
      setPanelHtml('collateral', `<div class="dash-stack">${unavailableCard('Collateral discovery is unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const bridge = section(state.system, 'bridge');
    const equity = section(state.system, 'equity');
    const token = section(state.system, 'token');
    const groups = collateralGroups();
    const totalChallenged = allPositions().reduce((sum, position) => sum + (bigintOrNull(position.challengedAmount) ?? 0n), 0n);
    const rows = groups.map((group) => {
      const decimals = allPositions().find((position) => position.collateral?.symbol === group.symbol)?.collateral?.decimals ?? 18;
      return `<tr><td>${escapeHtml(group.symbol)}</td><td class="num">${group.positions}</td><td class="num mono">${formatAmount(group.collateral, decimals, group.symbol)}</td><td class="num mono">${formatAmount(group.challenged, decimals, group.symbol)}</td><td class="num mono">${formatAmount(group.debt, 18, currentSymbol())}</td></tr>`;
    }).join('');
    setPanelHtml('collateral', `
      <div class="dash-stack">
        <div class="dash-kpis">
          ${metricCard('Collateral types', String(groups.length), discoveryCoverageText(), groups.length ? 'pass' : 'neutral')}
          ${metricCard('Discovered positions', String(allPositions().length), state.discovery?.complete === false ? 'Partial discovery' : 'Current discovery', 'pass')}
          ${metricCard('Challenged collateral', formatAmount(totalChallenged, allPositions()[0]?.collateral?.decimals ?? 18, allPositions()[0]?.collateral?.symbol ?? ''), 'Exact current position reads', totalChallenged > 0n ? 'warn' : 'pass')}
          ${metricCard('Bridge capacity', bridge?.error ? 'Unavailable' : formatAmount(bridge?.capacityLocal, 18, token?.symbol ?? currentSymbol()), bridge?.error ?? formatBlock(bridge?.sourceBlock), bridge?.error ? 'fail' : 'pass')}
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Collateral register</h3><p>Real discovered positions, grouped by collateral token.</p></div></div>${groups.length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Collateral</th><th class="num">Positions</th><th class="num">Collateral balance</th><th class="num">Challenged</th><th class="num">Gross debt</th></tr></thead><tbody>${rows}</tbody></table></div>` : unavailableCard('No collateral discovered', 'No verified positions matched the current discovery coverage.')}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Loss-absorption context</h3><p>Current system reads, not a historical waterfall.</p></div></div>${metricList([
            ['System equity', equity?.error ? 'Unavailable' : formatAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol())],
            ['Minter reserve', token?.error ? 'Unavailable' : formatAmount(token?.minterReserve, 18, token?.symbol ?? currentSymbol())],
            ['Reserve contract balance', token?.error ? 'Unavailable' : formatAmount(token?.reserveBalance ?? token?.reserve, 18, token?.symbol ?? currentSymbol())],
            ['Bridge source locked', bridge?.error ? 'Unavailable' : formatAmount(bridge?.sourceLocked, bridge?.sourceDecimals ?? 6, bridge?.sourceSymbol ?? 'source')],
            ['Discovery coverage', discoveryCoverageText()],
          ])}<div class="dash-note">Equity and minter reserve are related accounting balances, not interchangeable assets or guaranteed loss coverage.</div></article>
        </div>
        ${sourceNote()}
      </div>`);
  }

  function renderPositions() {
    if (state.discovery?.error) {
      setPanelHtml('positions', `<div class="dash-stack">${unavailableCard('Position discovery is unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const positions = sortedPositions();
    const totalPages = Math.max(1, Math.ceil(positions.length / state.position.perPage));
    state.position.page = Math.min(Math.max(1, state.position.page), totalPages);
    const start = (state.position.page - 1) * state.position.perPage;
    const pageRows = positions.slice(start, start + state.position.perPage);
    const collateralOptions = ['ALL', ...new Set(allPositions().map((position) => position.collateral?.symbol ?? 'Unknown'))];
    const rows = pageRows.map((position) => {
      const status = positionStatus(position);
      return `<tr>
        <td><button type="button" class="btn light small" data-position-detail="${escapeHtml(position.address)}">${escapeHtml(position.address.slice(0, 10))}…</button></td>
        <td class="mono">${escapeHtml(position.collateral?.symbol ?? 'Unknown')}</td>
        <td class="num mono">${formatAmount(position.minted, 18, currentSymbol())}</td>
        <td class="num mono">${formatCollateralRatio(position)}</td>
        <td class="num mono">${formatAmount(position.price, position.priceDecimals ?? 18, `${currentSymbol()} / ${position.collateral?.symbol ?? 'collateral'}`)}</td>
        <td class="num mono">${escapeHtml(new Date(Number(position.expiration) * 1000).toISOString().slice(0, 10))}</td>
        <td>${statusPill(status.status, status.label)}</td>
      </tr>`;
    }).join('');
    const pagination = Array.from({ length: totalPages }, (_, index) => `<button type="button" data-page="${index + 1}" class="${index + 1 === state.position.page ? 'active' : ''}" aria-label="Page ${index + 1}">${index + 1}</button>`).join('');
    setPanelHtml('positions', `
      <div class="dash-stack">
        <div class="dash-card">
          <div class="dash-card-head"><div><h3>Position explorer</h3><p>${escapeHtml(discoveryCoverageText())}</p></div><div class="dash-actions"><button type="button" class="btn light small" id="dashboard-positions-export">Export filtered CSV</button></div></div>
          <div class="dash-toolbar">
            <label class="dash-field">Search<input id="dashboard-position-search" type="search" value="${escapeHtml(state.position.search)}" placeholder="Position, owner or collateral"></label>
            <label class="dash-field">Collateral<select id="dashboard-position-collateral">${collateralOptions.map((symbol) => `<option value="${escapeHtml(symbol)}" ${symbol === state.position.collateral ? 'selected' : ''}>${symbol === 'ALL' ? 'All collateral' : escapeHtml(symbol)}</option>`).join('')}</select></label>
            <label class="dash-field">Status<select id="dashboard-position-status">${['ALL', 'active', 'watch', 'critical', 'challenged', 'initializing', 'expired', 'no-debt'].map((status) => `<option value="${status}" ${status === state.position.status ? 'selected' : ''}>${status === 'ALL' ? 'All statuses' : escapeHtml(status)}</option>`).join('')}</select></label>
            <label class="dash-field">Account context<input id="dashboard-position-account" type="text" value="${escapeHtml(state.account)}" placeholder="Optional 0x…"></label>
            <label class="dash-field">Scope<select id="dashboard-position-scope"><option value="all" ${state.positionScope === 'all' ? 'selected' : ''}>All discovered</option><option value="account" ${state.positionScope === 'account' ? 'selected' : ''}>Account only</option></select></label>
            <button type="button" class="btn light" id="dashboard-use-wallet">Use connected wallet</button>
            <button type="button" class="btn light" id="dashboard-refresh-discovery">Refresh discovery</button>
          </div>
          ${positions.length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Position</th><th>Collateral</th><th class="num">${sortButton('Gross debt', 'debt')}</th><th class="num">${sortButton('CR', 'collateralRatio')}</th><th class="num">Liquidation price</th><th class="num">${sortButton('Expiration', 'expiration')}</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><div class="dash-pagination"><span>${positions.length} matching · page ${state.position.page} of ${totalPages}</span><span class="buttons">${pagination}</span></div>` : unavailableCard(state.discoveryPending ? 'Position discovery is in progress' : 'No positions match', state.discoveryPending ? 'The dashboard is scanning verified events and rereading current position state. No zero or empty position state is asserted yet.' : 'Adjust the filters or run discovery with an explicit account context.')}
        </div>
        ${sourceNote()}
      </div>`);
    bindPositions();
  }

  function bindPositions() {
    $('#dashboard-position-search', root)?.addEventListener('input', (event) => { state.position.search = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-position-collateral', root)?.addEventListener('change', (event) => { state.position.collateral = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-position-status', root)?.addEventListener('change', (event) => { state.position.status = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-position-account', root)?.addEventListener('change', (event) => { state.account = event.target.value.trim(); state.position.page = 1; renderPositions(); });
    $('#dashboard-position-scope', root)?.addEventListener('change', (event) => { state.positionScope = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-use-wallet', root)?.addEventListener('click', () => {
      const account = window.IMF_WALLET?.getState?.().account;
      state.account = account ?? '';
      state.positionScope = account ? 'account' : 'all';
      renderPositions();
      notify(account ? 'Connected wallet account applied as dashboard discovery context.' : 'No connected wallet account is available.');
    });
    $('#dashboard-refresh-discovery', root)?.addEventListener('click', () => { state.discovery = null; render(); });
    $$('#dashboard-view [data-sort]', root).forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.position.sort === key) state.position.dir = state.position.dir === 'asc' ? 'desc' : 'asc';
      else state.position = { ...state.position, sort: key, dir: 'asc', page: 1 };
      renderPositions();
    }));
    $$('#dashboard-view [data-page]', root).forEach((button) => button.addEventListener('click', () => { state.position.page = Number(button.dataset.page); renderPositions(); }));
    $$('#dashboard-view [data-position-detail]', root).forEach((button) => button.addEventListener('click', () => {
      const position = allPositions().find((candidate) => sameAddress(candidate.address, button.dataset.positionDetail));
      if (position) openPositionDrawer(position);
    }));
    $('#dashboard-positions-export', root)?.addEventListener('click', exportPositionsCsv);
  }

  function exportPositionsCsv() {
    const rows = sortedPositions().map((position) => {
      const status = positionStatus(position);
      return [
        state.discovery?.code ?? currentCode(),
        position.address,
        position.owner,
        position.collateral?.symbol ?? '',
        position.collateral?.decimals ?? '',
        formatRaw(position.minted),
        formatRaw(position.collateral?.balance),
        formatRaw(position.price),
        position.priceDecimals ?? '',
        formatRaw(position.reserveContributionPPM),
        formatRaw(position.start),
        formatRaw(position.cooldown),
        formatRaw(position.expiration),
        formatRaw(position.challengedAmount),
        status.key,
        position.transactionHash ?? '',
        formatBlock(position.sourceBlock),
      ];
    });
    exportCsv(`imf-${currentCode().toLowerCase()}-dashboard-positions.csv`, ['code', 'position', 'owner', 'collateral', 'collateralDecimals', 'mintedRaw', 'collateralBalanceRaw', 'liquidationPriceRaw', 'priceDecimals', 'reservePPM', 'start', 'cooldown', 'expiration', 'challengedRaw', 'status', 'transactionHash', 'sourceBlock'], rows);
  }

  function openPositionDrawer(position) {
    const status = positionStatus(position);
    const content = `
      <div class="dash-drawer-section"><h4>Current state</h4>${metricList([
        ['Position', position.address],
        ['Owner', position.owner],
        ['Created by', position.createdBy ?? 'Unknown'],
        ['Collateral', `${position.collateral?.name ?? position.collateral?.symbol ?? 'Unknown'} · ${position.collateral?.decimals ?? 'unknown'} decimals`],
        ['Collateral balance', formatAmount(position.collateral?.balance, position.collateral?.decimals ?? 18, position.collateral?.symbol ?? '')],
        ['Gross minted debt', formatAmount(position.minted, 18, currentSymbol())],
        ['Family minting capacity', formatAmount(position.availableForMinting, 18, currentSymbol())],
        ['Stored liquidation price', formatAmount(position.price, position.priceDecimals ?? 18, `${currentSymbol()} / ${position.collateral?.symbol ?? 'collateral'}`)],
        ['Reserve contribution', formatPPM(position.reserveContributionPPM)],
        ['Annual interest', formatPPM(position.annualInterestPPM)],
        ['Start', formatTimestamp(position.start)],
        ['Cooldown ends', formatTimestamp(position.cooldown)],
        ['Expiration', formatTimestamp(position.expiration)],
        ['Challenged collateral', formatAmount(position.challengedAmount, position.collateral?.decimals ?? 18, position.collateral?.symbol ?? '')],
        ['Closed', String(position.closed)],
        ['Expired', String(position.expired)],
        ['Status', status.label],
        ['Source block', formatBlock(position.sourceBlock)],
      ])}</div>
      <div class="dash-drawer-section"><h4>Evidence</h4><p class="smalltext">Opening transaction: ${escapeHtml(position.transactionHash ?? 'Unavailable')} ${txLink(position.transactionHash)}</p><p class="smalltext">The event identifies discovery. Current contract state is shown above and is not inferred from the event.</p></div>
      <div class="dash-drawer-section"><h4>Watch boundary</h4><div class="dash-note">The dashboard CR threshold is a user watch setting. It is not a V2 protocol floor and does not replace this position’s stored liquidation price.</div></div>`;
    openDrawer('Position detail', position.address, content);
  }

  function openDrawer(title, subtitle, html) {
    if (!drawer) return;
    $('#dashboard-drawer-title', drawer).textContent = title;
    $('#dashboard-drawer-subtitle', drawer).textContent = subtitle;
    $('#dashboard-drawer-body', drawer).innerHTML = html;
    drawer.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => { drawer.classList.add('open'); backdrop.classList.add('open'); });
    $('#dashboard-drawer-close', drawer)?.focus();
  }

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => { drawer.hidden = true; backdrop.hidden = true; }, 180);
  }

  function renderMarkets() {
    if (state.discoveryPending) {
      setPanelHtml('markets', `<div class="dash-stack">${unavailableCard('Market inputs are still being discovered', 'Contract liquidation boundaries will appear after verified position discovery completes. Reference marks remain unavailable without a market/indexer feed.')}${sourceNote()}</div>`);
      return;
    }
    if (state.discovery?.error) {
      setPanelHtml('markets', `<div class="dash-stack">${unavailableCard('Market inputs are unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const reference = getReferenceMarks();
    const rows = allPositions().map((position) => `<tr><td><button type="button" class="btn light small" data-position-detail="${escapeHtml(position.address)}">${escapeHtml(position.address.slice(0, 10))}…</button></td><td>${escapeHtml(position.collateral?.symbol ?? 'Unknown')}</td><td class="num mono">${formatAmount(position.price, position.priceDecimals ?? 18, `${currentSymbol()} / ${position.collateral?.symbol ?? 'collateral'}`)}</td><td>${statusPill('neutral', 'Reference unavailable')}</td><td>${unavailableCard('No verified mark', 'No market/indexer feed is configured.')}</td></tr>`).join('');
    setPanelHtml('markets', `
      <div class="dash-stack">
        <div class="dash-kpis">
          ${metricCard('Protocol liquidation prices', String(allPositions().length), 'Current contract reads from discovered positions', 'pass')}
          ${metricCard('Reference marks', 'Unavailable', reference.reason, 'fail')}
          ${metricCard('Price history', 'Unavailable', 'Historical market data requires an indexer.', 'fail')}
          ${metricCard('Volume / depth', 'Unavailable', 'No verified market feed is configured.', 'fail')}
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Contract liquidation boundaries</h3><p>These are stored position parameters, not external oracle prices.</p></div></div>${allPositions().length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Position</th><th>Collateral</th><th class="num">Liquidation price</th><th>Reference mark</th><th>Feed</th></tr></thead><tbody>${rows}</tbody></table></div>` : unavailableCard('No positions discovered', 'Contract liquidation boundaries require real discovered positions.')}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Reference markets</h3><p>Barkswap or reference-pool analytics would be inputs, not protocol prices.</p></div></div>${unavailableCard('Reference marks unavailable — market/indexer feed not configured', 'The dashboard does not interpolate prices, volume, depth or executable liquidity.')}<div class="dash-note">A future reference mark must identify source, pair, block/time and methodology before it can be shown.</div></article>
        </div>
        ${sourceNote()}
      </div>`);
    $$('#dashboard-view [data-position-detail]', root).forEach((button) => button.addEventListener('click', () => {
      const position = allPositions().find((candidate) => sameAddress(candidate.address, button.dataset.positionDetail));
      if (position) openPositionDrawer(position);
    }));
  }

  function scenarioCr(position) {
    const bips = positionCollateralRatio(position);
    if (bips === null) return null;
    return bips * BigInt(100 + state.scenario.collateral) * BigInt(100 - state.scenario.liquidity) / (BigInt(100 + state.scenario.fx) * 10000n);
  }

  function scenarioPositions() {
    return allPositions().map((position) => ({ position, cr: scenarioCr(position), status: positionStatus(position) })).filter((entry) => entry.cr !== null);
  }

  function renderRisk() {
    if (state.discoveryPending) {
      setPanelHtml('risk', `<div class="dash-stack">${unavailableCard('Risk Lab inputs are still being discovered', 'Scenario controls will be available after verified position discovery completes. No position state is inferred during the scan.')}${sourceNote()}</div>`);
      return;
    }
    if (state.discovery?.error) {
      setPanelHtml('risk', `<div class="dash-stack">${unavailableCard('Risk Lab inputs are unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const entries = scenarioPositions().sort((left, right) => left.cr === right.cr ? 0 : left.cr < right.cr ? -1 : 1);
    const affected = entries.filter((entry) => entry.cr < BigInt(state.scenario.threshold * 100));
    const rows = affected.slice(0, 10).map((entry) => `<tr><td><button type="button" class="btn light small" data-position-detail="${escapeHtml(entry.position.address)}">${escapeHtml(entry.position.address.slice(0, 10))}…</button></td><td>${escapeHtml(entry.position.collateral?.symbol ?? 'Unknown')}</td><td class="num mono">${sdk().formatDecimal(entry.cr, 2)}%</td><td class="num mono">${formatAmount(entry.position.minted, 18, currentSymbol())}</td><td>${statusPill(entry.status.status, entry.status.label)}</td></tr>`).join('');
    setPanelHtml('risk', `
      <div class="dash-stack">
        <div class="dash-grid">
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>Scenario controls</h3><p>Reprice discovered positions without changing contract state.</p></div>${statusPill('warn', 'SCENARIO ONLY')}</div>
            <div class="dash-actions">${['moderate', 'severe', 'depeg', 'reset'].map((preset) => `<button type="button" class="btn light small" data-risk-preset="${preset}">${preset[0].toUpperCase()}${preset.slice(1)}</button>`).join('')}</div>
            <div class="dash-range"><label for="dashboard-risk-collateral">Collateral price shock <output id="dashboard-risk-collateral-out">${state.scenario.collateral}%</output></label><input id="dashboard-risk-collateral" type="range" min="-60" max="20" step="1" value="${state.scenario.collateral}"><div class="range-ends"><span>-60%</span><span>+20%</span></div></div>
            <div class="dash-range"><label for="dashboard-risk-fx">Reference / FX shock <output id="dashboard-risk-fx-out">${state.scenario.fx}%</output></label><input id="dashboard-risk-fx" type="range" min="-30" max="30" step="1" value="${state.scenario.fx}"><div class="range-ends"><span>-30%</span><span>+30%</span></div></div>
            <div class="dash-range"><label for="dashboard-risk-liquidity">Liquidity haircut <output id="dashboard-risk-liquidity-out">${state.scenario.liquidity}%</output></label><input id="dashboard-risk-liquidity" type="range" min="0" max="70" step="1" value="${state.scenario.liquidity}"><div class="range-ends"><span>0%</span><span>70%</span></div></div>
            <div class="dash-range"><label for="dashboard-risk-threshold">User CR watch threshold <output id="dashboard-risk-threshold-out">${state.scenario.threshold}%</output></label><input id="dashboard-risk-threshold" type="range" min="100" max="250" step="5" value="${state.scenario.threshold}"><div class="range-ends"><span>100%</span><span>250%</span></div></div>
            <div class="dash-note danger">${state.scenario.threshold}% is a user watch setting, not a V2 protocol floor. Contract boundaries remain each position’s stored liquidation price.</div>
            <button type="button" class="btn light" id="dashboard-scenario-export" style="width:100%">Download scenario JSON</button>
          </article>
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Scenario impact</h3><p>${escapeHtml(scenarioLabel())}</p></div>${statusPill('warn', 'SCENARIO')}</div><div class="dash-kpis">${metricCard('Positions evaluated', String(entries.length), 'Real discovered positions', 'pass')}${metricCard('Below watch threshold', String(affected.length), `Stressed CR < ${state.scenario.threshold}%`, affected.length ? 'warn' : 'pass')}${metricCard('Critical below 100%', String(entries.filter((entry) => entry.cr < 10000n).length), 'Scenario classification', 'pass')}${metricCard('Missing CR inputs', String(allPositions().length - entries.length), 'Unavailable inputs are excluded', allPositions().length - entries.length ? 'warn' : 'pass')}</div>${entries.length ? riskScatter(entries) : unavailableCard('No scenario points', 'No discovered positions have enough collateral, price and debt data for a scenario CR.')}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Most affected positions</h3><p>Ranked by stressed collateral ratio below the user watch threshold.</p></div></div>${affected.length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Position</th><th>Collateral</th><th class="num">Scenario CR</th><th class="num">Gross debt</th><th>Current status</th></tr></thead><tbody>${rows}</tbody></table></div>` : unavailableCard('No affected positions', 'No scenario CR is below the current user watch threshold.')}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Assumptions</h3><p>What this scenario does and does not represent.</p></div></div><div class="dash-formula">scenario CR = collateral balance × liquidation price × collateral shock × (1 − liquidity haircut) ÷ (gross debt × reference shock)</div><div class="dash-note" style="margin-top:12px">No auction slippage, keeper latency, token-transfer restriction, transaction simulation or cross-currency contagion is inferred.</div></article>
        </div>
        ${sourceNote()}
      </div>`);
    bindRisk();
  }

  function scenarioLabel() {
    if (state.scenario.preset === 'severe') return 'Severe collateral and liquidity stress scenario.';
    if (state.scenario.preset === 'depeg') return 'Reference/FX stress scenario.';
    if (state.scenario.preset === 'reset') return 'Neutral scenario with the user watch threshold retained.';
    return 'Moderate collateral stress scenario across discovered positions.';
  }

  function riskScatter(entries) {
    const width = 700;
    const height = 250;
    const margin = { left: 52, right: 18, top: 16, bottom: 42 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxCr = BigInt(Math.max(300, state.scenario.threshold + 50));
    const maxDebt = entries.reduce((max, entry) => bigintOrNull(entry.position.minted) > max ? bigintOrNull(entry.position.minted) : max, 1n);
    const points = entries.map((entry, index) => {
      const x = margin.left + scaleRatio(entry.cr, maxCr * 10000n) * innerWidth;
      const debt = bigintOrNull(entry.position.minted) ?? 0n;
      const y = margin.top + innerHeight - scaleRatio(debt, maxDebt) * innerHeight;
      const radius = 5 + index % 5;
      const color = entry.cr < 10000n ? '#ffcfd2' : entry.cr < BigInt(state.scenario.threshold * 100) ? '#e9c46a' : '#aee9d1';
      return `<circle class="point" tabindex="0" data-position-detail="${escapeHtml(entry.position.address)}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}" fill="${color}" fill-opacity=".78" stroke="#2b2118" stroke-opacity=".48"><title>${escapeHtml(entry.position.address)} · scenario CR ${sdk().formatDecimal(entry.cr, 2)}%</title></circle>`;
    }).join('');
    const thresholdX = margin.left + scaleRatio(BigInt(state.scenario.threshold * 100), maxCr * 10000n) * innerWidth;
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Scenario collateral ratio scatter chart">${[0, 1, 2, 3].map((line) => { const y = margin.top + line / 3 * innerHeight; return `<line class="grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"/><text x="${margin.left - 8}" y="${y + 3}" text-anchor="end" font-size="9">${axisValue(maxDebt, line)}</text>`; }).join('')}<line class="threshold" x1="${thresholdX.toFixed(2)}" y1="${margin.top}" x2="${thresholdX.toFixed(2)}" y2="${height - margin.bottom}"/><text x="${(thresholdX + 5).toFixed(2)}" y="${margin.top + 12}" font-size="9" fill="#b84a42">WATCH ${state.scenario.threshold}%</text>${points}<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="9">SCENARIO COLLATERAL RATIO</text></svg><div class="dash-legend"><span><i class="dash-swatch" style="background:#aee9d1"></i>Above watch</span><span><i class="dash-swatch" style="background:#e9c46a"></i>Watch</span><span><i class="dash-swatch" style="background:#ffcfd2"></i>Critical</span><span>Vertical axis = gross debt raw scale</span></div>`;
  }

  function bindRisk() {
    $$('#dashboard-view [data-risk-preset]', root).forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.riskPreset;
      state.scenario.preset = preset;
      if (preset === 'moderate') Object.assign(state.scenario, { collateral: -20, fx: 0, liquidity: 15 });
      if (preset === 'severe') Object.assign(state.scenario, { collateral: -45, fx: -10, liquidity: 35 });
      if (preset === 'depeg') Object.assign(state.scenario, { collateral: 0, fx: -25, liquidity: 20 });
      if (preset === 'reset') Object.assign(state.scenario, { collateral: 0, fx: 0, liquidity: 0 });
      renderRisk();
    }));
    const bindings = [['dashboard-risk-collateral', 'collateral'], ['dashboard-risk-fx', 'fx'], ['dashboard-risk-liquidity', 'liquidity'], ['dashboard-risk-threshold', 'threshold']];
    for (const [id, key] of bindings) {
      $(`#${id}`, root)?.addEventListener('input', (event) => {
        state.scenario[key] = Number(event.target.value);
        state.scenario.preset = 'custom';
        updateRiskOutputs();
      });
    }
    $('#dashboard-scenario-export', root)?.addEventListener('click', exportScenario);
    $$('#dashboard-view [data-position-detail]', root).forEach((button) => button.addEventListener('click', () => {
      const position = allPositions().find((candidate) => sameAddress(candidate.address, button.dataset.positionDetail));
      if (position) openPositionDrawer(position);
    }));
  }

  function updateRiskOutputs() {
    $('#dashboard-risk-collateral-out', root) && ($('#dashboard-risk-collateral-out', root).textContent = `${state.scenario.collateral}%`);
    $('#dashboard-risk-fx-out', root) && ($('#dashboard-risk-fx-out', root).textContent = `${state.scenario.fx}%`);
    $('#dashboard-risk-liquidity-out', root) && ($('#dashboard-risk-liquidity-out', root).textContent = `${state.scenario.liquidity}%`);
    $('#dashboard-risk-threshold-out', root) && ($('#dashboard-risk-threshold-out', root).textContent = `${state.scenario.threshold}%`);
    renderRisk();
  }

  function exportScenario() {
    exportJson(`imf-${currentCode().toLowerCase()}-dashboard-scenario.json`, {
      schema: 'imf.dashboard-scenario.v1',
      executionEnabled: false,
      kind: 'scenario',
      code: currentCode(),
      registry: getCapabilities().registry,
      assumptions: {
        collateralShockPercent: state.scenario.collateral,
        referenceShockPercent: state.scenario.fx,
        liquidityHaircutPercent: state.scenario.liquidity,
        userWatchThresholdPercent: state.scenario.threshold,
        formula: 'scenario CR = collateral balance × liquidation price × collateral shock × (1 − liquidity haircut) ÷ (gross debt × reference shock)',
      },
      provenance: {
        discovery: state.discovery ? { fromBlock: state.discovery.fromBlock ?? null, toBlock: state.discovery.toBlock ?? null, complete: state.discovery.complete ?? null, account: state.discovery.account ?? null, warnings: state.discovery.warnings ?? [] } : null,
        generatedAt: new Date().toISOString(),
      },
      positions: scenarioPositions().map((entry) => ({
        address: entry.position.address,
        owner: entry.position.owner,
        collateralSymbol: entry.position.collateral?.symbol ?? null,
        collateralDecimals: entry.position.collateral?.decimals ?? null,
        mintedRaw: formatRaw(entry.position.minted),
        collateralBalanceRaw: formatRaw(entry.position.collateral?.balance),
        liquidationPriceRaw: formatRaw(entry.position.price),
        priceDecimals: entry.position.priceDecimals ?? null,
        scenarioCRPercent: sdk().formatDecimal(entry.cr, 2),
        sourceBlock: entry.position.sourceBlock ?? null,
      })),
    });
  }

  function renderActivity() {
    if (state.discovery?.error) {
      setPanelHtml('activity', `<div class="dash-stack">${unavailableCard('Activity discovery is unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const events = state.discovery?.events ?? [];
    const eventRows = events.slice(0, 30).map((event) => `<div class="dash-event"><div class="dash-event-icon">${escapeHtml(event.type === 'challenge-started' ? 'CH' : 'PO')}</div><div><strong>${escapeHtml(event.label)}</strong><small>${escapeHtml(event.summary)}<br>${escapeHtml(event.transactionHash ?? '')}</small></div><div class="event-amount">${txLink(event.transactionHash)}<small>block ${escapeHtml(String(event.blockNumber ?? 'unknown'))}</small></div></div>`).join('');
    setPanelHtml('activity', `
      <div class="dash-stack">
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Challenge replay</h3><p>Uses actual challenge timestamps and period data when available.</p></div><span class="status-pill warn">SCENARIO REPLAY</span></div>
            <div class="dash-toolbar"><label class="dash-field">Challenge index<input id="dashboard-challenge-index" inputmode="numeric" pattern="[0-9]+" value="0"></label><button type="button" class="btn mint" id="dashboard-load-challenge">Read challenge</button><button type="button" class="btn light" id="dashboard-replay-toggle">${state.replay.playing ? 'Pause' : 'Play'}</button><button type="button" class="btn light" id="dashboard-replay-reset">Reset</button></div>
            <div id="dashboard-challenge-panel">${challengeHtml()}</div>
          </article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Event coverage</h3><p>${escapeHtml(discoveryCoverageText())}</p></div></div>${metricList([
            ['Event types', state.discoveryPending ? 'Discovery in progress' : state.discovery?.synthetic ? 'Synthetic fixture' : 'PositionOpened · ChallengeStarted'],
            ['Events discovered', state.discoveryPending ? 'Read in progress' : String(events.length)],
            ['Account context', state.discovery?.account ?? 'Not supplied'],
            ['Complete / partial', state.discoveryPending ? 'Pending' : state.discovery ? String(state.discovery.complete ? 'Complete' : 'Partial') : 'Unknown'],
            ['History / volume', 'Unavailable — indexer not configured'],
          ])}<div class="dash-note">An inactive first challenge phase does not prove settlement completion. Reread contract state before drawing a conclusion.</div></article>
        </div>
        <div class="dash-card"><div class="dash-card-head"><div><h3>Protocol event ledger</h3><p>Real discovered events with transaction hashes. No generated event rows are shown.</p></div></div>${events.length ? `<div class="dash-event-list">${eventRows}</div>` : unavailableCard(state.discoveryPending ? 'Event discovery is in progress' : 'No real events discovered', state.discoveryPending ? 'The dashboard is scanning verified events. No zero or empty event history is asserted yet.' : state.discovery?.synthetic ? 'The synthetic fixture has no deployed event history.' : 'The scanned range contains no matching events, or discovery coverage is incomplete.')}</div>
        ${sourceNote()}
      </div>`);
    bindActivity();
  }

  function challengeHtml() {
    if (!state.challenge) return unavailableCard('No challenge selected', 'Read a challenge index to inspect its actual timestamps and current contract state.');
    if (state.challenge.error) return unavailableCard('Challenge read unavailable', state.challenge.error);
    const { challenge, positionState } = state.challenge;
    if (challenge.empty) return unavailableCard(`Challenge ${challenge.index.toString()} is empty`, 'An empty record is not evidence of a complete challenge history.');
    const progress = state.replay.progress;
    const replayTime = challenge.start + BigInt(Math.round(progress * 200)) * (challenge.period ?? 0n) / 10000n;
    const replayPrice = replayChallengePrice(challenge, positionState, replayTime);
    return `<div class="dash-stack"><div class="dash-kpis">${metricCard('Challenge start', formatTimestamp(challenge.start), 'Actual contract timestamp', 'pass')}${metricCard('First-phase deadline', challenge.deadline === null ? 'Unavailable' : formatTimestamp(challenge.deadline), 'Aversion boundary', 'pass')}${metricCard('Current contract price', formatAmount(challenge.currentPrice, positionState?.priceDecimals ?? 18, `${currentSymbol()} / ${positionState?.collateral?.symbol ?? 'collateral'}`), 'Current-state read', 'pass')}${metricCard('Replay price', formatAmount(replayPrice, positionState?.priceDecimals ?? 18, `${currentSymbol()} / ${positionState?.collateral?.symbol ?? 'collateral'}`), 'Scenario replay, not settlement', 'warn')}</div>${challengeReplaySvg(challenge, positionState)}<div class="dash-range"><label for="dashboard-replay-scrub">Replay progress <output id="dashboard-replay-scrub-out">${Math.round(progress * 100)}%</output></label><input id="dashboard-replay-scrub" type="range" min="0" max="100" step="1" value="${Math.round(progress * 100)}"><div class="range-ends"><span>Start</span><span>Two challenge periods</span></div></div>${metricList([['Position', challenge.position], ['Challenger', challenge.challenger], ['Challenge size', formatAmount(challenge.size, positionState?.collateral?.decimals ?? 18, positionState?.collateral?.symbol ?? '')], ['Phase', challenge.active ? 'Aversion window through first deadline' : 'First deadline passed; further state/events are required'], ['Replay timestamp', formatTimestamp(replayTime)], ['Source block', formatBlock(challenge.sourceBlock)]])}</div>`;
  }

  function replayChallengePrice(challenge, positionState, timestamp) {
    const start = bigintOrNull(challenge.start) ?? 0n;
    const period = bigintOrNull(challenge.period) ?? bigintOrNull(positionState?.challengePeriod) ?? 0n;
    const storedPrice = bigintOrNull(positionState?.price) ?? 0n;
    if (period === 0n || storedPrice === 0n) return null;
    if (timestamp <= start + period) return storedPrice;
    if (timestamp >= start + period * 2n) return 0n;
    return storedPrice * (start + period * 2n - timestamp) / period;
  }

  function challengeReplaySvg(challenge, positionState) {
    const width = 700;
    const height = 190;
    const margin = { left: 55, right: 18, top: 16, bottom: 35 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const price = bigintOrNull(positionState?.price) ?? 0n;
    const points = Array.from({ length: 41 }, (_, index) => {
      const progress = index / 40;
      const timestamp = challenge.start + BigInt(index) * (challenge.period ?? 0n) * 2n / 40n;
      const value = replayChallengePrice(challenge, positionState, timestamp) ?? 0n;
      const x = margin.left + progress * innerWidth;
      const y = margin.top + innerHeight - scaleRatio(value, price || 1n) * innerHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    const progressX = margin.left + state.replay.progress * innerWidth;
    const currentPrice = replayChallengePrice(challenge, positionState, challenge.start + BigInt(Math.round(state.replay.progress * 200)) * (challenge.period ?? 0n) / 10000n) ?? 0n;
    const currentY = margin.top + innerHeight - scaleRatio(currentPrice, price || 1n) * innerHeight;
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Challenge price replay chart"><line class="grid-line" x1="${margin.left}" y1="${margin.top}" x2="${width - margin.right}" y2="${margin.top}"/><line class="grid-line" x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${width - margin.right}" y2="${margin.top + innerHeight}"/><polyline points="${points}" fill="none" stroke="#2b2118" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><line class="threshold" x1="${progressX.toFixed(2)}" y1="${margin.top}" x2="${progressX.toFixed(2)}" y2="${margin.top + innerHeight}"/><circle cx="${progressX.toFixed(2)}" cy="${currentY.toFixed(2)}" r="5" fill="#82fe89" stroke="#2b2118"/><text x="${margin.left}" y="${height - 10}" font-size="9">START</text><text x="${width - margin.right}" y="${height - 10}" text-anchor="end" font-size="9">TWO PERIODS</text></svg>`;
  }

  function bindActivity() {
    $('#dashboard-load-challenge', root)?.addEventListener('click', async () => {
      const input = $('#dashboard-challenge-index', root);
      const index = bigintOrNull(input?.value ?? '0') ?? 0n;
      state.challenge = await getChallenge(currentCode(), index);
      state.replay.progress = 0;
      stopReplay();
      renderActivity();
    });
    $('#dashboard-replay-toggle', root)?.addEventListener('click', () => {
      if (state.replay.playing) stopReplay();
      else startReplay();
      renderActivity();
    });
    $('#dashboard-replay-reset', root)?.addEventListener('click', () => { state.replay.progress = 0; stopReplay(); renderActivity(); });
    $('#dashboard-replay-scrub', root)?.addEventListener('input', (event) => {
      state.replay.progress = Number(event.target.value) / 100;
      const output = $('#dashboard-replay-scrub-out', root);
      if (output) output.textContent = `${event.target.value}%`;
      const panel = $('#dashboard-challenge-panel', root);
      if (panel) panel.innerHTML = challengeHtml();
      bindActivity();
    });
  }

  function startReplay() {
    stopReplay();
    state.replay.playing = true;
    state.replay.timer = setInterval(() => {
      state.replay.progress = Math.min(1, state.replay.progress + 0.01);
      if (state.replay.progress >= 1) stopReplay();
      const panel = $('#dashboard-challenge-panel', root);
      if (panel) panel.innerHTML = challengeHtml();
      bindActivity();
    }, 60);
  }

  function stopReplay() {
    if (state.replay.timer) clearInterval(state.replay.timer);
    state.replay.timer = null;
    state.replay.playing = false;
  }

  function renderParameters() {
    const capabilities = getCapabilities();
    const registry = currentInstance();
    if (!capabilities.verified || !registry) {
      setPanelHtml('parameters', `<div class="dash-stack">${unavailableCard('Parameters unavailable', 'Configure and verify a V2 registry before comparing current and initial parameters.')} ${sourceNote()}</div>`);
      return;
    }
    const token = section(state.system, 'token');
    const savings = section(state.system, 'savings');
    const bridge = section(state.system, 'bridge');
    const equity = section(state.system, 'equity');
    const currentPanel = state.parametersTab === 'current'
      ? `<div class="dash-param-grid">${[
          ['Currency token', token?.error ? 'Unavailable' : `${token?.name ?? 'Unavailable'} (${token?.symbol ?? '—'})`, token?.error ?? formatBlock(token?.sourceBlock)],
          ['Current leadrate', savings?.error ? 'Unavailable' : formatPPM(savings?.currentRatePPM), savings?.error ?? formatBlock(savings?.sourceBlock)],
          ['Pending leadrate', savings?.error ? 'Unavailable' : savings?.rateChangePending ? formatPPM(savings?.nextRatePPM) : 'No pending change', savings?.error ?? 'Pending is not current'],
          ['Token supply', token?.error ? 'Unavailable' : formatAmount(token?.totalSupply, 18, token?.symbol ?? currentSymbol()), token?.error ?? 'Current on-chain read'],
          ['Minter reserve', token?.error ? 'Unavailable' : formatAmount(token?.minterReserve, 18, token?.symbol ?? currentSymbol()), token?.error ?? 'Current on-chain read'],
          ['System equity', equity?.error ? 'Unavailable' : formatAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol()), equity?.error ?? formatBlock(equity?.sourceBlock)],
          ['Bridge limit', bridge?.error ? 'Unavailable' : formatAmount(bridge?.limitLocal, 18, token?.symbol ?? currentSymbol()), bridge?.error ?? 'Current on-chain read'],
          ['Bridge minted', bridge?.error ? 'Unavailable' : formatAmount(bridge?.mintedLocal, 18, token?.symbol ?? currentSymbol()), bridge?.error ?? 'Current on-chain read'],
          ['Pool-share price', equity?.error ? 'Unavailable' : formatAmount(equity?.sharePrice, 18, token?.symbol ?? currentSymbol()), equity?.error ?? 'Current on-chain read'],
        ].map(([label, value, note]) => `<div class="dash-param"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><p>${escapeHtml(note ?? '')}</p></div>`).join('')}</div>`
      : state.parametersTab === 'registry'
        ? `<div class="dash-address-list">${Object.entries(registry.addresses).map(([label, address]) => `<div class="dash-address-row"><span>${escapeHtml(label)}</span><code>${escapeHtml(address)}</code><a class="btn light small" href="${escapeHtml(`${currentExplorer().replace(/\/$/, '')}/address/${address}`)}" target="_blank" rel="noreferrer">Explorer</a></div>`).join('')}</div><div class="dash-note" style="margin-top:14px">The USD registry has eight Sourcify exact creation/runtime matches. Blockscout display verification remains an external blocker and is not represented as complete here.</div>`
        : `<div class="dash-stack">${READINESS_GATES.map(([label, description], index) => `<div class="unavailable-card"><strong>${index + 1}. ${escapeHtml(label)}</strong><p>${escapeHtml(description)}</p></div>`).join('')}</div>`;
    setPanelHtml('parameters', `
      <div class="dash-stack">
        <div class="dash-card"><div class="dash-card-head"><div><h3>System parameters</h3><p>Current on-chain values, registry evidence and repository-owned readiness gates.</p></div></div><div class="dash-tabs" role="tablist" aria-label="Parameter views">${[['current', 'Current values'], ['registry', 'USD registry'], ['gates', 'Readiness gates']].map(([key, label]) => `<button type="button" role="tab" data-parameter-tab="${key}" class="${state.parametersTab === key ? 'active' : ''}" aria-selected="${state.parametersTab === key}">${label}</button>`).join('')}</div>${currentPanel}</div>
        ${sourceNote()}
      </div>`);
    $$('#dashboard-view [data-parameter-tab]', root).forEach((button) => button.addEventListener('click', () => { state.parametersTab = button.dataset.parameterTab; renderParameters(); }));
  }

  async function renderActivePanel() {
    renderSourceStatus();
    if (state.panel === 'overview') renderOverview();
    if (state.panel === 'collateral') renderCollateral();
    if (state.panel === 'positions') renderPositions();
    if (state.panel === 'markets') renderMarkets();
    if (state.panel === 'risk') renderRisk();
    if (state.panel === 'activity') renderActivity();
    if (state.panel === 'parameters') renderParameters();
  }

  async function loadBundle(force = false) {
    const nonce = ++state.nonce;
    const code = currentCode();
    state.code = code;
    if (!force && state.system && !state.system.error && state.discovery && !state.discovery.error && !state.discoveryPending && state.system.code === code && state.discovery.code === code) {
      await renderActivePanel();
      return;
    }
    const account = normalizedAccount();
    state.discovery = null;
    state.discoveryPending = true;
    state.challenge = null;
    stopReplay();
    const systemPromise = getSystemSnapshot(code);
    const discoveryPromise = getDiscoveredPositions(code, { account });
    const system = await systemPromise;
    if (nonce !== state.nonce) return;
    state.system = system;
    await renderActivePanel();
    try {
      const discovery = await discoveryPromise;
      if (nonce !== state.nonce) return;
      state.discovery = discovery;
    } finally {
      if (nonce === state.nonce) {
        state.discoveryPending = false;
        await renderActivePanel();
      }
    }
  }

  async function render(force = false) {
    if (!root || root.hidden) return;
    try {
      await loadBundle(force);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), true);
    }
  }

  function panelFromHash(hash = location.hash) {
    const clean = hash.replace(/^#\/?/, '');
    if (clean === 'dashboard') return 'overview';
    const match = clean.match(/^dashboard\/([a-z-]+)$/);
    return match && PANELS.includes(match[1]) ? match[1] : null;
  }

  function setPanel(panel, { updateHash = true } = {}) {
    if (!PANELS.includes(panel)) return;
    state.panel = panel;
    $$('.dashboard-nav [data-dashboard]', root).forEach((button) => {
      const active = button.dataset.dashboard === panel;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    PANELS.forEach((name) => {
      const target = panelRoot(name);
      if (target) target.hidden = name !== panel;
    });
    const target = panelRoot(panel);
    target?.setAttribute('tabindex', '-1');
    if (updateHash) history.replaceState(null, '', `#dashboard/${panel}`);
    render();
  }

  function activate(panel = panelFromHash() ?? 'overview') {
    setPanel(panel, { updateHash: false });
    if (!location.hash.startsWith('#dashboard')) history.replaceState(null, '', `#dashboard/${panel}`);
  }

  function init(options) {
    hooks = options;
    root = $('#dashboard-view');
    drawer = $('#dashboard-drawer');
    backdrop = $('#dashboard-drawer-backdrop');
    if (!root) return { activate, refresh: () => render(true), panelFromHash };
    $$('.dashboard-nav [data-dashboard]', root).forEach((button) => button.addEventListener('click', () => setPanel(button.dataset.dashboard)));
    backdrop?.addEventListener('click', closeDrawer);
    $('#dashboard-drawer-close', drawer)?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
    window.addEventListener('hashchange', () => {
      const panel = panelFromHash();
      if (panel && !root.hidden) setPanel(panel, { updateHash: false });
    });
    return { activate, refresh: () => render(true), panelFromHash };
  }

  window.IMF_DASHBOARD = { init, panelFromHash, PANELS };
})();
