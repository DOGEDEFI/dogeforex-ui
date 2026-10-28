(() => {
  'use strict';

  const PANELS = ['overview', 'collateral', 'positions', 'markets', 'risk', 'activity', 'parameters'];
  const PANEL_LABELS = {
    overview: 'Overview',
    collateral: 'Collateral',
    positions: 'Positions',
    markets: 'Markets & volume',
    risk: 'Risk Lab',
    activity: 'Activity',
    parameters: 'Parameters',
  };
  const PANEL_COPY = {
    overview: ['Protocol at a glance.', 'Independent currency systems. Verified current reads. No oracle prices used by the protocol.'],
    collateral: ['Collateral, without the fog.', 'Composition, concentration, liquidation parameters, bridge capacity and loss-absorption context.'],
    positions: ['Every position. One risk lens.', 'Search, sort and inspect discovered positions using their own liquidation boundaries.'],
    markets: ['Marks, volume and liquidity.', 'Reference analytics stay separate from contract liquidation prices. No oracle claims.'],
    risk: ['Stress the book.', 'Interactive collateral, reference and liquidity scenarios with position-level impact.'],
    activity: ['The public ledger, in motion.', 'Discovered position and challenge events, current-state verification and actual-timestamp replay.'],
    parameters: ['The system, parameter by parameter.', 'Current V2 reads, verified USD registry, data coverage and readiness gates.'],
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
    position: { search: '', collateral: 'ALL', status: 'ALL', health: 'ALL', maxCr: 10000, sort: 'collateralRatio', dir: 'asc', page: 1, perPage: 8 },
    activity: { type: 'all', sort: 'desc' },
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

  function formatCompactAmount(value, decimals = 18, symbol = '') {
    const raw = bigintOrNull(value);
    if (raw === null) return 'Unavailable';
    const formatted = sdk().formatDecimal(raw, decimals);
    const negative = formatted.startsWith('-');
    const [unsignedWhole, fraction = ''] = (negative ? formatted.slice(1) : formatted).split('.');
    const whole = unsignedWhole.replace(/^0+(?=\d)/, '');
    const shift = whole.length >= 10 ? 9 : whole.length >= 7 ? 6 : whole.length >= 4 ? 3 : 0;
    if (!shift) return `${formatted}${symbol ? ` ${symbol}` : ''}`;
    const digits = `${whole}${fraction}`.padEnd(whole.length + 1, '0');
    const point = whole.length - shift;
    const compact = `${negative ? '−' : ''}${digits.slice(0, point)}.${digits.slice(point, point + 1)}${shift === 9 ? 'B' : shift === 6 ? 'M' : 'K'}`;
    return `${compact}${symbol ? ` ${symbol}` : ''}`;
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

  function chartUnavailable(title, message, size = '') {
    return `<div class="dash-chart-unavailable ${size}" role="group" aria-label="${escapeHtml(title)}"><div><span class="unavailable-symbol" aria-hidden="true">—</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div></div>`;
  }

  function cardTag(label, tone = '') {
    return `<span class="dash-tag ${tone}">${escapeHtml(label)}</span>`;
  }

  function metricCard(label, value, sub = '', status = 'pass') {
    const long = String(value).length > 14 || value === 'Unavailable' ? 'long' : '';
    return `<div class="dash-kpi"><span>${escapeHtml(label)}</span><strong class="${long}">${escapeHtml(value)}</strong><small>${statusPill(status)} ${escapeHtml(sub)}</small></div>`;
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
      if (filter.health === 'healthy' && !['active', 'no-debt'].includes(status)) return false;
      if (filter.health === 'attention' && !['watch', 'critical'].includes(status)) return false;
      if (filter.health === 'challenged' && status !== 'challenged') return false;
      if (filter.health === 'initializing' && status !== 'initializing') return false;
      if (filter.health === 'expired' && status !== 'expired') return false;
      const ratio = positionCollateralRatio(position);
      if (filter.maxCr < 10000 && (ratio === null || ratio >= BigInt(filter.maxCr * 100))) return false;
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

  function jsonSafe(value) {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
    return value ?? null;
  }

  function exportCurrentView() {
    if (state.panel === 'positions') return exportPositionsCsv();
    if (state.panel === 'risk') return exportScenario();
    const common = {
      schema: 'imf.dashboard-view.v1',
      executionEnabled: false,
      panel: state.panel,
      code: currentCode(),
      registry: getCapabilities().registry,
      fixture: getCapabilities().fixture,
      generatedAt: new Date().toISOString(),
      provenance: {
        source: $('#dashboard-source-status', root)?.textContent ?? 'Unavailable',
        discovery: state.discovery ? { fromBlock: state.discovery.fromBlock ?? null, toBlock: state.discovery.toBlock ?? null, complete: state.discovery.complete ?? null, account: state.discovery.account ?? null, warnings: state.discovery.warnings ?? [] } : null,
      },
    };
    if (state.panel === 'activity') {
      exportJson(`imf-${currentCode().toLowerCase()}-dashboard-activity.json`, jsonSafe({ ...common, filter: state.activity, events: filteredEvents(), challenge: state.challenge }));
      return;
    }
    exportJson(`imf-${currentCode().toLowerCase()}-dashboard-${state.panel}.json`, jsonSafe({ ...common, system: state.system, positions: allPositions(), capabilities: getCapabilities().capabilities }));
  }

  async function copyViewLink() {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('textarea');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    notify('Dashboard view link copied. The link preserves the selected subview.');
  }

  function resetDashboard() {
    state.account = '';
    state.positionScope = 'all';
    state.position = { search: '', collateral: 'ALL', status: 'ALL', health: 'ALL', maxCr: 10000, sort: 'collateralRatio', dir: 'asc', page: 1, perPage: 8 };
    state.activity = { type: 'all', sort: 'desc' };
    state.scenario = { collateral: -20, fx: 0, liquidity: 15, threshold: 150, preset: 'moderate' };
    state.replay.progress = 0;
    stopReplay();
    render();
    notify('Dashboard filters and scenario controls reset. Verified reads were not changed.');
  }

  function panelRoot(name = state.panel) {
    return $(`#dashboard-${name}`, root);
  }

  function setPanelHtml(name, html) {
    const target = panelRoot(name);
    if (target) target.innerHTML = html;
  }

  function renderPageCopy(sourceBlock = null) {
    const copy = PANEL_COPY[state.panel] ?? PANEL_COPY.overview;
    const title = $('#view-title');
    const subtitle = $('#dashboard-page-subtitle', root);
    const snapshot = $('#dashboard-snapshot', root);
    if (title) title.textContent = copy[0];
    if (subtitle) subtitle.textContent = copy[1];
    if (snapshot) snapshot.innerHTML = `<b>${sourceBlock ? `BLOCK ${escapeHtml(sourceBlock.number)}` : 'CURRENT STATE'}</b><span>${sourceBlock ? escapeHtml(new Date(Number(sourceBlock.timestamp) * 1000).toISOString()) : 'Source block pending'}</span>`;
    const selector = $('#dashboard-currency', root);
    if (selector) selector.value = currentCode();
  }

  function syncCurrencyOptions() {
    const selector = $('#dashboard-currency', root);
    if (!selector) return;
    const verified = registryState()?.verified ?? new Map();
    selector.replaceChildren(...(window.IMF_CURRENCIES ?? []).map(({ code, name, symbol }) => {
      const option = document.createElement('option');
      option.value = code;
      option.disabled = !verified.get(code);
      option.textContent = `${symbol} — ${name}${verified.get(code) ? '' : ' · planning unavailable'}`;
      return option;
    }));
    selector.value = currentCode();
  }

  function renderSourceStatus() {
    syncCurrencyOptions();
    const capabilities = getCapabilities();
    const sourceBlock = sectionSource(state.system, ['token', 'bridge', 'savings', 'equity']) ?? state.discovery?.positions?.[0]?.sourceBlock ?? state.challenge?.challenge?.sourceBlock;
    const fresh = freshness(sourceBlock);
    const mode = capabilities.live ? 'LIVE USD' : capabilities.fixture ? 'SYNTHETIC FIXTURE' : capabilities.imported ? 'IMPORTED READ-ONLY' : capabilities.verified ? 'READ-ONLY' : 'UNCONFIGURED';
    renderPageCopy(sourceBlock);
    const provenance = $('#dashboard-provenance', root);
    if (provenance) {
      const label = capabilities.fixture ? 'SYNTHETIC FIXTURE' : capabilities.live ? 'VERIFIED LIVE READS' : capabilities.verified ? 'READ-ONLY REGISTRY' : 'REGISTRY UNCONFIGURED';
      provenance.querySelector('strong').textContent = label;
    }
    const target = $('#dashboard-source-status', root);
    if (!target) return;
    target.innerHTML = `
      <div><strong>${escapeHtml(currentCode())} · ${escapeHtml(capabilities.registry?.network ?? 'No registry')} · chain ${escapeHtml(capabilities.registry?.chainId ?? '—')}</strong><br><span>${escapeHtml(fresh.message)}</span></div>
      <div class="dash-actions">${statusPill(capabilities.live ? 'pass' : capabilities.fixture ? 'warn' : 'info', mode)}${statusPill(fresh.status, fresh.label)}</div>`;
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

  function readContext(read, fallback = 'Current read') {
    if (read?.error) return read.error;
    return read?.sourceBlock ? `${fallback} · block ${read.sourceBlock.number}` : 'Source block unavailable';
  }

  function systemMap(token, bridge, savings, equity, positionCount) {
    const symbol = token?.symbol ?? currentSymbol();
    return `<div class="dash-system-map" role="group" aria-label="${escapeHtml(`${symbol} currency system at a glance`)}">
      <div class="dash-system-flow">
        <div class="dash-system-node collateral"><span class="dash-node-symbol">T</span><span>Collateral positions</span><strong>${escapeHtml(positionCount)}</strong><small>Discovered, with coverage shown below</small></div>
        <span class="dash-system-arrow" aria-hidden="true">→</span>
        <div class="dash-system-node hub"><span class="dash-node-symbol">K9</span><span>${escapeHtml(symbol)} minting hub</span><strong>${escapeHtml(token?.error ? 'Unavailable' : formatAmount(token?.totalSupply, 18, symbol))}</strong><small>Current token supply</small></div>
        <span class="dash-system-arrow" aria-hidden="true">↔</span>
        <div class="dash-system-node equity"><span class="dash-node-symbol">E</span><span>Equity reserve</span><strong>${escapeHtml(equity?.error ? 'Unavailable' : formatAmount(equity?.equityAmount, 18, symbol))}</strong><small>Current system equity</small></div>
      </div>
      <div class="dash-system-lower"><span>Savings <strong>${escapeHtml(savings?.error ? 'Unavailable' : formatPPM(savings?.currentRatePPM))}</strong></span><span>Bridge capacity <strong>${escapeHtml(bridge?.error ? 'Unavailable' : formatAmount(bridge?.capacityLocal, 18, symbol))}</strong></span><span>Pool shares <strong>${escapeHtml(equity?.error ? 'Unavailable' : formatAmount(equity?.totalShares, 18, 'shares'))}</strong></span></div>
    </div>`;
  }

  function bridgeUtilization(bridge, symbol) {
    const limit = bigintOrNull(bridge?.limitLocal);
    const minted = bigintOrNull(bridge?.mintedLocal);
    if (bridge?.error || limit === null || minted === null || limit <= 0n || minted < 0n) {
      return unavailableCard('Bridge utilization unavailable', bridge?.error ?? 'A positive verified bridge limit and current minted amount are required.');
    }
    const basisPoints = minted * 10000n / limit;
    const bounded = basisPoints < 0n ? 0n : basisPoints > 10000n ? 10000n : basisPoints;
    const percentage = `${sdk().formatDecimal(basisPoints, 2)}%`;
    return `<div class="dash-utilization"><div><span>Bridge utilization</span><strong>${escapeHtml(percentage)}</strong></div><div class="dash-progress" role="progressbar" aria-label="Bridge minted relative to limit" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(bounded) / 100}" aria-valuetext="${escapeHtml(percentage)} utilized"><i style="width:${Number(bounded) / 100}%"></i></div><div class="dash-utilization-labels"><span>Minted ${escapeHtml(formatAmount(minted, 18, symbol))}</span><span>Limit ${escapeHtml(formatAmount(limit, 18, symbol))}</span></div></div>`;
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
    const positionCount = state.discoveryPending ? 'Read in progress' : state.discovery?.error ? 'Unavailable' : String(allPositions().length);
    const debt = discoveredDebt();
    const weightedRatio = weightedCollateralRatio();
    const kpis = [
      metricCard('Token supply', token?.error ? 'Unavailable' : formatCompactAmount(token?.totalSupply, 18, token?.symbol ?? currentSymbol()), readContext(token), token?.error ? 'fail' : 'pass'),
      metricCard('Gross position debt', debt === null ? 'Unavailable' : formatCompactAmount(debt, 18, currentSymbol()), state.discovery?.error ?? discoveryCoverageText(), debt === null ? 'fail' : 'pass'),
      metricCard('System equity', equity?.error ? 'Unavailable' : formatCompactAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol()), readContext(equity), equity?.error ? 'fail' : 'pass'),
      metricCard('Debt-weighted CR', weightedRatio === null ? 'Unavailable' : `${sdk().formatDecimal(weightedRatio, 1)}%`, 'Stored liquidation parameters · not a market valuation', weightedRatio === null ? 'neutral' : 'pass'),
      metricCard('Discovered positions', positionCount, state.discovery?.error ?? discoveryCoverageText(), state.discoveryPending ? 'info' : state.discovery?.error ? 'fail' : 'pass'),
    ].join('');
    setPanelHtml('overview', `
      <div class="dash-stack">
        <div class="dash-kpis">${kpis}</div>
        <div class="dash-grid">
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Capital structure over time</h3><p>Collateral value, minted debt and system equity require source-pinned historical snapshots.</p></div>${cardTag('INDEXER REQUIRED')}</div>${chartUnavailable('History unavailable — indexer not configured', history.reason, 'tall')}</article>
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>Collateral composition</h3><p>Discovered position count by collateral asset.</p></div>${cardTag('CURRENT DISCOVERY', 'mint')}</div>${collateralComposition()}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Currency system accounting</h3><p>One independent ${escapeHtml(currentSymbol())} system. No shared reserve or automatic FX conversion.</p></div>${cardTag('LIVE CONTRACT READS', 'mint')}</div>${systemMap(token, bridge, savings, equity, positionCount)}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Reserve health</h3><p>Debt-weighted contract-parameter CR and current bridge utilization.</p></div>${cardTag('NOT A CREDIT RATING', 'gold')}</div>${reserveHealth()}${bridgeUtilization(bridge, token?.symbol ?? currentSymbol())}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Position risk constellation</h3><p>Gross debt versus each position’s liquidation-parameter CR.</p></div>${cardTag('CLICK A BUBBLE')}</div>${currentPositionScatter()}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>CR distribution</h3><p>Discovered position count by collateral-ratio bucket.</p></div>${cardTag(`WATCH < ${state.scenario.threshold}%`, 'gold')}</div>${crDistribution()}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Issuance & repayment flow</h3><p>Mint, repay and bridge volume cannot be reconstructed from current balances.</p></div>${cardTag('NO GENERATED VOLUME', 'gold')}</div>${chartUnavailable('Flow history unavailable', 'A real event indexer and complete coverage are required before volumes or historical flows can be shown.', 'tall')}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Current accounting snapshot</h3><p>Separate current reads, not an inferred supply-allocation flow.</p></div>${cardTag('SOURCE-BLOCK PINNED')}</div>${metricList(systemOverviewRows())}</article>
        </div>
        ${sourceNote()}
      </div>`);
    bindPositionPoints();
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

  function discoveredDebt() {
    if (state.discoveryPending || state.discovery?.error) return null;
    return allPositions().reduce((sum, position) => sum + (bigintOrNull(position.minted) ?? 0n), 0n);
  }

  function collateralComposition() {
    if (state.discoveryPending) return chartUnavailable('Composition read in progress', 'Collateral groups appear after event discovery and current-state verification complete.');
    if (state.discovery?.error) return chartUnavailable('Composition unavailable', state.discovery.error);
    const groups = collateralGroups();
    if (!groups.length) return chartUnavailable('No collateral composition discovered', 'No verified positions matched the current discovery coverage.', 'short');
    const colors = ['#f7b500', '#bde0fe', '#cdb4db', '#ffd6a5', '#aee9d1', '#ffcfd2'];
    const total = groups.reduce((sum, group) => sum + group.positions, 0);
    let offset = 0;
    const circles = groups.map((group, index) => {
      const share = group.positions / total * 100;
      const circle = `<circle cx="80" cy="80" r="54" fill="none" stroke="${colors[index % colors.length]}" stroke-width="25" pathLength="100" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${escapeHtml(group.symbol)}: ${group.positions} of ${total} positions</title></circle>`;
      offset += share;
      return circle;
    }).join('');
    return `<div class="dash-donut-layout"><svg class="dash-svg" viewBox="0 0 160 160" role="img" aria-label="Collateral composition by discovered position count">${circles}<text class="dash-donut-center" x="80" y="79" text-anchor="middle">${total}</text><text class="dash-donut-sub" x="80" y="96" text-anchor="middle">POSITIONS</text></svg><div class="dash-donut-legend">${groups.map((group, index) => `<div><i class="dash-swatch" style="background:${colors[index % colors.length]}"></i><span>${escapeHtml(group.symbol)}<small>${group.positions} discovered</small></span><b>${(group.positions / total * 100).toFixed(1)}%</b></div>`).join('')}</div></div><p class="smalltext">Share of discovered position count, not collateral market value. No FX or reference-price assumption is used.</p>`;
  }

  function weightedCollateralRatio() {
    if (state.discoveryPending || state.discovery?.error) return null;
    let weightedValue = 0n;
    let debt = 0n;
    for (const position of allPositions()) {
      const positionDebt = bigintOrNull(position.minted) ?? 0n;
      const collateral = bigintOrNull(position.collateral?.balance);
      const price = bigintOrNull(position.price);
      if (positionDebt > 0n && collateral !== null && price !== null) {
        weightedValue += collateral * price;
        debt += positionDebt;
      }
    }
    return debt > 0n ? weightedValue * 10000n / debt / 10n ** 18n : null;
  }

  function reserveHealth() {
    if (state.discoveryPending) return chartUnavailable('Reserve health read in progress', 'Position-level contract parameters are still being verified.', 'short');
    if (state.discovery?.error) return chartUnavailable('Reserve health unavailable', state.discovery.error, 'short');
    const ratio = weightedCollateralRatio();
    if (ratio === null) return chartUnavailable('Debt-weighted CR unavailable', 'No discovered position has the debt, collateral and liquidation-price inputs required for this ratio.', 'short');
    const bounded = Number(ratio > 25000n ? 25000n : ratio) / 250;
    return `<div class="dash-gauge-wrap"><svg class="dash-svg" viewBox="0 0 200 120" role="img" aria-label="Debt-weighted liquidation-parameter collateral ratio ${escapeHtml(sdk().formatDecimal(ratio, 2))} percent"><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#f3ecdf" stroke-width="20" stroke-linecap="round" pathLength="100"/><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#aee9d1" stroke-width="20" stroke-linecap="round" pathLength="100" stroke-dasharray="${bounded} 100"/></svg><div class="dash-gauge-value"><b>${escapeHtml(sdk().formatDecimal(ratio, 1))}%</b><span>DEBT-WEIGHTED CR</span></div></div>${metricList([['Method', 'Collateral × stored liquidation price ÷ gross debt'], ['Discovered positions', String(allPositions().length)], ['User watch threshold', `${state.scenario.threshold}%`], ['Discovery', discoveryCoverageText()]])}<p class="smalltext">A contract-parameter comparison, not a market valuation or guarantee against loss.</p>`;
  }

  function crDistribution() {
    if (state.discoveryPending) return chartUnavailable('CR distribution read in progress', 'Position ratios are still being calculated from verified reads.', 'short');
    const entries = allPositions().map((position) => ({ position, ratio: positionCollateralRatio(position) }));
    if (!entries.length) return chartUnavailable('No CR distribution available', 'No discovered positions matched the current coverage.', 'short');
    const buckets = [
      { label: '<100%', test: (ratio) => ratio !== null && ratio < 10000n, color: '#ffcfd2' },
      { label: `100–${state.scenario.threshold}%`, test: (ratio) => ratio !== null && ratio >= 10000n && ratio < BigInt(state.scenario.threshold * 100), color: '#e9c46a' },
      { label: `${state.scenario.threshold}–200%`, test: (ratio) => ratio !== null && ratio >= BigInt(state.scenario.threshold * 100) && ratio < 20000n, color: '#aee9d1' },
      { label: '200–300%', test: (ratio) => ratio !== null && ratio >= 20000n && ratio < 30000n, color: '#bde0fe' },
      { label: '≥300% / n.a.', test: (ratio) => ratio === null || ratio >= 30000n, color: '#cdb4db' },
    ].map((bucket) => ({ ...bucket, count: entries.filter((entry) => bucket.test(entry.ratio)).length }));
    const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
    return `<div class="dash-bar-list">${buckets.map((bucket) => `<div class="dash-bar-row"><span>${escapeHtml(bucket.label)}</span><div class="dash-bar-track"><div class="dash-bar-fill" style="width:${bucket.count / maximum * 100}%;background:${bucket.color}"></div></div><span class="dash-bar-value">${bucket.count} positions</span></div>`).join('')}</div><div class="dash-legend"><span>Watch threshold is user-defined, not a protocol-wide floor.</span></div>`;
  }

  function currentPositionScatter() {
    const entries = allPositions().map((position) => ({ position, cr: positionCollateralRatio(position) })).filter((entry) => entry.cr !== null);
    if (state.discoveryPending) return chartUnavailable('Position map read in progress', 'Verified position points will appear after discovery.');
    if (!entries.length) return chartUnavailable('No position risk points', 'No discovered positions have enough current data for a contract-parameter CR.');
    const width = 700;
    const height = 270;
    const margin = { left: 60, right: 20, top: 18, bottom: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxCr = entries.reduce((maximum, entry) => entry.cr > maximum ? entry.cr : maximum, 30000n);
    const maxDebt = entries.reduce((maximum, entry) => (bigintOrNull(entry.position.minted) ?? 0n) > maximum ? bigintOrNull(entry.position.minted) : maximum, 1n);
    const points = entries.map((entry) => {
      const x = margin.left + scaleRatio(entry.cr, maxCr) * innerWidth;
      const debt = bigintOrNull(entry.position.minted) ?? 0n;
      const y = margin.top + innerHeight - scaleRatio(debt, maxDebt) * innerHeight;
      const status = positionStatus(entry.position);
      const color = status.status === 'fail' ? '#ffcfd2' : status.status === 'warn' ? '#e9c46a' : '#aee9d1';
      return `<circle class="point" tabindex="0" data-position-detail="${escapeHtml(entry.position.address)}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="7" fill="${color}" fill-opacity=".8" stroke="#2b2118" stroke-opacity=".45"><title>${escapeHtml(entry.position.address)} · CR ${escapeHtml(formatCollateralRatio(entry.position))} · gross debt ${escapeHtml(formatAmount(debt, 18, currentSymbol()))}</title></circle>`;
    }).join('');
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Discovered position gross debt versus liquidation-parameter collateral ratio">${[0, 1, 2, 3].map((line) => { const y = margin.top + line / 3 * innerHeight; return `<line class="grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"/><text x="${margin.left - 8}" y="${y + 3}" text-anchor="end" font-size="9">${axisValue(maxDebt, line)}</text>`; }).join('')}${points}<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="9">CONTRACT-PARAMETER COLLATERAL RATIO</text></svg><div class="dash-legend"><span><i class="dash-swatch" style="background:#aee9d1"></i>Active</span><span><i class="dash-swatch" style="background:#e9c46a"></i>Watch</span><span><i class="dash-swatch" style="background:#ffcfd2"></i>Critical / challenged</span><span>Vertical axis = raw gross debt scale</span></div>`;
  }

  function bindPositionPoints() {
    $$('#dashboard-view [data-position-detail]', root).forEach((button) => {
      const open = () => {
        const position = allPositions().find((candidate) => sameAddress(candidate.address, button.dataset.positionDetail));
        if (position) openPositionDrawer(position);
      };
      button.addEventListener('click', open);
      button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
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
    const challengedPositions = allPositions().filter((position) => (bigintOrNull(position.challengedAmount) ?? 0n) > 0n).length;
    const colors = ['#f7b500', '#bde0fe', '#cdb4db', '#ffd6a5', '#aee9d1', '#ffcfd2'];
    const rows = groups.map((group) => {
      const decimals = allPositions().find((position) => position.collateral?.symbol === group.symbol)?.collateral?.decimals ?? 18;
      return `<tr><td>${escapeHtml(group.symbol)}</td><td class="num">${group.positions}</td><td class="num mono">${formatAmount(group.collateral, decimals, group.symbol)}</td><td class="num mono">${formatAmount(group.challenged, decimals, group.symbol)}</td><td class="num mono">${formatAmount(group.debt, 18, currentSymbol())}</td></tr>`;
    }).join('');
    const totalPositions = Math.max(1, allPositions().length);
    const treemap = groups.length ? `<div class="dash-treemap">${groups.map((group, index) => `<div style="flex:${Math.max(1, group.positions)} 1 ${Math.max(90, group.positions / totalPositions * 100)}%;background:${colors[index % colors.length]}"><b>${escapeHtml(group.symbol)}</b><span>${group.positions} positions</span><small>${(group.positions / totalPositions * 100).toFixed(1)}% of discovered count</small></div>`).join('')}</div><p class="smalltext">Area follows discovered position count, not collateral value. Native token units are never added across assets.</p>` : chartUnavailable('No concentration map', 'No verified collateral groups matched the current discovery coverage.', 'short');
    setPanelHtml('collateral', `
      <div class="dash-stack">
        <div class="dash-kpis">
          ${metricCard('Collateral types', String(groups.length), discoveryCoverageText(), groups.length ? 'pass' : 'neutral')}
          ${metricCard('Discovered positions', String(allPositions().length), state.discovery?.complete === false ? 'Partial discovery' : 'Current discovery', 'pass')}
          ${metricCard('Challenged positions', String(challengedPositions), 'Current challenged amount above zero', challengedPositions ? 'warn' : 'pass')}
          ${metricCard('Bridge capacity', bridge?.error ? 'Unavailable' : formatAmount(bridge?.capacityLocal, 18, token?.symbol ?? currentSymbol()), bridge?.error ?? formatBlock(bridge?.sourceBlock), bridge?.error ? 'fail' : 'pass')}
        </div>
        <div class="dash-grid">
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Collateral asset register</h3><p>Current balances grouped per asset; each row retains its own token decimals.</p></div>${cardTag('EXACT NATIVE UNITS', 'mint')}</div>${groups.length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Collateral</th><th class="num">Positions</th><th class="num">Collateral balance</th><th class="num">Challenged</th><th class="num">Gross debt</th></tr></thead><tbody>${rows}</tbody></table></div>` : unavailableCard('No collateral discovered', 'No verified positions matched the current discovery coverage.')}</article>
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>Concentration map</h3><p>Share of discovered position count.</p></div></div>${treemap}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Collateral value & reference marks</h3><p>Historical values and external marks require verified provenance.</p></div>${cardTag('NO SYNTHETIC MARKS', 'gold')}</div>${chartUnavailable('Reference history unavailable', 'No indexer or market-data feed is configured. Contract liquidation prices remain available in Markets & volume.', 'tall')}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Loss-absorption context</h3><p>Current accounting reads, not a predicted waterfall.</p></div></div>${metricList([
            ['System equity', equity?.error ? 'Unavailable' : formatAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol())],
            ['Minter reserve', token?.error ? 'Unavailable' : formatAmount(token?.minterReserve, 18, token?.symbol ?? currentSymbol())],
            ['Reserve contract balance', token?.error ? 'Unavailable' : formatAmount(token?.reserveBalance ?? token?.reserve, 18, token?.symbol ?? currentSymbol())],
            ['Bridge source locked', bridge?.error ? 'Unavailable' : formatAmount(bridge?.sourceLocked, bridge?.sourceDecimals ?? 6, bridge?.sourceSymbol ?? 'source')],
            ['Discovery coverage', discoveryCoverageText()],
          ])}<div class="dash-note">Equity and minter reserve are related accounting balances, not interchangeable assets or guaranteed loss coverage.</div></article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Source-bridge capacity</h3><p>Current minted local units against the verified per-system limit.</p></div>${cardTag('CURRENT READ', 'mint')}</div>${bridgeUtilization(bridge, token?.symbol ?? currentSymbol())}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Bridge & source-asset notes</h3><p>Capacity is not FX backing; test source assets have no production value claim.</p></div></div>${metricList([['Source asset', bridge?.sourceSymbol ?? 'Unavailable'], ['Source locked', bridge?.error ? 'Unavailable' : formatAmount(bridge?.sourceLocked, bridge?.sourceDecimals ?? 6, bridge?.sourceSymbol ?? 'source')], ['Local minted', bridge?.error ? 'Unavailable' : formatAmount(bridge?.mintedLocal, 18, token?.symbol ?? currentSymbol())], ['Remaining capacity', bridge?.error ? 'Unavailable' : formatAmount(bridge?.capacityLocal, 18, token?.symbol ?? currentSymbol())]])}</article>
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
    const statuses = allPositions().map((position) => positionStatus(position).key);
    const healthy = statuses.filter((status) => ['active', 'no-debt'].includes(status)).length;
    const attention = statuses.filter((status) => ['watch', 'critical'].includes(status)).length;
    const challenged = statuses.filter((status) => status === 'challenged').length;
    const debt = discoveredDebt();
    const rows = pageRows.map((position) => {
      const status = positionStatus(position);
      return `<tr>
        <td><button type="button" class="btn light small" data-position-detail="${escapeHtml(position.address)}">${escapeHtml(position.address.slice(0, 10))}…</button><small class="smalltext">${escapeHtml(position.owner?.slice(0, 10) ?? 'Unknown owner')}…</small></td>
        <td class="mono">${escapeHtml(position.collateral?.symbol ?? 'Unknown')}</td>
        <td class="num mono">${formatAmount(position.minted, 18, currentSymbol())}</td>
        <td class="num mono">${formatCollateralRatio(position)}</td>
        <td class="num mono">${formatAmount(position.price, position.priceDecimals ?? 18, `${currentSymbol()} / ${position.collateral?.symbol ?? 'collateral'}`)}</td>
        <td class="num mono">${escapeHtml(new Date(Number(position.expiration) * 1000).toISOString().slice(0, 10))}</td>
        <td>${statusPill(status.status, status.label)}</td>
      </tr>`;
    }).join('');
    const pagination = Array.from({ length: totalPages }, (_, index) => `<button type="button" data-page="${index + 1}" class="${index + 1 === state.position.page ? 'active' : ''}" aria-label="Page ${index + 1}" aria-current="${index + 1 === state.position.page ? 'page' : 'false'}">${index + 1}</button>`).join('');
    const healthFilters = [['ALL', 'All', allPositions().length], ['healthy', 'Healthy', healthy], ['attention', 'Watch + critical', attention], ['challenged', 'Challenged', challenged], ['initializing', 'Initializing', statuses.filter((status) => status === 'initializing').length], ['expired', 'Expired', statuses.filter((status) => status === 'expired').length]];
    setPanelHtml('positions', `
      <div class="dash-stack">
        <div class="dash-kpis">
          ${metricCard('Gross position debt', debt === null ? 'Unavailable' : formatAmount(debt, 18, currentSymbol()), discoveryCoverageText(), debt === null ? 'fail' : 'pass')}
          ${metricCard('Discovered positions', state.discoveryPending ? 'Read in progress' : String(allPositions().length), 'Event-derived and current-state verified', state.discoveryPending ? 'info' : 'pass')}
          ${metricCard('Healthy / no debt', state.discoveryPending ? 'Read in progress' : String(healthy), `${attention} watch or critical`, attention ? 'warn' : 'pass')}
          ${metricCard('Challenged', state.discoveryPending ? 'Read in progress' : String(challenged), 'Current challenged collateral above zero', challenged ? 'warn' : 'pass')}
        </div>
        <div class="dash-health-filters" aria-label="Position health filters">${healthFilters.map(([key, label, count]) => `<button type="button" class="dash-chip ${state.position.health === key ? 'active' : ''}" data-position-health="${key}" aria-pressed="${state.position.health === key}">${escapeHtml(label)} <span class="n">${count}</span></button>`).join('')}</div>
        <div class="dash-card flush">
          <div class="dash-card-head"><div><h3>Position explorer</h3><p>${escapeHtml(discoveryCoverageText())}</p></div><div class="dash-actions"><button type="button" class="btn light small" id="dashboard-positions-export">Export filtered CSV</button></div></div>
          <div class="dash-toolbar" style="padding:0 18px">
            <label class="dash-field">Search<input id="dashboard-position-search" type="search" value="${escapeHtml(state.position.search)}" placeholder="Position, owner or collateral"></label>
            <label class="dash-field">Collateral<select id="dashboard-position-collateral">${collateralOptions.map((symbol) => `<option value="${escapeHtml(symbol)}" ${symbol === state.position.collateral ? 'selected' : ''}>${symbol === 'ALL' ? 'All collateral' : escapeHtml(symbol)}</option>`).join('')}</select></label>
            <label class="dash-field">Status<select id="dashboard-position-status">${['ALL', 'active', 'watch', 'critical', 'challenged', 'initializing', 'expired', 'no-debt'].map((status) => `<option value="${status}" ${status === state.position.status ? 'selected' : ''}>${status === 'ALL' ? 'All statuses' : escapeHtml(status)}</option>`).join('')}</select></label>
            <label class="dash-field">Maximum CR<select id="dashboard-position-cr">${[[10000, 'Any CR'], [125, 'Below 125%'], [150, 'Below 150%'], [200, 'Below 200%'], [250, 'Below 250%']].map(([value, label]) => `<option value="${value}" ${state.position.maxCr === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label class="dash-field">Account context<input id="dashboard-position-account" type="text" value="${escapeHtml(state.account)}" placeholder="Optional 0x…"></label>
            <label class="dash-field">Scope<select id="dashboard-position-scope"><option value="all" ${state.positionScope === 'all' ? 'selected' : ''}>All discovered</option><option value="account" ${state.positionScope === 'account' ? 'selected' : ''}>Account only</option></select></label>
            <button type="button" class="btn light" id="dashboard-use-wallet">Use connected wallet</button>
            <button type="button" class="btn light" id="dashboard-refresh-discovery">Refresh discovery</button>
          </div>
          <div style="padding:0 18px 18px">${positions.length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Position / owner</th><th>Collateral</th><th class="num">${sortButton('Gross debt', 'debt')}</th><th class="num">${sortButton('CR', 'collateralRatio')}</th><th class="num">Liquidation price</th><th class="num">${sortButton('Expiration', 'expiration')}</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><div class="dash-pagination"><span>${positions.length} matching · page ${state.position.page} of ${totalPages}</span><span class="buttons">${pagination}</span></div>` : unavailableCard(state.discoveryPending ? 'Position discovery is in progress' : 'No positions match', state.discoveryPending ? 'The dashboard is scanning verified events and rereading current position state. No zero or empty position state is asserted yet.' : 'Adjust the filters or run discovery with an explicit account context.')}</div>
        </div>
        ${sourceNote()}
      </div>`);
    bindPositions();
  }

  function bindPositions() {
    $('#dashboard-position-search', root)?.addEventListener('input', (event) => { state.position.search = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-position-collateral', root)?.addEventListener('change', (event) => { state.position.collateral = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-position-status', root)?.addEventListener('change', (event) => { state.position.status = event.target.value; state.position.page = 1; renderPositions(); });
    $('#dashboard-position-cr', root)?.addEventListener('change', (event) => { state.position.maxCr = Number(event.target.value); state.position.page = 1; renderPositions(); });
    $$('#dashboard-view [data-position-health]', root).forEach((button) => button.addEventListener('click', () => {
      state.position.health = button.dataset.positionHealth;
      state.position.status = 'ALL';
      state.position.page = 1;
      renderPositions();
    }));
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
    const rows = allPositions().map((position) => `<tr><td><button type="button" class="btn light small" data-position-detail="${escapeHtml(position.address)}">${escapeHtml(position.address.slice(0, 10))}…</button></td><td>${escapeHtml(position.collateral?.symbol ?? 'Unknown')}</td><td class="num mono">${formatAmount(position.price, position.priceDecimals ?? 18, `${currentSymbol()} / ${position.collateral?.symbol ?? 'collateral'}`)}</td><td>${statusPill('neutral', 'Reference unavailable')}</td><td>Not configured</td></tr>`).join('');
    setPanelHtml('markets', `
      <div class="dash-stack">
        <div class="dash-kpis">
          ${metricCard('Protocol liquidation prices', String(allPositions().length), 'Current contract reads from discovered positions', 'pass')}
          ${metricCard('Reference marks', 'Unavailable', reference.reason, 'fail')}
          ${metricCard('Price history', 'Unavailable', 'Historical market data requires an indexer.', 'fail')}
          ${metricCard('Volume / depth', 'Unavailable', 'No verified market feed is configured.', 'fail')}
        </div>
        <div class="dash-grid">
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Reference market explorer</h3><p>Price and normalized-performance charts require a real market feed.</p></div>${cardTag('NOT ORACLE DATA', 'gold')}</div>${chartUnavailable('Reference marks unavailable', 'No verified reference-price feed is configured. No prices are interpolated from contract liquidation parameters.', 'tall')}</article>
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>Currency watchboard</h3><p>Only the selected verified currency system is shown.</p></div>${cardTag(currentSymbol(), 'mint')}</div>${metricList([['Currency system', currentCode()], ['Token', currentSymbol()], ['Reference par', 'Unavailable'], ['Premium / discount', 'Unavailable'], ['Executable liquidity', 'Unknown'], ['Feed provenance', 'Not configured']])}<div class="dash-note">A future mark must identify source, pair, block/time and methodology.</div></article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Protocol volume timeline</h3><p>Mint, repayment and source-bridge flows require complete event coverage.</p></div>${cardTag('INDEXER REQUIRED')}</div>${chartUnavailable('Volume unavailable', 'Current balances are not a volume history. No generated volume is shown.', 'tall')}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Reference-pool depth</h3><p>Barkswap or other pool analytics would not prove executable liquidity.</p></div>${cardTag('NO DEPTH FEED', 'gold')}</div>${chartUnavailable('Market depth unavailable', 'No verified pool-depth adapter is configured.', 'tall')}</article>
        </div>
        <article class="dash-card"><div class="dash-card-head"><div><h3>Contract liquidation boundaries</h3><p>Stored position parameters, not external oracle prices or reference marks.</p></div>${cardTag('CURRENT POSITION READS', 'mint')}</div>${allPositions().length ? `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Position</th><th>Collateral</th><th class="num">Liquidation price</th><th>Reference mark</th><th>Feed</th></tr></thead><tbody>${rows}</tbody></table></div>` : unavailableCard('No positions discovered', 'Contract liquidation boundaries require real discovered positions.')}</article>
        ${sourceNote()}
      </div>`);
    bindPositionPoints();
  }

  function scenarioCr(position) {
    const bips = positionCollateralRatio(position);
    if (bips === null) return null;
    return bips * BigInt(100 + state.scenario.collateral) * BigInt(100 - state.scenario.liquidity) / (BigInt(100 + state.scenario.fx) * 10000n);
  }

  function scenarioPositions() {
    return allPositions().map((position) => ({ position, cr: scenarioCr(position), status: positionStatus(position) })).filter((entry) => entry.cr !== null);
  }

  function scenarioExposure(entries) {
    if (!entries.length) return chartUnavailable('No scenario exposure', 'No discovered positions have enough inputs for this scenario.', 'short');
    const groups = [
      { label: 'Below 100%', color: '#ffcfd2', test: (entry) => entry.cr < 10000n },
      { label: `100% to ${state.scenario.threshold}% watch`, color: '#e9c46a', test: (entry) => entry.cr >= 10000n && entry.cr < BigInt(state.scenario.threshold * 100) },
      { label: 'Above watch', color: '#aee9d1', test: (entry) => entry.cr >= BigInt(state.scenario.threshold * 100) },
    ].map((group) => ({ ...group, debt: entries.filter(group.test).reduce((sum, entry) => sum + (bigintOrNull(entry.position.minted) ?? 0n), 0n), count: entries.filter(group.test).length }));
    const maximum = groups.reduce((max, group) => group.debt > max ? group.debt : max, 1n);
    return `<div class="dash-bar-list">${groups.map((group) => `<div class="dash-bar-row"><span>${escapeHtml(group.label)}</span><div class="dash-bar-track"><div class="dash-bar-fill" style="width:${scaleRatio(group.debt, maximum) * 100}%;background:${group.color}"></div></div><span class="dash-bar-value">${escapeHtml(formatAmount(group.debt, 18, currentSymbol()))}</span><span class="dash-bar-sub">${group.count} positions · scenario gross-debt exposure, not an estimated loss</span></div>`).join('')}</div>`;
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
        <div class="dash-grid">
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Scenario exposure by CR band</h3><p>Gross debt grouped by stressed collateral ratio; this is not an equity-loss waterfall.</p></div>${cardTag('SCENARIO ONLY', 'pink')}</div>${scenarioExposure(entries)}</article>
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>System risk heatmap</h3><p>Composite risk scores require independent models and evidence.</p></div>${cardTag('NO RATING MODEL', 'gold')}</div>${chartUnavailable('Risk scores unavailable', 'No collateral, liquidity, governance or contagion score is inferred from current contract reads.', 'short')}</article>
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

  function filteredEvents() {
    const events = (state.discovery?.events ?? []).filter((event) => state.activity.type === 'all' || event.type === state.activity.type);
    const direction = state.activity.sort === 'desc' ? 1 : -1;
    return events.slice().sort((left, right) => {
      const leftBlock = bigintOrNull(left.blockNumber) ?? 0n;
      const rightBlock = bigintOrNull(right.blockNumber) ?? 0n;
      return leftBlock === rightBlock ? 0 : leftBlock > rightBlock ? -direction : direction;
    });
  }

  function renderActivity() {
    if (state.discovery?.error) {
      setPanelHtml('activity', `<div class="dash-stack">${unavailableCard('Activity discovery is unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const events = state.discovery?.events ?? [];
    const visible = filteredEvents();
    const eventRows = visible.slice(0, 50).map((event) => `<div class="dash-event"><div class="dash-event-icon">${escapeHtml(event.type === 'challenge-started' ? 'CH' : 'PO')}</div><div><strong>${escapeHtml(event.label)}</strong><small>${escapeHtml(event.summary)}<br>${escapeHtml(event.transactionHash ?? '')}</small></div><div class="event-amount">${txLink(event.transactionHash)}<small>block ${escapeHtml(String(event.blockNumber ?? 'unknown'))}</small></div></div>`).join('');
    const types = [['all', 'All events'], ['position-opened', 'Positions'], ['challenge-started', 'Challenges']];
    setPanelHtml('activity', `
      <div class="dash-stack">
        <div class="dash-grid">
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Challenge & Dutch-auction replay</h3><p>Uses actual challenge timestamps and period data when available.</p></div>${cardTag('SCENARIO REPLAY', 'gold')}</div>
            <div class="dash-toolbar"><label class="dash-field">Challenge index<input id="dashboard-challenge-index" inputmode="numeric" pattern="[0-9]+" value="0"></label><button type="button" class="btn mint" id="dashboard-load-challenge">Read challenge</button><button type="button" class="btn light" id="dashboard-replay-toggle">${state.replay.playing ? 'Pause' : 'Play'}</button><button type="button" class="btn light" id="dashboard-replay-reset">Reset</button></div>
            <div id="dashboard-challenge-panel">${challengeHtml()}</div>
          </article>
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>Activity summary</h3><p>${escapeHtml(discoveryCoverageText())}</p></div></div>${metricList([
            ['Event types', state.discoveryPending ? 'Discovery in progress' : state.discovery?.synthetic ? 'Synthetic fixture' : 'PositionOpened · ChallengeStarted'],
            ['Events discovered', state.discoveryPending ? 'Read in progress' : String(events.length)],
            ['Matching filter', state.discoveryPending ? 'Read in progress' : String(visible.length)],
            ['Account context', state.discovery?.account ?? 'Not supplied'],
            ['Complete / partial', state.discoveryPending ? 'Pending' : state.discovery ? String(state.discovery.complete ? 'Complete' : 'Partial') : 'Unknown'],
            ['History / volume', 'Unavailable — indexer not configured'],
          ])}<div class="dash-note">An inactive first challenge phase does not prove settlement completion. Reread contract state before drawing a conclusion.</div></article>
        </div>
        <div class="dash-card"><div class="dash-card-head"><div><h3>Protocol event ledger</h3><p>Real discovered events with transaction hashes. No generated event rows are shown.</p></div><button type="button" class="btn light small" id="dashboard-activity-sort">${state.activity.sort === 'desc' ? 'Newest first' : 'Oldest first'}</button></div><div class="dash-event-layout"><div class="dash-event-types" aria-label="Event type filters">${types.map(([key, label]) => { const count = key === 'all' ? events.length : events.filter((event) => event.type === key).length; return `<button type="button" data-event-type="${key}" class="${state.activity.type === key ? 'active' : ''}" aria-pressed="${state.activity.type === key}"><span>${label}</span><span class="n">${count}</span></button>`; }).join('')}</div><div>${visible.length ? `<div class="dash-event-list">${eventRows}</div>` : unavailableCard(state.discoveryPending ? 'Event discovery is in progress' : 'No matching real events', state.discoveryPending ? 'The dashboard is scanning verified events. No zero or empty event history is asserted yet.' : state.discovery?.synthetic ? 'The synthetic fixture has no deployed event history.' : 'The scanned range or selected event-type filter contains no matching events.')}</div></div></div>
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
    $$('#dashboard-view [data-event-type]', root).forEach((button) => button.addEventListener('click', () => {
      state.activity.type = button.dataset.eventType;
      renderActivity();
    }));
    $('#dashboard-activity-sort', root)?.addEventListener('click', () => {
      state.activity.sort = state.activity.sort === 'desc' ? 'asc' : 'desc';
      renderActivity();
    });
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
        : state.parametersTab === 'sources'
          ? `<div class="dash-grid"><article class="dash-card span-6"><div class="dash-card-head"><div><h3>SDK read coverage</h3><p>Capabilities detected for the selected verified registry.</p></div>${cardTag('CURRENT STATE', 'mint')}</div>${metricList(Object.entries(capabilities.capabilities).map(([label, enabled]) => [label, enabled ? 'Available' : 'Unavailable — adapter not configured']))}</article><article class="dash-card span-6"><div class="dash-card-head"><div><h3>Analytics still required</h3><p>Unavailable fields are never replaced with generated telemetry.</p></div>${cardTag('EXPLICIT UNKNOWN', 'gold')}</div>${metricList([['Historical snapshots', 'Indexer required'], ['Position enumeration', discoveryCoverageText()], ['Reference marks', 'Verified market feed required'], ['Volume and depth', 'Indexer and market feed required'], ['Cross-currency FX', 'Explicit provenance required'], ['Production readiness', 'Not claimed']])}</article></div>`
          : `<div class="dash-stack">${READINESS_GATES.map(([label, description], index) => `<div class="unavailable-card"><strong>${index + 1}. ${escapeHtml(label)}</strong><p>${escapeHtml(description)}</p></div>`).join('')}</div>`;
    setPanelHtml('parameters', `
      <div class="dash-stack">
        <div class="dash-card"><div class="dash-card-head"><div><h3>System parameters</h3><p>Current on-chain values, registry evidence, adapter coverage and repository-owned readiness gates.</p></div></div><div class="dash-tabs" role="tablist" aria-label="Parameter views">${[['current', 'Current values'], ['registry', 'USD registry'], ['sources', 'Data sources'], ['gates', 'Readiness gates']].map(([key, label]) => `<button type="button" role="tab" data-parameter-tab="${key}" class="${state.parametersTab === key ? 'active' : ''}" aria-selected="${state.parametersTab === key}">${label}</button>`).join('')}</div>${currentPanel}</div>
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

  function revealTab(button, behavior = 'auto') {
    if (!button) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    button.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : behavior });
  }

  function setPanel(panel, { updateHash = true, focusTab = false } = {}) {
    if (!PANELS.includes(panel)) return;
    state.panel = panel;
    let activeButton = null;
    $$('.dashboard-nav [data-dashboard]', root).forEach((button) => {
      const active = button.dataset.dashboard === panel;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active) activeButton = button;
    });
    PANELS.forEach((name) => {
      const target = panelRoot(name);
      if (target) target.hidden = name !== panel;
    });
    if (updateHash) history.replaceState(null, '', `#dashboard/${panel}`);
    if (focusTab) activeButton?.focus();
    revealTab(activeButton, updateHash ? 'smooth' : 'auto');
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
    const tabs = $$('.dashboard-nav [data-dashboard]', root);
    tabs.forEach((button) => {
      button.addEventListener('click', () => setPanel(button.dataset.dashboard));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = PANELS.indexOf(button.dataset.dashboard);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? PANELS.length - 1 : event.key === 'ArrowRight' ? (current + 1) % PANELS.length : (current - 1 + PANELS.length) % PANELS.length;
        setPanel(PANELS[next], { focusTab: true });
      });
    });
    $('#dashboard-currency', root)?.addEventListener('change', (event) => {
      if (event.target.selectedOptions[0]?.disabled) return;
      state.code = event.target.value;
      const sharedSelector = $('#v2-currency');
      if (sharedSelector) sharedSelector.value = state.code;
      render(true);
    });
    $('#dashboard-refresh', root)?.addEventListener('click', () => { render(true); notify('Refreshing verified current reads and discovery coverage.'); });
    $('#dashboard-reset', root)?.addEventListener('click', resetDashboard);
    $('#dashboard-copy-view', root)?.addEventListener('click', copyViewLink);
    $('#dashboard-export-view', root)?.addEventListener('click', exportCurrentView);
    const methodDialog = $('#dashboard-method-dialog', root);
    $('#dashboard-method-open', root)?.addEventListener('click', () => methodDialog?.showModal());
    $('#dashboard-method-close', root)?.addEventListener('click', () => methodDialog?.close());
    methodDialog?.addEventListener('click', (event) => { if (event.target === methodDialog) methodDialog.close(); });
    backdrop?.addEventListener('click', closeDrawer);
    $('#dashboard-drawer-close', drawer)?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
    let resizeFrame = null;
    window.addEventListener('resize', () => {
      if (root.hidden) return;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        revealTab($(`.dashboard-nav [data-dashboard="${state.panel}"]`, root));
      });
    });
    window.addEventListener('hashchange', () => {
      const panel = panelFromHash();
      if (panel && !root.hidden) setPanel(panel, { updateHash: false });
    });
    return { activate, refresh: () => render(true), panelFromHash };
  }

  window.IMF_DASHBOARD = { init, panelFromHash, PANELS };
})();
