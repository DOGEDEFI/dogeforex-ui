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
    parameters: ['The system, parameter by parameter.', 'Current V2 reads, verified currency registry, data coverage and readiness gates.'],
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

  const RADAR_COLORS = ['#f7b500', '#bde0fe', '#cdb4db', '#ffd6a5', '#aee9d1', '#ffcfd2', '#8ecae6', '#c8b6ff', '#90be6d', '#f8961e', '#577590'];
  const FINGERPRINT_AXES = [
    { key: 'supply', label: 'Token supply', read: (snapshot) => section(snapshot, 'token')?.totalSupply },
    { key: 'equity', label: 'System equity', read: (snapshot) => section(snapshot, 'equity')?.equityAmount },
    { key: 'rate', label: 'Leadrate PPM', read: (snapshot) => section(snapshot, 'savings')?.currentRatePPM },
    { key: 'bridgeMinted', label: 'Bridge minted', read: (snapshot) => section(snapshot, 'bridge')?.mintedLocal },
    { key: 'bridgeCapacity', label: 'Bridge capacity', read: (snapshot) => section(snapshot, 'bridge')?.capacityLocal },
  ];
  const NATIVE_BAR_COLORS = ['#f7b500', '#bde0fe', '#cdb4db', '#ffd6a5', '#aee9d1', '#ffcfd2', '#8ecae6', '#c8b6ff'];
  const CUBE_DIMENSIONS = {
    debt: { label: 'Gross debt', short: 'DEBT', get: (position) => bigintOrNull(position.minted) ?? 0n, format: (value) => formatAmount(value, 18, currentSymbol()) },
    availableForMinting: { label: 'Minting capacity', short: 'CAPACITY', get: (position) => bigintOrNull(position.availableForMinting) ?? 0n, format: (value) => formatAmount(value, 18, currentSymbol()) },
    collateral: { label: 'Collateral balance (native)', short: 'COLLATERAL', get: (position) => bigintOrNull(position.collateral?.balance) ?? 0n, format: (value, position) => formatAmount(value, position.collateral?.decimals ?? 18, position.collateral?.symbol ?? '') },
    liquidationPrice: { label: 'Liquidation price', short: 'LIQ. PRICE', get: (position) => bigintOrNull(position.price) ?? 0n, format: (value, position) => formatAmount(value, position.priceDecimals ?? 18, `${currentSymbol()} / ${position.collateral?.symbol ?? 'collateral'}`) },
    reservePPM: { label: 'Reserve contribution PPM', short: 'RESERVE PPM', get: (position) => bigintOrNull(position.reserveContributionPPM) ?? 0n, format: (value) => formatPPM(value) },
  };
  const CUBE_POINT_COLORS = { pass: '#aee9d1', warn: '#e9c46a', fail: '#ffcfd2', info: '#bde0fe', neutral: '#cdb4db' };

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
    activity: { type: 'all', sort: 'desc', day: null },
    scenario: { collateral: -20, fx: 0, liquidity: 15, threshold: 150, preset: 'moderate' },
    replay: { progress: 0, playing: false, timer: null },
    comparison: { open: true, pending: false, rows: [], nonce: 0, search: '', sort: 'supply', dir: 'desc' },
    indexer: { status: 'unconfigured', health: null, events: [], positions: [], complete: false, error: null },
    cube: { axes: { x: '', y: '', z: '' }, code: '', yaw: 0.65, pitch: 0.42, focus: null, mode: '3d' },
  };
  const systemCache = new Map();
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
    if (age > 3600000) return { status: 'warn', label: 'REFRESH DUE', message: `Source block ${sourceBlock.number} is more than one hour old at observation.` };
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
    const live = verified && !fixture && runtime?.source === 'runtime-config';
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
        history: state.indexer.status === 'ready' && state.indexer.complete,
        referenceMarks: false,
        markets: false,
      },
    };
  }

  async function getSystemSnapshot(code = currentCode(), force = false) {
    const capabilities = getCapabilities(code);
    if (!capabilities.verified) {
      return { code, capabilities, error: capabilities.unconfigured ? 'Configure and verify a V2 registry before reading dashboard state.' : `${code} is not verified against the selected registry and chain.` };
    }
    try {
      const result = await app().readDashboardAnalytics('system', 'snapshot', code, async () => {
        const client = await app().clientFor(code, { fresh: force });
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
      });
      const snapshot = { ...result.value, readCache: { status: result.cache, fetchedAt: result.fetchedAt ?? null } };
      systemCache.set(code, snapshot);
      if (result.refresh) {
        result.refresh.then((fresh) => {
          if (!fresh) return;
          const refreshed = { ...fresh, readCache: { status: 'miss', fetchedAt: Date.now() } };
          systemCache.set(code, refreshed);
          if (currentCode() === code && state.system?.code === code) {
            state.system = refreshed;
            renderActivePanel();
          }
        });
      }
      return snapshot;
    } catch (cause) {
      return { code, capabilities, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function cachedSystemSnapshot(code, force = false) {
    if (force) {
      systemCache.delete(code);
      app().invalidateReadCache?.(code);
    }
    return systemCache.get(code) ?? getSystemSnapshot(code, force);
  }

  async function mapLimit(values, limit, callback) {
    const results = [];
    for (let start = 0; start < values.length; start += limit) {
      results.push(...await Promise.all(values.slice(start, start + limit).map(callback)));
    }
    return results;
  }

  async function getDiscoveredPositions(code = currentCode(), coverage = {}) {
    const capabilities = getCapabilities(code);
    if (!capabilities.verified) return { code, capabilities, error: 'Position discovery requires a verified V2 registry.' };
    if (capabilities.fixture) {
      return { code, capabilities, positions: [], challenges: [], events: [], account: coverage.account ?? null, fromBlock: null, toBlock: null, complete: false, synthetic: true, warnings: ['Synthetic fixture: no deployed event history is represented.'] };
    }
    try {
      const account = coverage.account ?? null;
      const result = await app().readDashboardAnalytics('dashboard-discovery', account ?? 'all', code, async () => {
        const client = await app().clientFor(code, { fresh: Boolean(coverage.force) });
        const discovered = await window.IMF_DISCOVERY.discover(registryState(), client, account, { resume: !coverage.force });
        return { code, capabilities, ...discovered, account };
      });
      const discovered = { ...result.value, readCache: { status: result.cache, fetchedAt: result.fetchedAt ?? null } };
      if (result.refresh) {
        result.refresh.then((fresh) => {
          if (!fresh) return;
          const refreshed = { ...fresh, readCache: { status: 'miss', fetchedAt: Date.now() } };
          if (currentCode() === code && state.discovery?.code === code) {
            state.discovery = refreshed;
            renderActivePanel();
          }
        });
      }
      return discovered;
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

  function indexerUrl() {
    const value = registryState()?.runtime?.indexerUrl;
    if (!value) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
      throw new Error('Indexer URL must use HTTPS outside localhost');
    }
    if (url.username || url.password || url.search || url.hash) throw new Error('Indexer URL must not contain credentials, query or hash');
    return url.href.replace(/\/$/, '');
  }

  async function indexerJson(url, path) {
    const response = await fetch(`${url}${path}`);
    if (!response.ok) throw new Error(`Indexer returned HTTP ${response.status} for ${path}`);
    return response.json();
  }

  async function getIndexerBundle(code) {
    let url;
    try {
      url = indexerUrl();
    } catch (cause) {
      return { status: 'error', health: null, events: [], positions: [], complete: false, error: cause.message };
    }
    if (!url) return { status: 'unconfigured', health: null, events: [], positions: [], complete: false, error: null };
    try {
      const health = await indexerJson(url, '/indexer/health');
      if (health.schema !== 'imf.indexer-health.v1' || Number(health.chainId) !== 6281971) throw new Error('Indexer health schema or chain ID does not match this registry');
      const lag = Number(health.lagBlocks);
      if (!Number.isSafeInteger(lag) || lag < 0) throw new Error('Indexer has not established a readable synchronization heartbeat');
      if (lag > 100) return { status: 'stale', health, events: [], positions: [], complete: false, error: `Indexer is ${lag} blocks behind the chain` };
      const [eventResult, positionResult] = await Promise.all([
        indexerJson(url, `/indexer/${code}/events?limit=5000`),
        indexerJson(url, `/indexer/${code}/positions`),
      ]);
      if (eventResult.schema !== 'imf.indexer-events.v1' || eventResult.code !== code || positionResult.schema !== 'imf.indexer-positions.v1' || positionResult.code !== code) {
        throw new Error(`Indexer response does not match selected currency ${code}`);
      }
      return {
        status: 'ready',
        health,
        events: eventResult.events,
        positions: positionResult.positions,
        complete: eventResult.events.length < 5000,
        error: eventResult.events.length === 5000 ? 'Event result reached the 5,000-row safety limit; complete history is not asserted' : null,
      };
    } catch (cause) {
      return { status: 'error', health: null, events: [], positions: [], complete: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  function getHistory() {
    if (state.indexer.status === 'ready' && state.indexer.complete) return { status: 'ready', reason: indexerCoverageText() };
    if (state.indexer.status === 'ready') return { status: 'partial', reason: state.indexer.error };
    if (state.indexer.status === 'stale' || state.indexer.status === 'error') return { status: 'unavailable', reason: `History unavailable — ${state.indexer.error}` };
    if (state.indexer.status === 'pending') return { status: 'pending', reason: 'Checking indexer health and historical coverage.' };
    return { status: 'unavailable', reason: 'History unavailable — indexer not configured.' };
  }

  function getReferenceMarks() {
    return { status: 'unavailable', reason: 'Reference marks unavailable — verified market/indexer feed not configured.' };
  }

  function indexerCoverageText() {
    if (state.indexer.status !== 'ready') return state.indexer.error ?? 'Indexer not configured';
    return `Indexed through block ${state.indexer.health.latestIndexedBlock} · chain block ${state.indexer.health.latestChainBlock} · ${state.indexer.complete ? 'complete event result' : 'partial event result'}`;
  }

  async function getEvents(code = currentCode(), range = {}) {
    if (code === currentCode() && state.indexer.status === 'ready') {
      return { code, capabilities: getCapabilities(code), status: 'indexed-events', reason: indexerCoverageText(), events: state.indexer.events, coverage: { complete: state.indexer.complete, health: state.indexer.health } };
    }
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
    return Number(capped * 100000n / safeMaximum) / 100000;
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
        indexer: { status: state.indexer.status, complete: state.indexer.complete, error: state.indexer.error, health: state.indexer.health },
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
    notify('Dashboard view link copied. The link preserves the selected subview and currency.');
  }

  function resetDashboard() {
    state.account = '';
    state.positionScope = 'all';
    state.position = { search: '', collateral: 'ALL', status: 'ALL', health: 'ALL', maxCr: 10000, sort: 'collateralRatio', dir: 'asc', page: 1, perPage: 8 };
    state.activity = { type: 'all', sort: 'desc', day: null };
    state.scenario = { collateral: -20, fx: 0, liquidity: 15, threshold: 150, preset: 'moderate' };
    state.replay.progress = 0;
    state.cube.axes = { x: '', y: '', z: '' };
    state.cube.focus = null;
    state.cube.mode = '3d';
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

  function hourlyReadNote() {
    const meta = state.system?.readCache ?? state.discovery?.readCache;
    if (!meta?.fetchedAt) return 'Verified read · auto-refresh hourly';
    const minutes = Math.max(0, Math.floor((Date.now() - meta.fetchedAt) / 60000));
    const age = minutes < 1 ? 'just now' : `${minutes} min ago`;
    return `Updated ${age} · auto-refresh hourly${meta.status === 'expired' ? ' · refreshing' : ''}`;
  }

  function renderPageCopy(sourceBlock = null) {
    const copy = PANEL_COPY[state.panel] ?? PANEL_COPY.overview;
    const title = $('#view-title');
    const subtitle = $('#dashboard-page-subtitle', root);
    const snapshot = $('#dashboard-snapshot', root);
    if (title) title.textContent = copy[0];
    if (subtitle) subtitle.textContent = copy[1];
    if (snapshot) snapshot.innerHTML = `<b>${sourceBlock ? `BLOCK ${escapeHtml(sourceBlock.number)}` : 'CURRENT STATE'}</b><span>${sourceBlock ? `${escapeHtml(new Date(Number(sourceBlock.timestamp) * 1000).toISOString())} · ${escapeHtml(hourlyReadNote())}` : 'Source block pending'}</span>`;
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
    const mode = capabilities.live ? `LIVE ${currentCode()}` : capabilities.fixture ? 'SYNTHETIC FIXTURE' : capabilities.imported ? 'IMPORTED READ-ONLY' : capabilities.verified ? 'READ-ONLY' : 'UNCONFIGURED';
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
      <div class="dash-actions">${statusPill(capabilities.live ? 'pass' : capabilities.fixture ? 'warn' : 'info', mode)}${statusPill(fresh.status, fresh.label)}${state.indexer.status === 'ready' ? statusPill('info', 'INDEXED HISTORY') : state.indexer.status === 'pending' ? statusPill('neutral', 'INDEXER CHECK') : ['stale', 'error'].includes(state.indexer.status) ? statusPill('warn', 'INDEXER FALLBACK') : ''}</div>`;
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

  function parseIndexedArgs(event) {
    try {
      return JSON.parse(event.args ?? '{}');
    } catch {
      return {};
    }
  }

  function debtHistoryChart() {
    const history = getHistory();
    if (history.status !== 'ready') return chartUnavailable('Gross debt history unavailable', history.reason, 'tall');
    const updates = state.indexer.events.filter((event) => event.contract === 'Position' && event.event === 'MintingUpdate').slice().sort((left, right) => {
      const blockDifference = BigInt(left.blockNumber) - BigInt(right.blockNumber);
      return blockDifference < 0n ? -1 : blockDifference > 0n ? 1 : left.logIndex - right.logIndex;
    });
    const positions = new Map();
    const series = [];
    for (const event of updates) {
      const minted = bigintOrNull(event.amount);
      if (minted === null) continue;
      positions.set(event.address.toLowerCase(), minted);
      const total = [...positions.values()].reduce((sum, value) => sum + value, 0n);
      series.push({ timestamp: BigInt(event.blockTimestamp), total });
    }
    if (!series.length) return chartUnavailable('No gross debt history discovered', 'The complete indexed result contains no Position MintingUpdate events.', 'tall');
    const width = 700;
    const height = 250;
    const margin = { left: 70, right: 20, top: 20, bottom: 45 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maximum = series.reduce((max, point) => point.total > max ? point.total : max, 1n);
    const firstTime = series[0].timestamp;
    const lastTime = series[series.length - 1].timestamp;
    const timeRange = lastTime > firstTime ? lastTime - firstTime : 1n;
    const points = series.map((point) => {
      const x = margin.left + Number(point.timestamp - firstTime) / Number(timeRange) * innerWidth;
      const y = margin.top + innerHeight - scaleRatio(point.total, maximum) * innerHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gross position debt reconstructed from complete indexed MintingUpdate events"><line class="grid-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerHeight}"/><line class="grid-line" x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${width - margin.right}" y2="${margin.top + innerHeight}"/><polyline points="${points}" fill="none" stroke="#2b2118" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="${margin.left - 8}" y="${margin.top + 5}" text-anchor="end" font-size="9">${escapeHtml(formatCompactAmount(maximum, 18, currentSymbol()))}</text><text x="${margin.left}" y="${height - 12}" font-size="9">${escapeHtml(new Date(Number(firstTime) * 1000).toISOString().slice(0, 10))}</text><text x="${width - margin.right}" y="${height - 12}" text-anchor="end" font-size="9">${escapeHtml(new Date(Number(lastTime) * 1000).toISOString().slice(0, 10))}</text></svg><div class="dash-note">${escapeHtml(indexerCoverageText())}. Reconstructed from per-position MintingUpdate events in native ${escapeHtml(currentSymbol())} units; not collateral market value or system equity.</div>`;
  }

  function tokenFlowHistory() {
    const history = getHistory();
    if (history.status !== 'ready') return chartUnavailable('Token flow history unavailable', history.reason, 'tall');
    const zero = '0x0000000000000000000000000000000000000000';
    const days = new Map();
    for (const event of state.indexer.events) {
      if (event.contract !== 'Token' || event.event !== 'Transfer') continue;
      const args = parseIndexedArgs(event);
      const amount = bigintOrNull(event.amount);
      if (amount === null) continue;
      const day = new Date(Number(event.blockTimestamp) * 1000).toISOString().slice(0, 10);
      if (!days.has(day)) days.set(day, { day, minted: 0n, burned: 0n });
      const row = days.get(day);
      if (String(args.from).toLowerCase() === zero) row.minted += amount;
      if (String(args.to).toLowerCase() === zero) row.burned += amount;
    }
    const rows = [...days.values()].filter((row) => row.minted || row.burned).sort((left, right) => left.day.localeCompare(right.day)).slice(-14);
    if (!rows.length) return chartUnavailable('No token mint or burn flow discovered', 'The complete indexed result contains no zero-address token transfers.', 'tall');
    const width = 700;
    const height = 260;
    const margin = { left: 64, right: 16, top: 20, bottom: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const midY = margin.top + innerHeight / 2;
    const half = innerHeight / 2;
    const maximum = rows.reduce((max, row) => row.minted > max ? row.minted : row.burned > max ? row.burned : max, 1n);
    const band = innerWidth / rows.length;
    const barWidth = Math.max(7, band * 0.6);
    const bars = rows.map((row, index) => {
      const x = margin.left + index * band + (band - barWidth) / 2;
      const mintHeight = scaleRatio(row.minted, maximum) * half;
      const burnHeight = scaleRatio(row.burned, maximum) * half;
      const mintBar = mintHeight > 0.5 ? `<rect x="${x.toFixed(2)}" y="${(midY - mintHeight).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${mintHeight.toFixed(2)}" rx="2" fill="#79cf89"><title>${escapeHtml(row.day)} minted ${escapeHtml(formatAmount(row.minted, 18, currentSymbol()))}</title></rect>` : '';
      const burnBar = burnHeight > 0.5 ? `<rect x="${x.toFixed(2)}" y="${midY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${burnHeight.toFixed(2)}" rx="2" fill="#2b2118"><title>${escapeHtml(row.day)} burned ${escapeHtml(formatAmount(row.burned, 18, currentSymbol()))}</title></rect>` : '';
      const label = rows.length > 8 && index % 2 ? '' : `<text x="${(x + barWidth / 2).toFixed(2)}" y="${height - 28}" text-anchor="middle" font-size="8" transform="rotate(-30 ${(x + barWidth / 2).toFixed(2)} ${height - 28})">${escapeHtml(row.day.slice(5))}</text>`;
      return `${mintBar}${burnBar}${label}`;
    }).join('');
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diverging indexed token mint and burn bars by UTC day"><text x="${margin.left - 8}" y="${margin.top + 4}" text-anchor="end" font-size="9">+ ${escapeHtml(formatCompactAmount(maximum, 18, currentSymbol()))}</text><text x="${margin.left - 8}" y="${margin.top + innerHeight + 4}" text-anchor="end" font-size="9">− ${escapeHtml(formatCompactAmount(maximum, 18, currentSymbol()))}</text><line class="grid-line" x1="${margin.left}" y1="${margin.top}" x2="${width - margin.right}" y2="${margin.top}"/><line class="axis-line" x1="${margin.left}" y1="${midY.toFixed(2)}" x2="${width - margin.right}" y2="${midY.toFixed(2)}"/><line class="grid-line" x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${width - margin.right}" y2="${margin.top + innerHeight}"/>${bars}</svg><div class="dash-legend"><span><i class="dash-swatch" style="background:#79cf89"></i>Minted</span><span><i class="dash-swatch" style="background:#2b2118"></i>Burned</span><span>Zero-address token transfers in native ${escapeHtml(currentSymbol())} units; a missing bar is verified zero flow, not missing data.</span></div><div class="dash-note">${escapeHtml(indexerCoverageText())}. Indexed history only; this is not DEX volume.</div>`;
  }

  function sortedComparisonRows() {
    const query = state.comparison.search.trim().toLowerCase();
    const key = state.comparison.sort;
    const direction = state.comparison.dir === 'asc' ? 1 : -1;
    const value = (snapshot) => {
      if (key === 'code') return snapshot.code;
      const source = key === 'supply' ? section(snapshot, 'token')?.totalSupply
        : key === 'equity' ? section(snapshot, 'equity')?.equityAmount
          : key === 'rate' ? section(snapshot, 'savings')?.currentRatePPM
            : section(snapshot, 'bridge')?.mintedLocal;
      return bigintOrNull(source) ?? -1n;
    };
    return state.comparison.rows.filter((snapshot) => !query || `${snapshot.code} K9${snapshot.code}`.toLowerCase().includes(query)).slice().sort((left, right) => {
      const a = value(left);
      const b = value(right);
      if (typeof a === 'bigint' && typeof b === 'bigint') return a === b ? left.code.localeCompare(right.code) : a > b ? direction : -direction;
      return String(a).localeCompare(String(b)) * direction;
    });
  }

  function compareSortButton(label, key) {
    const active = state.comparison.sort === key;
    return `<button type="button" data-compare-sort="${key}" aria-pressed="${active}">${escapeHtml(label)}${active ? state.comparison.dir === 'asc' ? ' ↑' : ' ↓' : ''}</button>`;
  }

  function comparisonRows() {
    return sortedComparisonRows().map((snapshot) => {
      const code = snapshot.code;
      const token = section(snapshot, 'token');
      const bridge = section(snapshot, 'bridge');
      const savings = section(snapshot, 'savings');
      const equity = section(snapshot, 'equity');
      const sourceBlock = sectionSource(snapshot, ['token', 'bridge', 'savings', 'equity']);
      const fresh = freshness(sourceBlock);
      const failed = snapshot.error || [token, bridge, savings, equity].some((entry) => entry?.error);
      const minted = bigintOrNull(bridge?.mintedLocal);
      const limit = bigintOrNull(bridge?.limitLocal);
      const utilization = minted !== null && limit !== null && limit > 0n ? `${sdk().formatDecimal(minted * 10000n / limit, 2)}%` : 'Unavailable';
      return `<tr>
        <td><button type="button" class="currency-link" data-compare-code="${escapeHtml(code)}" ${snapshot.capabilities?.verified ? '' : 'disabled'}><span class="currency-badge">${escapeHtml(code.slice(0, 1))}</span><span><strong>${escapeHtml(currentSymbol(code))}</strong><small>${escapeHtml(code)} · independent system</small></span></button></td>
        <td class="num mono">${escapeHtml(token?.error || snapshot.error ? 'Unavailable' : formatCompactAmount(token?.totalSupply, 18, token?.symbol ?? currentSymbol(code)))}</td>
        <td class="num mono">${escapeHtml(equity?.error || snapshot.error ? 'Unavailable' : formatCompactAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol(code)))}</td>
        <td class="num mono">${escapeHtml(savings?.error || snapshot.error ? 'Unavailable' : formatPPM(savings?.currentRatePPM))}</td>
        <td class="num mono"><strong>${escapeHtml(utilization)}</strong><small class="smalltext">${escapeHtml(bridge?.error || snapshot.error ? 'Bridge read unavailable' : `${formatCompactAmount(bridge?.mintedLocal, 18)} / ${formatCompactAmount(bridge?.limitLocal, 18)} ${token?.symbol ?? currentSymbol(code)}`)}</small></td>
        <td>${statusPill(failed ? 'fail' : fresh.status, failed ? 'Partial / unavailable' : fresh.label)}<small class="smalltext">${escapeHtml(sourceBlock ? `Block ${sourceBlock.number}` : snapshot.error ?? 'Source block unavailable')}</small></td>
      </tr>`;
    }).join('');
  }

  function currencySupplyBars() {
    const rows = sortedComparisonRows();
    const maximum = rows.reduce((max, snapshot) => {
      const supply = bigintOrNull(section(snapshot, 'token')?.totalSupply) ?? 0n;
      return supply > max ? supply : max;
    }, 1n);
    return `<div class="currency-supply-chart" role="group" aria-label="Current token supply by independent currency, normalized to the largest verified supply">${rows.map((snapshot, index) => {
      const supply = bigintOrNull(section(snapshot, 'token')?.totalSupply);
      const width = supply === null ? 0 : Math.max(1, scaleRatio(supply, maximum) * 100);
      return `<button type="button" class="currency-supply-row" data-compare-code="${escapeHtml(snapshot.code)}"><span>${escapeHtml(snapshot.code)}</span><span class="currency-supply-track"><i style="width:${width.toFixed(2)}%;background:${RADAR_COLORS[index % RADAR_COLORS.length]}"></i></span><strong>${escapeHtml(supply === null ? 'Unavailable' : formatCompactAmount(supply, 18))}</strong></button>`;
    }).join('')}</div><p class="smalltext">Bar length is normalized only for visual comparison. Labels retain native K9 units; no combined market value or FX total is calculated.</p>`;
  }

  function currencyFingerprintRadar() {
    const usable = state.comparison.rows.filter((snapshot) => !snapshot.error);
    if (usable.length < 2) return '';
    const centerX = 150;
    const centerY = 142;
    const radius = 94;
    const angleFor = (index) => -Math.PI / 2 + index * 2 * Math.PI / FINGERPRINT_AXES.length;
    const axes = FINGERPRINT_AXES.map((axis) => {
      const maximum = usable.reduce((max, snapshot) => {
        const raw = bigintOrNull(axis.read(snapshot));
        return raw !== null && raw > max ? raw : max;
      }, 0n);
      return { ...axis, maximum };
    });
    const rings = [0.25, 0.5, 0.75, 1].map((fraction) => {
      const ringPoints = axes.map((axis, index) => { const angle = angleFor(index); return `${(centerX + Math.cos(angle) * radius * fraction).toFixed(2)},${(centerY + Math.sin(angle) * radius * fraction).toFixed(2)}`; }).join(' ');
      return `<polygon points="${ringPoints}" fill="none" stroke="#e6ddcf" stroke-width="1"/>`;
    }).join('');
    const spokes = axes.map((axis, index) => {
      const angle = angleFor(index);
      const endX = centerX + Math.cos(angle) * radius;
      const endY = centerY + Math.sin(angle) * radius;
      const labelX = centerX + Math.cos(angle) * (radius + 15);
      const labelY = centerY + Math.sin(angle) * (radius + 13);
      const anchor = Math.abs(Math.cos(angle)) < 0.35 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      const suffix = axis.maximum === 0n ? ' · unavailable' : '';
      return `<line class="grid-line" x1="${centerX}" y1="${centerY}" x2="${endX.toFixed(2)}" y2="${endY.toFixed(2)}"/><text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="${anchor}" font-size="8.5">${escapeHtml(axis.label.toUpperCase())}${escapeHtml(suffix)}</text>`;
    }).join('');
    const polygons = usable.map((snapshot, rowIndex) => {
      const color = RADAR_COLORS[rowIndex % RADAR_COLORS.length];
      const points = axes.map((axis, index) => {
        const raw = bigintOrNull(axis.read(snapshot));
        const ratio = raw === null ? 0 : scaleRatio(raw, axis.maximum);
        const angle = angleFor(index);
        return `${(centerX + Math.cos(angle) * radius * ratio).toFixed(2)},${(centerY + Math.sin(angle) * radius * ratio).toFixed(2)}`;
      }).join(' ');
      return `<polygon points="${points}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="1.6"><title>${escapeHtml(snapshot.code)} — independently normalized current reads; the center means the smallest verified read or unavailable.</title></polygon>`;
    }).join('');
    const legend = usable.map((snapshot, rowIndex) => `<span><i class="dash-swatch" style="background:${RADAR_COLORS[rowIndex % RADAR_COLORS.length]}"></i>${escapeHtml(snapshot.code)}</span>`).join('');
    return `<div class="dash-radar-layout"><svg class="dash-svg dash-radar" viewBox="0 0 300 284" role="img" aria-label="Currency fingerprint radar comparing independently normalized reads across verified systems">${rings}${spokes}${polygons}</svg><div class="dash-legend dash-radar-legend">${legend}</div></div><p class="smalltext">Each axis is independently normalized to the largest verified read of that measure across currencies. Axes never share units: no FX conversion, no summation and no cross-currency total is implied.</p>`;
  }

  function comparisonCard() {
    const rows = comparisonRows();
    return `<article class="dash-card currency-explorer"><div class="dash-card-head"><div><h3>Explore 12 currency systems</h3><p>Verified native-unit reads. No FX conversion, shared reserve or aggregate TVL is inferred.</p></div><div class="dash-actions"><button type="button" class="btn light small" id="dashboard-compare-refresh">Refresh currencies</button></div></div>
      <div class="currency-filter-row"><label class="dash-field">Search currencies<input type="search" id="dashboard-comparison-search" value="${escapeHtml(state.comparison.search)}" placeholder="K9CHF or CHF"></label><span>${sortedComparisonRows().length} of ${state.comparison.rows.length} systems</span></div>
      ${state.comparison.pending && !state.comparison.rows.length ? chartUnavailable('Currency systems are loading', 'Reading each verified system with limited RPC concurrency. Unavailable reads will remain explicit.', 'short') : `${currencySupplyBars()}<div class="dash-table-wrap currency-table-wrap" tabindex="0"><table class="dash-table currency-table"><thead><tr><th>${compareSortButton('Currency', 'code')}</th><th class="num">${compareSortButton('Token supply', 'supply')}</th><th class="num">${compareSortButton('System equity', 'equity')}</th><th class="num">${compareSortButton('Leadrate', 'rate')}</th><th class="num">${compareSortButton('Bridge used', 'bridge')}</th><th>Read status</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No currency matches this search.</td></tr>`}</tbody></table></div><details class="currency-radar"><summary>Compare normalized currency fingerprints</summary>${currencyFingerprintRadar()}</details>${state.comparison.pending ? '<div class="dash-note">Refreshing currency reads; existing cached rows remain visible until replacement reads arrive.</div>' : ''}`}</article>`;
  }

  async function loadComparison(force = false) {
    const nonce = ++state.comparison.nonce;
    const codes = (registryState()?.registry?.codes ?? (window.IMF_CURRENCIES ?? []).map(({ code }) => code)).filter((code) => getCapabilities(code).verified);
    state.comparison.pending = true;
    renderOverview();
    const rows = await mapLimit(codes, 3, (code) => cachedSystemSnapshot(code, force));
    if (nonce !== state.comparison.nonce) return;
    state.comparison.rows = rows;
    state.comparison.pending = false;
    if (state.panel === 'overview') renderOverview();
  }

  function bindComparison() {
    $('#dashboard-compare-refresh', root)?.addEventListener('click', () => {
      loadComparison(true).catch((cause) => notify(cause instanceof Error ? cause.message : String(cause), true));
    });
    $('#dashboard-comparison-search', root)?.addEventListener('input', (event) => {
      state.comparison.search = event.target.value;
      renderOverview();
      const search = $('#dashboard-comparison-search', root);
      search?.focus();
      search?.setSelectionRange(search.value.length, search.value.length);
    });
    $$('#dashboard-view [data-compare-sort]', root).forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.compareSort;
      if (state.comparison.sort === key) state.comparison.dir = state.comparison.dir === 'asc' ? 'desc' : 'asc';
      else {
        state.comparison.sort = key;
        state.comparison.dir = key === 'code' ? 'asc' : 'desc';
      }
      renderOverview();
    }));
    $$('#dashboard-view [data-compare-code]', root).forEach((button) => button.addEventListener('click', () => {
      const code = button.dataset.compareCode;
      if (!getCapabilities(code).verified) return;
      state.code = code;
      const sharedSelector = $('#v2-currency');
      if (sharedSelector) sharedSelector.value = code;
      const workspaceSelector = $('#workspace-currency');
      if (workspaceSelector) workspaceSelector.value = code;
      history.replaceState(null, '', dashboardHash(state.panel, code));
      render(false);
    }));
  }

  function renderOverview() {
    if (systemError(state.system)) {
      setPanelHtml('overview', `<div class="dash-stack">${unavailableCard(`${escapeHtml(currentCode())} V2 state is not verified`, state.system.error)}${comparisonCard()}${sourceNote()}</div>`);
      bindComparison();
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
    const zeroDebt = zeroDebtVerified();
    const kpis = [
      metricCard('Token supply', token?.error ? 'Unavailable' : formatCompactAmount(token?.totalSupply, 18, token?.symbol ?? currentSymbol()), readContext(token), token?.error ? 'fail' : 'pass'),
      metricCard('Gross position debt', debt === null ? 'Unavailable' : formatCompactAmount(debt, 18, currentSymbol()), zeroDebt ? `Verified zero gross debt across ${allPositions().length} discovered positions` : state.discovery?.error ?? discoveryCoverageText(), debt === null ? 'fail' : 'pass'),
      metricCard('System equity', equity?.error ? 'Unavailable' : formatCompactAmount(equity?.equityAmount, 18, token?.symbol ?? currentSymbol()), readContext(equity), equity?.error ? 'fail' : 'pass'),
      metricCard('Debt-weighted CR', weightedRatio === null ? (zeroDebt ? 'No debt' : 'Unavailable') : `${sdk().formatDecimal(weightedRatio, 1)}%`, zeroDebt ? 'Contract-parameter CR requires outstanding debt; zero is verified, not missing' : 'Stored liquidation parameters · not a market valuation', weightedRatio === null ? (zeroDebt ? 'info' : 'neutral') : 'pass'),
      metricCard('Discovered positions', positionCount, state.discovery?.error ?? discoveryCoverageText(), state.discoveryPending ? 'info' : state.discovery?.error ? 'fail' : 'pass'),
    ].join('');
    setPanelHtml('overview', `
      <div class="dash-stack">
        <div class="dash-kpis">${kpis}</div>
        ${comparisonCard()}
        <div class="dash-grid">
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Currency system accounting</h3><p>One independent ${escapeHtml(currentSymbol())} system. No shared reserve or automatic FX conversion.</p></div>${cardTag('LIVE CONTRACT READS', 'mint')}</div>${systemMap(token, bridge, savings, equity, positionCount)}</article>
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Collateral composition</h3><p>Discovered position count by collateral asset.</p></div>${cardTag('CURRENT DISCOVERY', 'mint')}</div>${collateralComposition()}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Bridge utilization</h3><p>Current minted local units against the verified per-system limit.</p></div>${cardTag('CURRENT READ', 'mint')}</div>${bridgeUtilization(bridge, token?.symbol ?? currentSymbol())}</article>
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Position risk constellation</h3><p>${zeroDebt ? 'Verified zero gross debt: minting capacity versus reserve contribution.' : 'Gross debt versus each position’s liquidation-parameter CR.'}</p></div>${cardTag('CLICK A BUBBLE')}</div>${currentPositionScatter()}</article>
        </div>
        <div class="dash-grid">
          <article class="dash-card"><div class="dash-card-head"><div><h3>CR distribution</h3><p>Discovered position count by collateral-ratio bucket.</p></div>${cardTag(`WATCH < ${state.scenario.threshold}%`, 'gold')}</div>${crDistribution()}</article>
        </div>
        ${history.status === 'ready' ? `<div class="dash-grid"><article class="dash-card span-6"><div class="dash-card-head"><div><h3>Gross position debt over time</h3><p>Per-position MintingUpdate history in native units.</p></div>${cardTag('INDEXED HISTORY', 'mint')}</div>${debtHistoryChart()}</article><article class="dash-card span-6"><div class="dash-card-head"><div><h3>Token mint & burn flow</h3><p>Zero-address token transfers grouped by UTC day; no DEX-volume inference.</p></div>${cardTag('INDEXED FLOW', 'mint')}</div>${tokenFlowHistory()}</article></div>` : '<div class="dash-note">Historical curves and complete token-flow timelines need a configured indexer. Current verified comparisons remain available above; no synthetic history is shown.</div>'}
        ${sourceNote()}
      </div>`);
    bindPositionPoints();
    bindComparison();
  }

  function sourceNote() {
    const capabilities = getCapabilities();
    if (capabilities.live) return `<div class="dash-note">Live dashboard reads for the selected ${escapeHtml(currentCode())} system come from its verified runtime-config V2 registry. Each currency remains independent.</div>`;
    if (capabilities.fixture) return `<div class="dash-note danger">SYNTHETIC FIXTURE — values are teaching inputs and are not deployed contract state.</div>`;
    if (capabilities.imported) return `<div class="dash-note">Imported registry reads are read-only. Guided writes remain restricted to the approved runtime-config USD system.</div>`;
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

  function zeroDebtVerified() {
    if (state.discoveryPending || state.discovery?.error || state.discovery?.synthetic) return false;
    return allPositions().length > 0 && discoveredDebt() === 0n;
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
    const note = entries.every((entry) => entry.ratio === null) ? '<div class="dash-note">Every discovered position carries verified zero gross debt: a contract-parameter CR is undefined here, not a hidden risk rating.</div>' : '<div class="dash-legend"><span>Watch threshold is user-defined, not a protocol-wide floor.</span></div>';
    return `<div class="dash-bar-list">${buckets.map((bucket) => `<div class="dash-bar-row"><span>${escapeHtml(bucket.label)}</span><div class="dash-bar-track"><div class="dash-bar-fill" style="width:${bucket.count / maximum * 100}%;background:${bucket.color}"></div></div><span class="dash-bar-value">${bucket.count} positions</span></div>`).join('')}</div>${note}`;
  }

  function currentPositionScatter() {
    if (state.discoveryPending) return chartUnavailable('Position map read in progress', 'Verified position points will appear after discovery.');
    if (!allPositions().length) return chartUnavailable('No position risk points', 'No discovered positions matched the current coverage.');
    const zeroDebt = zeroDebtVerified();
    const width = 700;
    const height = 270;
    const margin = { left: 60, right: 20, top: 18, bottom: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    if (zeroDebt) {
      const entries = allPositions().map((position) => ({ position, capacity: bigintOrNull(position.availableForMinting) ?? 0n, reserve: bigintOrNull(position.reserveContributionPPM) ?? 0n }));
      const maxCapacity = entries.reduce((maximum, entry) => entry.capacity > maximum ? entry.capacity : maximum, 1n);
      const maxReserve = entries.reduce((maximum, entry) => entry.reserve > maximum ? entry.reserve : maximum, 1n);
      const points = entries.map((entry) => {
        const x = margin.left + scaleRatio(entry.capacity, maxCapacity) * innerWidth;
        const y = margin.top + innerHeight - scaleRatio(entry.reserve, maxReserve) * innerHeight;
        const status = positionStatus(entry.position);
        const color = status.status === 'fail' ? '#ffcfd2' : status.status === 'warn' ? '#e9c46a' : status.status === 'info' ? '#bde0fe' : '#aee9d1';
        return `<circle class="point" tabindex="0" data-position-detail="${escapeHtml(entry.position.address)}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="7" fill="${color}" fill-opacity=".8" stroke="#2b2118" stroke-opacity=".45"><title>${escapeHtml(entry.position.address)} · minting capacity ${escapeHtml(formatAmount(entry.capacity, 18, currentSymbol()))} · reserve contribution ${escapeHtml(formatPPM(entry.reserve))}</title></circle>`;
      }).join('');
      return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Discovered position minting capacity versus reserve contribution">${[0, 1, 2, 3].map((line) => { const y = margin.top + line / 3 * innerHeight; return `<line class="grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"/><text x="${margin.left - 8}" y="${y + 3}" text-anchor="end" font-size="9">${escapeHtml(formatPPM(maxReserve * BigInt(3 - line) / 3n))}</text>`; }).join('')}${points}<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="9">FAMILY MINTING CAPACITY — VERIFIED ZERO GROSS DEBT</text></svg><div class="dash-legend"><span><i class="dash-swatch" style="background:#aee9d1"></i>Active</span><span><i class="dash-swatch" style="background:#bde0fe"></i>No debt</span><span><i class="dash-swatch" style="background:#e9c46a"></i>Watch</span><span><i class="dash-swatch" style="background:#ffcfd2"></i>Critical / challenged</span><span>Axes pivot to capacity because debt-dependent ratios are undefined at verified zero</span></div><div class="dash-note">All discovered positions carry verified zero gross debt. This view replaces debt and CR with real capacity and lifecycle dimensions; it is not a risk score.</div>`;
    }
    const entries = allPositions().map((position) => ({ position, cr: positionCollateralRatio(position) })).filter((entry) => entry.cr !== null);
    if (!entries.length) return chartUnavailable('No position risk points', 'No discovered positions have enough current data for a contract-parameter CR.');
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

  function collateralNativeBars() {
    if (state.discoveryPending) return chartUnavailable('Native collateral read in progress', 'Per-asset native-unit balances appear after discovery and verification complete.');
    if (state.discovery?.error) return chartUnavailable('Native collateral unavailable', state.discovery.error);
    const groups = collateralGroups();
    if (!groups.length) return chartUnavailable('No native collateral discovered', 'No verified positions matched the current discovery coverage.', 'short');
    const maxSegments = 8;
    const rows = groups.map((group) => {
      const members = allPositions().filter((position) => (position.collateral?.symbol ?? 'Unknown') === group.symbol);
      const decimals = members.find((position) => position.collateral?.decimals)?.collateral?.decimals ?? 18;
      const total = members.reduce((sum, position) => sum + (bigintOrNull(position.collateral?.balance) ?? 0n), 0n);
      const challenged = members.reduce((sum, position) => sum + (bigintOrNull(position.challengedAmount) ?? 0n), 0n);
      const ordered = members.slice().sort((left, right) => {
        const leftValue = bigintOrNull(left.collateral?.balance) ?? 0n;
        const rightValue = bigintOrNull(right.collateral?.balance) ?? 0n;
        return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
      });
      const shown = ordered.slice(0, maxSegments);
      const rest = ordered.slice(maxSegments);
      let offset = 0;
      const segments = shown.map((position, index) => {
        const share = total > 0n ? scaleRatio(bigintOrNull(position.collateral?.balance) ?? 0n, total) * 100 : 0;
        const segment = share <= 0 ? '' : `<div class="dash-seg" style="left:${offset.toFixed(2)}%;width:${share.toFixed(2)}%;background:${NATIVE_BAR_COLORS[index % NATIVE_BAR_COLORS.length]}" title="${escapeHtml(position.address)}: ${escapeHtml(formatAmount(position.collateral?.balance, decimals, group.symbol))}"></div>`;
        offset += share;
        return segment;
      }).join('');
      const restSegment = rest.length && 100 - offset > 0.05 ? `<div class="dash-seg dash-seg-rest" style="left:${offset.toFixed(2)}%;width:${(100 - offset).toFixed(2)}%">+${rest.length}</div>` : '';
      const challengedWidth = total > 0n ? scaleRatio(challenged, total) * 100 : 0;
      return `<div class="dash-native-row">
        <div class="dash-native-head"><strong>${escapeHtml(group.symbol)}</strong><span>${members.length} position${members.length === 1 ? '' : 's'}${rest.length ? ` · largest ${shown.length} shown` : ''}</span><b>${escapeHtml(formatAmount(total, decimals, group.symbol))}</b></div>
        <div class="dash-seg-track" role="img" aria-label="${escapeHtml(group.symbol)} collateral stacked per position in native units, total ${escapeHtml(formatAmount(total, decimals, group.symbol))}, challenged ${escapeHtml(formatAmount(challenged, decimals, group.symbol))}">${segments}${restSegment}${challengedWidth > 0.05 ? `<div class="dash-seg-challenged" style="width:${challengedWidth.toFixed(2)}%" title="Challenged ${escapeHtml(formatAmount(challenged, decimals, group.symbol))}"></div>` : ''}</div>
        <div class="dash-native-sub"><span>Challenged ${escapeHtml(formatAmount(challenged, decimals, group.symbol))} (hatched)</span><span>Scaled within this asset only; native units are never added across assets.</span></div>
      </div>`;
    }).join('');
    return `<div class="dash-native-list">${rows}</div><p class="smalltext">Each segment is an exact BigInt share of the same asset's total native balance. Bar length is comparable only within one asset row.</p>`;
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
          <article class="dash-card"><div class="dash-card-head"><div><h3>Native-unit collateral segments</h3><p>Each asset's discovered balances stacked per position in exact native units; challenged collateral is hatched.</p></div>${cardTag('NATIVE UNITS ONLY', 'mint')}</div>${collateralNativeBars()}</article>
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

  function lifecycleTimelines() {
    if (state.discoveryPending) return chartUnavailable('Lifecycle read in progress', 'Position start, cooldown and expiration timestamps appear after verification completes.', 'short');
    const shown = sortedPositions().slice(0, 12);
    if (!shown.length) return chartUnavailable('No position lifecycles discovered', 'No positions matched the current explorer filters and discovery coverage.', 'short');
    const timed = shown.filter((position) => bigintOrNull(position.start) !== null && bigintOrNull(position.expiration) !== null);
    if (!timed.length) return chartUnavailable('Lifecycle timestamps unavailable', 'Discovered positions do not carry start and expiration timestamps.', 'short');
    const first = timed.reduce((minimum, position) => { const value = bigintOrNull(position.start) ?? minimum; return value < minimum ? value : minimum; }, bigintOrNull(timed[0].start) ?? 0n);
    const last = timed.reduce((maximum, position) => { const value = bigintOrNull(position.expiration) ?? maximum; return value > maximum ? value : maximum; }, 0n);
    const span = last > first ? last - first : 1n;
    const now = sectionSource(state.system, ['token', 'bridge', 'savings', 'equity'])?.timestamp ?? state.discovery?.positions?.[0]?.sourceBlock?.timestamp ?? null;
    const width = 700;
    const rowHeight = 26;
    const margin = { left: 92, right: 18, top: 22, bottom: 30 };
    const innerWidth = width - margin.left - margin.right;
    const xFor = (when) => margin.left + Number((when - first) * BigInt(innerWidth) / span);
    const rows = shown.map((position, index) => {
      const y = margin.top + index * rowHeight;
      const label = `${position.address.slice(0, 6)}…${position.address.slice(-4)}`;
      const start = bigintOrNull(position.start);
      const cooldown = bigintOrNull(position.cooldown);
      const expiration = bigintOrNull(position.expiration);
      if (start === null || expiration === null) return `<g><text x="${margin.left - 8}" y="${y + 13}" text-anchor="end" font-size="9">${escapeHtml(label)}</text><text x="${margin.left}" y="${y + 13}" font-size="9">timestamps unavailable</text></g>`;
      const status = positionStatus(position);
      const startX = xFor(start);
      const endX = xFor(expiration);
      const cooldownX = cooldown !== null ? xFor(cooldown) : startX;
      const initWidth = Math.max(0, cooldownX - startX);
      const openWidth = Math.max(0, endX - cooldownX);
      const challenged = (bigintOrNull(position.challengedAmount) ?? 0n) > 0n;
      return `<g class="dash-life-row" tabindex="0" data-position-detail="${escapeHtml(position.address)}" role="button" aria-label="Position ${escapeHtml(position.address)} lifecycle from start ${escapeHtml(formatTimestamp(start))} through cooldown to expiration ${escapeHtml(formatTimestamp(expiration))}">
        <text x="${margin.left - 8}" y="${y + 13}" text-anchor="end" font-size="9">${escapeHtml(label)}</text>
        ${initWidth > 1 ? `<rect x="${startX.toFixed(2)}" y="${y + 5}" width="${initWidth.toFixed(2)}" height="12" fill="#fde9a8"><title>Start → cooldown end</title></rect>` : ''}
        ${openWidth > 1 ? `<rect x="${cooldownX.toFixed(2)}" y="${y + 5}" width="${openWidth.toFixed(2)}" height="12" fill="${status.status === 'fail' ? '#ffcfd2' : status.status === 'warn' ? '#e9c46a' : status.status === 'info' ? '#bde0fe' : '#cdeccf'}"><title>Cooldown end → expiration</title></rect>` : ''}
        <line x1="${endX.toFixed(2)}" y1="${y + 3}" x2="${endX.toFixed(2)}" y2="${y + 19}" stroke="#2b2118" stroke-width="1.4"/>
        ${challenged ? `<circle cx="${endX.toFixed(2)}" cy="${y + 11}" r="3.4" fill="#b84a42"/>` : ''}
        <title>${escapeHtml(position.address)} · start ${escapeHtml(formatTimestamp(start))} · cooldown ends ${escapeHtml(formatTimestamp(cooldown))} · expiration ${escapeHtml(formatTimestamp(expiration))}</title>
      </g>`;
    }).join('');
    const nowValue = bigintOrNull(now);
    const nowX = nowValue !== null && nowValue >= first && nowValue <= last ? xFor(nowValue) : null;
    const nowLine = nowX === null ? '' : `<line class="threshold" x1="${nowX.toFixed(2)}" y1="${margin.top - 6}" x2="${nowX.toFixed(2)}" y2="${margin.top + shown.length * rowHeight}"/><text x="${(nowX + 4).toFixed(2)}" y="${margin.top - 9}" font-size="8.5" fill="#b84a42">SOURCE BLOCK NOW</text>`;
    const height = margin.top + shown.length * rowHeight + margin.bottom;
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Position lifecycle timelines from start through cooldown to expiration">${rows}${nowLine}<text x="${margin.left}" y="${height - 8}" font-size="8.5">${escapeHtml(formatTimestamp(first))}</text><text x="${width - margin.right}" y="${height - 8}" text-anchor="end" font-size="8.5">${escapeHtml(formatTimestamp(last))}</text></svg><div class="dash-legend"><span><i class="dash-swatch" style="background:#fde9a8"></i>Start → cooldown</span><span><i class="dash-swatch" style="background:#cdeccf"></i>Open window → expiration</span><span><i class="dash-swatch" style="background:#bde0fe"></i>Initializing</span><span>Rows follow the current explorer filters · showing ${shown.length} of ${sortedPositions().length} · select a row for detail</span></div>`;
  }

  function cubeDefaults() {
    const anyDebt = allPositions().some((position) => (bigintOrNull(position.minted) ?? 0n) > 0n);
    if (anyDebt) return { x: 'debt', y: 'availableForMinting', z: 'collateral' };
    return { x: 'availableForMinting', y: 'reservePPM', z: 'collateral' };
  }

  function positionDataCube() {
    if (state.discoveryPending) return chartUnavailable('Position cloud read in progress', 'Verified position points will appear after discovery completes.', 'short');
    if (state.discovery?.error) return chartUnavailable('Position cloud unavailable', state.discovery.error, 'short');
    const positions = sortedPositions();
    if (!positions.length) return chartUnavailable('No position cloud', 'No positions matched the current explorer filters and discovery coverage.', 'short');
    if (!state.cube.axes.x || !CUBE_DIMENSIONS[state.cube.axes.x]) state.cube.axes = { ...cubeDefaults() };
    const zeroDebt = !positions.some((position) => (bigintOrNull(position.minted) ?? 0n) > 0n);
    const axisOptions = (selected) => Object.entries(CUBE_DIMENSIONS).map(([key, dimension]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${escapeHtml(dimension.label)}</option>`).join('');
    return `<div class="dash-toolbar dash-cube-controls"><label class="dash-field">X axis<select id="dashboard-cube-x">${axisOptions(state.cube.axes.x)}</select></label><label class="dash-field">Y axis<select id="dashboard-cube-y">${axisOptions(state.cube.axes.y)}</select></label><label class="dash-field">Z axis<select id="dashboard-cube-z">${axisOptions(state.cube.axes.z)}</select></label><span class="dash-cube-buttons"><button type="button" class="btn light" id="dashboard-cube-rotate-left" aria-label="Rotate left">⟲</button><button type="button" class="btn light" id="dashboard-cube-rotate-right" aria-label="Rotate right">⟳</button><button type="button" class="btn light" id="dashboard-cube-tilt-up" aria-label="Tilt up">▲</button><button type="button" class="btn light" id="dashboard-cube-tilt-down" aria-label="Tilt down">▼</button><button type="button" class="btn light" id="dashboard-cube-reset">Reset view</button><button type="button" class="btn light" id="dashboard-cube-mode" aria-pressed="${state.cube.mode === 'table'}">${state.cube.mode === 'table' ? '3D view' : 'Table view'}</button></span></div>
      ${zeroDebt ? '<div class="dash-note">All matching positions carry verified zero gross debt. Debt stays selectable, but capacity axes are the default; a point on the debt axis floor is a verified zero, not missing data.</div>' : ''}
      <div id="dashboard-cube-stage"></div>
      <div id="dashboard-cube-focus"></div>
      <p class="smalltext">Dependency-free projected SVG — no WebGL and no Three.js. Each axis is scaled with exact BigInt arithmetic against its own maximum before any pixel geometry is computed, and native units are never combined across dimensions. The table view carries the same values for assistive technology.</p>`;
  }

  function cubeTableHtml() {
    const positions = sortedPositions();
    const dimensions = [state.cube.axes.x, state.cube.axes.y, state.cube.axes.z].map((key) => ({ key, ...CUBE_DIMENSIONS[key] }));
    const head = dimensions.map((dimension) => `<th class="num">${escapeHtml(dimension.label)}</th>`).join('');
    const rows = positions.slice(0, 40).map((position) => {
      const status = positionStatus(position);
      return `<tr><td><button type="button" class="btn light small" data-cube-detail="${escapeHtml(position.address)}">${escapeHtml(position.address.slice(0, 10))}…</button></td><td>${escapeHtml(position.collateral?.symbol ?? 'Unknown')}</td>${dimensions.map((dimension) => `<td class="num mono">${escapeHtml(dimension.format(dimension.get(position), position))}</td>`).join('')}<td>${statusPill(status.status, status.label)}</td></tr>`;
    }).join('');
    return `<div class="dash-table-wrap" tabindex="0"><table class="dash-table"><thead><tr><th>Position</th><th>Collateral</th>${head}<th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><p class="smalltext">Accessible table fallback for the 3D cloud with identical axes and exact values.${positions.length > 40 ? ` Showing 40 of ${positions.length} matching positions.` : ''}</p>`;
  }

  function cubeSvg() {
    const positions = sortedPositions();
    const dimensions = [state.cube.axes.x, state.cube.axes.y, state.cube.axes.z].map((key) => ({ key, ...CUBE_DIMENSIONS[key] }));
    const maximums = dimensions.map((dimension) => positions.reduce((max, position) => { const raw = dimension.get(position); return raw > max ? raw : max; }, 0n));
    const width = 640;
    const height = 460;
    const centerX = width / 2;
    const centerY = height / 2 + 12;
    const radius = Math.min(width, height) * 0.335;
    const cosYaw = Math.cos(state.cube.yaw);
    const sinYaw = Math.sin(state.cube.yaw);
    const cosPitch = Math.cos(state.cube.pitch);
    const sinPitch = Math.sin(state.cube.pitch);
    const project = (x, y, z) => {
      const turnedX = x * cosYaw + z * sinYaw;
      const turnedZ = -x * sinYaw + z * cosYaw;
      const turnedY = y * cosPitch - turnedZ * sinPitch;
      const depth = y * sinPitch + turnedZ * cosPitch;
      const factor = 3.4 / (3.4 + depth);
      return { x: centerX + turnedX * factor * radius, y: centerY - turnedY * factor * radius, depth, factor };
    };
    const corners = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]];
    const edgePairs = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const frame = edgePairs.map(([a, b]) => { const pa = project(...corners[a]); const pb = project(...corners[b]); return `<line class="cube-edge" x1="${pa.x.toFixed(2)}" y1="${pa.y.toFixed(2)}" x2="${pb.x.toFixed(2)}" y2="${pb.y.toFixed(2)}"/>`; }).join('');
    const axisLines = dimensions.map((dimension, index) => {
      const unit = [0, 0, 0];
      unit[index] = 1;
      const from = project(-unit[0] * 0.5, -unit[1] * 0.5, -unit[2] * 0.5);
      const to = project(unit[0] * 0.5, unit[1] * 0.5, unit[2] * 0.5);
      const labelAt = project(unit[0] * 0.78, unit[1] * 0.78, unit[2] * 0.78);
      const zeroNote = maximums[index] === 0n ? ' · verified zero' : '';
      return `<line class="cube-axis" x1="${from.x.toFixed(2)}" y1="${from.y.toFixed(2)}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}"/><text class="cube-label" x="${labelAt.x.toFixed(2)}" y="${labelAt.y.toFixed(2)}" text-anchor="middle" font-size="9">${escapeHtml(dimension.short)}${escapeHtml(zeroNote)}</text>`;
    }).join('');
    const points = positions.map((position) => {
      const normalized = dimensions.map((dimension, index) => scaleRatio(dimension.get(position), maximums[index] || 1n) - 0.5);
      const projected = project(normalized[0], normalized[1], normalized[2]);
      const status = positionStatus(position);
      const focused = state.cube.focus && sameAddress(state.cube.focus, position.address);
      const radiusPoint = (3 + 2.6 * projected.factor + (focused ? 1.6 : 0)).toFixed(2);
      const ring = focused ? `<circle cx="${projected.x.toFixed(2)}" cy="${projected.y.toFixed(2)}" r="${(Number(radiusPoint) + 4).toFixed(2)}" fill="none" stroke="#2b2118" stroke-width="1.4" stroke-dasharray="3 3"/>` : '';
      return { html: `${ring}<circle class="dash-cube-point" tabindex="0" data-cube-point="${escapeHtml(position.address)}" cx="${projected.x.toFixed(2)}" cy="${projected.y.toFixed(2)}" r="${radiusPoint}" fill="${CUBE_POINT_COLORS[status.status] ?? '#aee9d1'}" fill-opacity="${focused ? '1' : '.82'}" stroke="#2b2118" stroke-opacity=".5"><title>${escapeHtml(position.address)} · ${escapeHtml(dimensions.map((dimension) => `${dimension.label} ${dimension.format(dimension.get(position), position)}`).join(' · '))}</title></circle>`, depth: projected.depth };
    }).sort((left, right) => right.depth - left.depth).map((point) => point.html).join('');
    const axisDescription = dimensions.map((dimension) => dimension.label).join(', ');
    return `<svg class="dash-svg dash-cube-svg" viewBox="0 0 ${width} ${height}" tabindex="0" role="img" aria-label="Projected three-dimensional position cloud with axes ${escapeHtml(axisDescription)}. Focus the chart and use arrow keys to rotate, or use the rotate buttons.">${frame}${axisLines}${points}</svg><div class="dash-legend"><span>Drag the chart or use ← → ↑ ↓ / buttons to rotate.</span><span>Select a point for exact axis values and a detail link.</span><span>${positions.length} matching positions</span></div>`;
  }

  function renderCubeStage() {
    const stage = $('#dashboard-cube-stage', root);
    if (!stage) return;
    stage.innerHTML = state.cube.mode === 'table' ? cubeTableHtml() : cubeSvg();
    renderCubeFocus();
    $$('#dashboard-cube-stage [data-cube-point]', root).forEach((point) => {
      const select = () => {
        state.cube.focus = state.cube.focus && sameAddress(state.cube.focus, point.dataset.cubePoint) ? null : point.dataset.cubePoint;
        renderCubeStage();
      };
      point.addEventListener('click', select);
      point.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
    $$('#dashboard-cube-stage [data-cube-detail]', root).forEach((button) => button.addEventListener('click', () => {
      const position = allPositions().find((candidate) => sameAddress(candidate.address, button.dataset.cubeDetail));
      if (position) openPositionDrawer(position);
    }));
    const svg = $('#dashboard-cube-stage svg', root);
    if (svg && state.cube.mode === '3d') bindCubeDrag(svg);
  }

  function renderCubeFocus() {
    const panel = $('#dashboard-cube-focus', root);
    if (!panel) return;
    const idle = '<p class="smalltext">Select a cloud point to inspect its exact axis values.</p>';
    if (!state.cube.focus) { panel.innerHTML = idle; return; }
    const position = allPositions().find((candidate) => sameAddress(candidate.address, state.cube.focus));
    if (!position) { state.cube.focus = null; panel.innerHTML = idle; return; }
    const dimensions = [state.cube.axes.x, state.cube.axes.y, state.cube.axes.z].map((key) => ({ key, ...CUBE_DIMENSIONS[key] }));
    const status = positionStatus(position);
    panel.innerHTML = `<div class="dash-cube-focus-card">${metricList([
      ['Position', position.address],
      ['Status', status.label],
      ...dimensions.map((dimension) => [`${dimension.label} (${dimension.short})`, dimension.format(dimension.get(position), position)]),
    ])}<div class="dash-actions" style="margin-top:10px"><button type="button" class="btn light small" id="dashboard-cube-open-detail">Open position detail</button><button type="button" class="btn light small" id="dashboard-cube-unfocus">Clear selection</button></div></div>`;
    $('#dashboard-cube-open-detail', root)?.addEventListener('click', () => openPositionDrawer(position));
    $('#dashboard-cube-unfocus', root)?.addEventListener('click', () => { state.cube.focus = null; renderCubeStage(); });
  }

  function bindCubeDrag(svg) {
    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      let lastX = event.clientX;
      let lastY = event.clientY;
      const move = (moveEvent) => {
        state.cube.yaw += (moveEvent.clientX - lastX) * 0.012;
        state.cube.pitch = Math.max(-1.3, Math.min(1.3, state.cube.pitch + (moveEvent.clientY - lastY) * 0.012));
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        renderCubeStage();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    svg.addEventListener('keydown', (event) => {
      const step = 0.22;
      if (event.key === 'ArrowLeft') state.cube.yaw -= step;
      else if (event.key === 'ArrowRight') state.cube.yaw += step;
      else if (event.key === 'ArrowUp') state.cube.pitch = Math.min(1.3, state.cube.pitch + step);
      else if (event.key === 'ArrowDown') state.cube.pitch = Math.max(-1.3, state.cube.pitch - step);
      else return;
      event.preventDefault();
      renderCubeStage();
    });
  }

  function bindDataCube() {
    for (const axis of ['x', 'y', 'z']) {
      $(`#dashboard-cube-${axis}`, root)?.addEventListener('change', (event) => { state.cube.axes[axis] = event.target.value; state.cube.focus = null; renderCubeStage(); });
    }
    const rotate = (dYaw, dPitch) => { state.cube.yaw += dYaw; state.cube.pitch = Math.max(-1.3, Math.min(1.3, state.cube.pitch + dPitch)); renderCubeStage(); };
    $('#dashboard-cube-rotate-left', root)?.addEventListener('click', () => rotate(-0.3, 0));
    $('#dashboard-cube-rotate-right', root)?.addEventListener('click', () => rotate(0.3, 0));
    $('#dashboard-cube-tilt-up', root)?.addEventListener('click', () => rotate(0, 0.2));
    $('#dashboard-cube-tilt-down', root)?.addEventListener('click', () => rotate(0, -0.2));
    $('#dashboard-cube-reset', root)?.addEventListener('click', () => { state.cube.axes = { ...cubeDefaults() }; state.cube.yaw = 0.65; state.cube.pitch = 0.42; state.cube.focus = null; state.cube.mode = '3d'; renderPositions(); });
    $('#dashboard-cube-mode', root)?.addEventListener('click', () => { state.cube.mode = state.cube.mode === 'table' ? '3d' : 'table'; renderCubeStage(); });
    renderCubeStage();
  }

  function bindLifecyclePoints() {
    $$('#dashboard-view [data-position-detail]', root).forEach((element) => {
      if (element.tagName !== 'g') return;
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const position = allPositions().find((candidate) => sameAddress(candidate.address, element.dataset.positionDetail));
        if (position) openPositionDrawer(position);
      });
    });
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
        <div class="dash-grid">
          <article class="dash-card span-5"><div class="dash-card-head"><div><h3>Position lifecycles</h3><p>Actual start → cooldown → expiration timelines against the current source block.</p></div>${cardTag('ACTUAL TIMESTAMPS')}</div>${lifecycleTimelines()}</article>
          <article class="dash-card span-7"><div class="dash-card-head"><div><h3>Position dataqube</h3><p>Interactive projected cloud of the filtered positions. Drag to rotate, pick axes, or open the table fallback.</p></div>${cardTag('INTERACTIVE')}</div>${positionDataCube()}</article>
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
    bindDataCube();
    bindLifecyclePoints();
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
    void drawer.offsetWidth;
    drawer.classList.add('open');
    backdrop.classList.add('open');
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
    const zeroDebt = zeroDebtVerified();
    const impactBody = zeroDebt
      ? `<div class="dash-note">All discovered positions carry verified zero gross debt. Collateral-ratio stress has no debt to reprice, so the book view pivots to real capacity and lifecycle dimensions instead of a scenario CR.</div>${currentPositionScatter()}`
      : entries.length ? riskScatter(entries) : unavailableCard('No scenario points', 'No discovered positions have enough collateral, price and debt data for a scenario CR.');
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
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Scenario impact</h3><p>${escapeHtml(scenarioLabel())}</p></div>${statusPill('warn', 'SCENARIO')}</div><div class="dash-kpis">${metricCard('Positions evaluated', String(entries.length), zeroDebt ? 'Verified zero gross debt across the discovered book' : 'Real discovered positions', 'pass')}${metricCard('Below watch threshold', String(affected.length), `Stressed CR < ${state.scenario.threshold}%`, affected.length ? 'warn' : 'pass')}${metricCard('Critical below 100%', String(entries.filter((entry) => entry.cr < 10000n).length), 'Scenario classification', 'pass')}${metricCard('Missing CR inputs', String(allPositions().length - entries.length), zeroDebt ? 'Expected with verified zero gross debt' : 'Unavailable inputs are excluded', allPositions().length - entries.length ? 'warn' : 'pass')}</div>${impactBody}</article>
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

  function activityEvents() {
    if (state.indexer.status !== 'ready') return state.discovery?.events ?? [];
    return state.indexer.events.map((event) => {
      const args = parseIndexedArgs(event);
      const type = event.event === 'PositionOpened' ? 'position-opened' : event.event === 'ChallengeStarted' ? 'challenge-started' : `${event.contract.toLowerCase()}-${event.event.toLowerCase()}`;
      const label = event.event.replace(/([a-z])([A-Z])/g, '$1 $2');
      const summary = event.event === 'PositionOpened'
        ? `Position ${args.position ?? event.subject} opened by ${args.owner ?? 'unknown owner'}`
        : event.event === 'ChallengeStarted'
          ? `Challenge ${args.number ?? 'unknown'} opened for position ${args.position ?? event.subject}`
          : `${event.contract} · ${event.subject ?? event.address}`;
      return {
        type,
        label,
        summary,
        position: args.position ?? event.subject,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        blockTimestamp: event.blockTimestamp,
        logIndex: event.logIndex,
      };
    });
  }

  function eventDayKey(event) {
    const timestamp = bigintOrNull(event.blockTimestamp);
    if (timestamp !== null && timestamp > 0n) return `day:${new Date(Number(timestamp) * 1000).toISOString().slice(0, 10)}`;
    const block = bigintOrNull(event.blockNumber);
    if (block === null) return 'day:unknown';
    const start = block / 5000n * 5000n;
    return `blocks:${start.toString()}`;
  }

  function activityCoverageText() {
    if (state.indexer.status === 'ready') return indexerCoverageText();
    if (state.indexer.status === 'stale' || state.indexer.status === 'error') return `${state.indexer.error}; using RPC discovery instead`;
    return discoveryCoverageText();
  }

  function filteredEvents() {
    const events = activityEvents().filter((event) => (state.activity.type === 'all' || event.type === state.activity.type) && (!state.activity.day || eventDayKey(event) === state.activity.day));
    const direction = state.activity.sort === 'desc' ? 1 : -1;
    return events.slice().sort((left, right) => {
      const leftBlock = bigintOrNull(left.blockNumber) ?? 0n;
      const rightBlock = bigintOrNull(right.blockNumber) ?? 0n;
      return leftBlock === rightBlock ? 0 : leftBlock > rightBlock ? -direction : direction;
    });
  }

  function activityDayTimeline() {
    if (state.discoveryPending) return chartUnavailable('Activity timeline read in progress', 'Event days appear after discovery completes; no zero activity is asserted during the scan.', 'short');
    const events = activityEvents();
    if (!events.length) return chartUnavailable('No real activity to timeline', state.discovery?.synthetic ? 'The synthetic fixture has no deployed event history.' : 'The scanned range contains no events; an empty result is shown only when discovery says so.', 'short');
    const buckets = new Map();
    for (const event of events) {
      const key = eventDayKey(event);
      if (!buckets.has(key)) buckets.set(key, { key, count: 0, order: 0n });
      const bucket = buckets.get(key);
      bucket.count += 1;
      const timestamp = bigintOrNull(event.blockTimestamp);
      const order = timestamp !== null && timestamp > 0n ? timestamp : (bigintOrNull(event.blockNumber) ?? 0n);
      if (order > bucket.order) bucket.order = order;
    }
    const byDay = state.indexer.status === 'ready';
    const rows = [...buckets.values()].sort((left, right) => left.order === right.order ? 0 : left.order > right.order ? 1 : -1).slice(-14);
    const maximum = Math.max(1, ...rows.map((row) => row.count));
    const width = 700;
    const rowHeight = 24;
    const margin = { left: 108, right: 44, top: 10, bottom: 24 };
    const innerWidth = width - margin.left - margin.right;
    const band = rowHeight;
    const bars = rows.map((row, index) => {
      const y = margin.top + index * band;
      const barHeight = 14;
      const barWidth = Math.max(2.5, row.count / maximum * innerWidth);
      const active = state.activity.day === row.key;
      const label = byDay ? row.key.slice(4) : `blocks ${row.key.slice(7)}`;
      return `<g class="day-bar ${active ? 'active' : ''}" tabindex="0" role="button" aria-pressed="${active}" data-activity-day="${escapeHtml(row.key)}" aria-label="Filter the ledger to ${escapeHtml(byDay ? `UTC day ${row.key.slice(4)}` : `block range ${row.key.slice(7)}`)}, ${row.count} events"><text x="${margin.left - 8}" y="${(y + barHeight / 2 + 3.5).toFixed(2)}" text-anchor="end" font-size="9">${escapeHtml(label)}</text><rect x="${margin.left}" y="${y}" width="${barWidth.toFixed(2)}" height="${barHeight}" rx="3" fill="${active ? '#396c3d' : '#9ac9a5'}"/><text x="${(margin.left + barWidth + 6).toFixed(2)}" y="${(y + barHeight / 2 + 3.5).toFixed(2)}" font-size="9">${row.count}</text><title>${escapeHtml(label)} · ${row.count} real events · select to filter, select again to clear</title></g>`;
    }).join('');
    const height = margin.top + rows.length * band + margin.bottom;
    return `<svg class="dash-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Real activity timeline per ${byDay ? 'UTC day' : 'block range'}; select a bar to filter the ledger">${bars}</svg><div class="dash-legend"><span>${byDay ? 'One bar per UTC day of indexed events, using actual block timestamps.' : 'RPC discovery carries no event timestamps; bars group events by block range instead of inventing days.'}</span><span>Select a bar to filter the ledger; select it again to clear.</span></div>${state.activity.day ? `<div class="dash-actions" style="margin-top:9px"><button type="button" class="btn light small" id="dashboard-activity-day-clear">Clear timeline filter · ${escapeHtml(state.activity.day.slice(4))}</button></div>` : ''}`;
  }

  function renderActivity() {
    if (state.discovery?.error) {
      setPanelHtml('activity', `<div class="dash-stack">${unavailableCard('Activity discovery is unavailable', state.discovery.error)}${sourceNote()}</div>`);
      return;
    }
    const events = activityEvents();
    const visible = filteredEvents();
    const eventRows = visible.slice(0, 50).map((event) => `<div class="dash-event"><div class="dash-event-icon">${escapeHtml(event.label.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}</div><div><strong>${escapeHtml(event.label)}</strong><small>${escapeHtml(event.summary)}<br>${escapeHtml(event.transactionHash ?? '')}</small></div><div class="event-amount">${txLink(event.transactionHash)}<small>block ${escapeHtml(String(event.blockNumber ?? 'unknown'))}</small></div></div>`).join('');
    const baseTypes = [['all', 'All events'], ['position-opened', 'Positions'], ['challenge-started', 'Challenges']];
    const extraTypes = [...new Set(events.map((event) => event.type))].filter((type) => !baseTypes.some(([key]) => key === type)).map((type) => [type, events.find((event) => event.type === type)?.label ?? type]);
    const types = [...baseTypes, ...extraTypes];
    setPanelHtml('activity', `
      <div class="dash-stack">
        <div class="dash-grid">
          <article class="dash-card span-8"><div class="dash-card-head"><div><h3>Challenge & Dutch-auction replay</h3><p>Uses actual challenge timestamps and period data when available.</p></div>${cardTag('SCENARIO REPLAY', 'gold')}</div>
            <div class="dash-toolbar"><label class="dash-field">Challenge index<input id="dashboard-challenge-index" inputmode="numeric" pattern="[0-9]+" value="0"></label><button type="button" class="btn mint" id="dashboard-load-challenge">Read challenge</button><button type="button" class="btn light" id="dashboard-replay-toggle">${state.replay.playing ? 'Pause' : 'Play'}</button><button type="button" class="btn light" id="dashboard-replay-reset">Reset</button></div>
            <div id="dashboard-challenge-panel">${challengeHtml()}</div>
          </article>
          <article class="dash-card span-4"><div class="dash-card-head"><div><h3>Activity summary</h3><p>${escapeHtml(activityCoverageText())}</p></div></div>${metricList([
            ['Event types', state.discoveryPending ? 'Discovery in progress' : state.discovery?.synthetic ? 'Synthetic fixture' : state.indexer.status === 'ready' ? `${Math.max(0, types.length - 1)} indexed filters` : 'PositionOpened · ChallengeStarted'],
            ['Events discovered', state.discoveryPending ? 'Read in progress' : String(events.length)],
            ['Matching filter', state.discoveryPending ? 'Read in progress' : String(visible.length)],
            ['Account context', state.discovery?.account ?? 'Not supplied'],
            ['Complete / partial', state.discoveryPending ? 'Pending' : state.indexer.status === 'ready' ? String(state.indexer.complete ? 'Complete event result' : 'Partial event result') : state.discovery ? String(state.discovery.complete ? 'Complete RPC discovery' : 'Partial RPC discovery') : 'Unknown'],
            ['History / volume', state.indexer.status === 'ready' ? 'Indexed event history · no DEX volume' : 'Unavailable — indexer not configured'],
          ])}<div class="dash-note">An inactive first challenge phase does not prove settlement completion. Reread contract state before drawing a conclusion.</div></article>
        </div>
        <article class="dash-card"><div class="dash-card-head"><div><h3>Activity timeline</h3><p>Real discovered events per ${state.indexer.status === 'ready' ? 'UTC day from indexed block timestamps' : 'block range (RPC discovery carries no timestamps)'}; select a bar to filter the ledger below.</p></div>${cardTag(state.indexer.status === 'ready' ? 'INDEXED DAYS' : 'DISCOVERED BLOCKS', state.indexer.status === 'ready' ? 'mint' : 'gold')}</div>${activityDayTimeline()}</article>
        <div class="dash-card"><div class="dash-card-head"><div><h3>Protocol event ledger</h3><p>Real discovered events with transaction hashes. No generated event rows are shown.</p></div><button type="button" class="btn light small" id="dashboard-activity-sort">${state.activity.sort === 'desc' ? 'Newest first' : 'Oldest first'}</button></div><div class="dash-event-layout"><div class="dash-event-types" aria-label="Event type filters">${types.map(([key, label]) => { const count = key === 'all' ? events.length : events.filter((event) => event.type === key).length; return `<button type="button" data-event-type="${key}" class="${state.activity.type === key ? 'active' : ''}" aria-pressed="${state.activity.type === key}"><span>${label}</span><span class="n">${count}</span></button>`; }).join('')}</div><div>${visible.length ? `<div class="dash-event-list">${eventRows}</div>` : unavailableCard(state.discoveryPending ? 'Event discovery is in progress' : 'No matching real events', state.discoveryPending ? 'The dashboard is scanning verified events. No zero or empty event history is asserted yet.' : state.discovery?.synthetic ? 'The synthetic fixture has no deployed event history.' : state.activity.day ? 'The selected timeline day or block range contains no events of the current type. Clear the timeline filter to see the full ledger.' : 'The scanned range or selected event-type filter contains no matching events.')}</div></div></div>
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
    $$('#dashboard-view [data-activity-day]', root).forEach((bar) => {
      const apply = () => {
        state.activity.day = state.activity.day === bar.dataset.activityDay ? null : bar.dataset.activityDay;
        renderActivity();
      };
      bar.addEventListener('click', apply);
      bar.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); apply(); } });
    });
    $('#dashboard-activity-day-clear', root)?.addEventListener('click', () => { state.activity.day = null; renderActivity(); });
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
          ? `<div class="dash-grid"><article class="dash-card span-6"><div class="dash-card-head"><div><h3>SDK read coverage</h3><p>Capabilities detected for the selected verified registry.</p></div>${cardTag('CURRENT STATE', 'mint')}</div>${metricList(Object.entries(capabilities.capabilities).map(([label, enabled]) => [label, enabled ? 'Available' : 'Unavailable — adapter not configured']))}</article><article class="dash-card span-6"><div class="dash-card-head"><div><h3>Analytics still required</h3><p>Unavailable fields are never replaced with generated telemetry.</p></div>${cardTag('EXPLICIT UNKNOWN', 'gold')}</div>${metricList([['Historical event coverage', indexerCoverageText()], ['Position enumeration', discoveryCoverageText()], ['Reference marks', 'Verified market feed required'], ['Volume and depth', 'Verified market feed required'], ['Cross-currency FX', 'Explicit provenance required'], ['Production readiness', 'Not claimed']])}</article></div>`
          : `<div class="dash-stack">${READINESS_GATES.map(([label, description], index) => `<div class="unavailable-card"><strong>${index + 1}. ${escapeHtml(label)}</strong><p>${escapeHtml(description)}</p></div>`).join('')}</div>`;
    setPanelHtml('parameters', `
      <div class="dash-stack">
        <div class="dash-card"><div class="dash-card-head"><div><h3>System parameters</h3><p>Current on-chain values, registry evidence, adapter coverage and repository-owned readiness gates.</p></div></div><div class="dash-tabs" role="tablist" aria-label="Parameter views">${[['current', 'Current values'], ['registry', `${currentCode()} registry`], ['sources', 'Data sources'], ['gates', 'Readiness gates']].map(([key, label]) => `<button type="button" role="tab" data-parameter-tab="${key}" class="${state.parametersTab === key ? 'active' : ''}" aria-selected="${state.parametersTab === key}">${label}</button>`).join('')}</div>${currentPanel}</div>
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
    if (state.cube.code !== code) {
      state.cube.axes = { x: '', y: '', z: '' };
      state.cube.focus = null;
      state.cube.code = code;
    }
    if (!force && state.system && !state.system.error && state.discovery && !state.discovery.error && !state.discoveryPending && state.system.code === code && state.discovery.code === code) {
      await renderActivePanel();
      return;
    }
    const account = normalizedAccount();
    if (force) {
      systemCache.delete(code);
      app().invalidateReadCache?.(code);
      window.IMF_DISCOVERY.invalidate?.(code);
    }
    state.discovery = null;
    state.discoveryPending = true;
    state.indexer = { status: 'pending', health: null, events: [], positions: [], complete: false, error: null };
    state.challenge = null;
    stopReplay();
    const systemPromise = getSystemSnapshot(code, force);
    const discoveryPromise = getDiscoveredPositions(code, { account, force });
    const indexerPromise = getIndexerBundle(code);
    const system = await systemPromise;
    if (nonce !== state.nonce) return;
    state.system = system;
    await renderActivePanel();
    try {
      const [discovery, indexer] = await Promise.all([discoveryPromise, indexerPromise]);
      if (nonce !== state.nonce) return;
      state.discovery = discovery;
      state.indexer = indexer;
    } finally {
      if (nonce === state.nonce) {
        state.discoveryPending = false;
        await renderActivePanel();
        if (state.panel === 'overview' && registryState()?.registry && !state.comparison.pending && (force || !state.comparison.rows.length)) {
          loadComparison(force).catch((cause) => notify(cause instanceof Error ? cause.message : String(cause), true));
        }
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

  async function invalidate(code = null) {
    if (code) systemCache.delete(code);
    else systemCache.clear();
    if (!code || currentCode() === code) {
      state.system = null;
      state.discovery = null;
      state.comparison.rows = [];
      await render(true);
    }
  }

  function routeFromHash(hash = location.hash) {
    const clean = hash.replace(/^#\/?/, '');
    if (clean === 'dashboard') return { panel: 'overview', code: null };
    const match = clean.match(/^dashboard\/([a-z-]+)(?:\/([a-zA-Z]+))?$/);
    if (!match || !PANELS.includes(match[1])) return null;
    const code = match[2]?.toUpperCase() ?? null;
    if (code && !(window.IMF_CURRENCIES ?? []).some((currency) => currency.code === code)) return null;
    return { panel: match[1], code };
  }

  function panelFromHash(hash = location.hash) {
    return routeFromHash(hash)?.panel ?? null;
  }

  function dashboardHash(panel, code = currentCode()) {
    return `#dashboard/${panel}/${code}`;
  }

  function revealTab(button, behavior = 'auto') {
    if (!button) return;
    const list = button.closest('.dashboard-nav');
    if (!list) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const buttonBounds = button.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    const left = list.scrollLeft + buttonBounds.left - listBounds.left - (list.clientWidth - buttonBounds.width) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : behavior });
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
    renderPageCopy(sectionSource(state.system, ['token', 'bridge', 'savings', 'equity']));
    if (updateHash) history.replaceState(null, '', dashboardHash(panel));
    if (focusTab) activeButton?.focus();
    revealTab(activeButton, updateHash ? 'smooth' : 'auto');
    render();
  }

  function activate(panel = panelFromHash() ?? 'overview') {
    const route = routeFromHash();
    if (route?.code) state.code = route.code;
    setPanel(panel, { updateHash: false });
    if (!location.hash.startsWith('#dashboard')) history.replaceState(null, '', dashboardHash(panel));
  }

  function init(options) {
    hooks = options;
    root = $('#dashboard-view');
    drawer = $('#dashboard-drawer');
    backdrop = $('#dashboard-drawer-backdrop');
    if (!root) return { activate, refresh: (force = false) => render(force), panelFromHash };
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
      history.replaceState(null, '', dashboardHash(state.panel, state.code));
      render(false);
    });
    $('#dashboard-refresh', root)?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Reloading…';
      notify('Refreshing verified current reads and discovery coverage.');
      try {
        await render(true);
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = 'Reload now';
      }
    });
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
      const route = routeFromHash();
      if (route && !root.hidden) {
        if (route.code) state.code = route.code;
        setPanel(route.panel, { updateHash: false });
      }
    });
    return { activate, refresh: (force = false) => render(force), panelFromHash };
  }

  window.IMF_DASHBOARD = { init, invalidate, panelFromHash, routeFromHash, PANELS };
})();
