import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const appHtml = read('app/index.html');
const dashboard = read('assets/dashboard.js');
const v2 = read('assets/v2.js');
const actions = read('assets/actions.js');
const styles = read('assets/dashboard.css');
const build = read('scripts/build.mjs');
const discoveryCheck = read('scripts/check-discoverability.py');
const articles = JSON.parse(read('assets/articles.json'));

const panels = ['overview', 'collateral', 'positions', 'markets', 'risk', 'activity', 'parameters'];
for (const panel of panels) {
  assert(appHtml.includes(`id="dashboard-${panel}"`), `missing dashboard panel ${panel}`);
  assert(appHtml.includes(`data-dashboard="${panel}"`), `missing dashboard navigation ${panel}`);
  assert(appHtml.includes(`id="dashboard-tab-${panel}"`), `missing dashboard tab ${panel}`);
  assert(appHtml.includes(`aria-controls="dashboard-${panel}"`), `missing tab relationship ${panel}`);
  assert(appHtml.includes(`aria-labelledby="dashboard-tab-${panel}"`), `missing tabpanel relationship ${panel}`);
  assert(dashboard.includes(`'${panel}'`), `dashboard module does not name ${panel}`);
}
assert(appHtml.includes('class="dashboard-nav" aria-label="Dashboard views" role="tablist"'), 'dashboard must use one horizontal tablist');
assert(!appHtml.includes('class="dashboard-layout"'), 'dashboard must not restore a nested sidebar layout');
assert(appHtml.includes('class="workspace-primary"') && appHtml.includes('data-ecosystem-focus="savings"') && appHtml.includes('data-ecosystem-focus="equity"') && appHtml.includes('class="workspace-more"'), 'workspace must lead with Borrow, Earn, Invest, Dashboard and More');
assert(appHtml.includes('id="workspace-currency"') && appHtml.includes('id="borrow-find-positions"'), 'currency selector and read-backed borrow browser are required');
assert(dashboard.includes('ArrowLeft') && dashboard.includes('ArrowRight') && dashboard.includes("'Home'") && dashboard.includes("'End'"), 'dashboard tabs must support keyboard navigation');
assert(dashboard.includes('function systemMap(') && dashboard.includes('function bridgeUtilization('), 'live-data visual components are missing');
assert(dashboard.includes('minted * 10000n / limit'), 'bridge utilization must use exact integer arithmetic');
assert(appHtml.indexOf('data-view="create"') < appHtml.indexOf('data-ecosystem-focus="savings"') && appHtml.indexOf('data-ecosystem-focus="savings"') < appHtml.indexOf('data-ecosystem-focus="equity"'), 'Borrow, Earn and Invest must retain their goal-oriented order');
assert(dashboard.includes('function currencySupplyBars(') && dashboard.includes('function sortedComparisonRows(') && !dashboard.includes('dashboard-compare-toggle'), 'all-currency explorer must be visible by default with native-unit bars and sorting');
assert(appHtml.includes('href="../assets/dashboard.css"'), 'app must load dashboard.css');
assert(appHtml.includes('id="dashboard-drawer"') && appHtml.includes('id="dashboard-source-status"'), 'dashboard shell is missing provenance or drawer');
for (const control of ['dashboard-currency', 'dashboard-copy-view', 'dashboard-export-view', 'dashboard-reset', 'dashboard-refresh', 'dashboard-method-dialog']) {
  assert(appHtml.includes(`id="${control}"`), `missing prototype dashboard control ${control}`);
}
for (const component of ['collateralComposition', 'currentPositionScatter', 'crDistribution', 'scenarioExposure', 'filteredEvents', 'exportCurrentView', 'currencyFingerprintRadar', 'collateralNativeBars', 'lifecycleTimelines', 'activityDayTimeline', 'positionDataCube', 'renderCubeStage', 'cubeDefaults', 'zeroDebtVerified', 'eventDayKey']) {
  assert(dashboard.includes(`function ${component}(`), `missing prototype visual or interaction ${component}`);
}
assert(!dashboard.includes('function reserveHealth('), 'reserve health helper must stay removed');
assert(!dashboard.includes('Reserve health'), 'reserve health card copy must stay removed');
assert(dashboard.includes('bridgeUtilization(bridge'), 'bridge utilization must remain available on the overview');
assert(dashboard.includes('independently normalized'), 'currency fingerprint radar must normalize each axis independently');
assert(dashboard.includes('verified zero gross debt'), 'verified zero debt must be displayed explicitly');
assert(dashboard.includes('dashboard-cube-x') && dashboard.includes('dashboard-cube-y') && dashboard.includes('dashboard-cube-z'), 'data cube requires X, Y and Z axis dropdowns');
assert(dashboard.includes('data-activity-day'), 'activity day timeline must support click-to-filter');
assert(dashboard.includes('Table view'), 'data cube must provide an accessible table fallback');
assert(dashboard.includes('* 100000n / safeMaximum'), 'display scaling must keep exact BigInt arithmetic');
assert(!/THREE\.|from\s+['"]three['"]|require\(\s*['"]three['"]\)/.test(dashboard), 'dashboard must remain dependency-free: no Three.js');
assert(/prefers-reduced-motion/.test(styles), 'dashboard styles must respect reduced motion');
assert(dashboard.includes('PANEL_COPY') && dashboard.includes('Protocol at a glance.') && dashboard.includes('Stress the book.'), 'prototype page copy is missing');
assert(dashboard.includes('Share of discovered position count, not collateral market value'), 'collateral composition must not imply value without FX provenance');
assert(dashboard.includes('not an estimated loss'), 'scenario debt exposure must not be presented as a loss waterfall');

for (const method of ['getCapabilities', 'getSystemSnapshot', 'getDiscoveredPositions', 'getChallenge', 'getHistory', 'getReferenceMarks', 'getEvents']) {
  assert(dashboard.includes(method), `dashboard adapter is missing ${method}`);
}
for (const component of ['comparisonCard', 'loadComparison', 'debtHistoryChart', 'tokenFlowHistory', 'activityEvents', 'routeFromHash', 'getIndexerBundle']) {
  assert(dashboard.includes(`function ${component}(`), `missing all-currency or indexer component ${component}`);
}
assert(dashboard.includes('#dashboard/${panel}/${code}'), 'dashboard deep links must preserve panel and currency');
assert(dashboard.includes('No FX conversion, shared reserve or aggregate TVL is inferred'), 'all-currency comparison must not imply cross-currency aggregation');
assert(dashboard.includes("state.indexer.status === 'ready' && state.indexer.complete"), 'indexer history requires complete coverage');
assert(build.includes('IMF_INDEXER_URL'), 'build must support an explicit optional indexer URL');
assert(dashboard.includes('History unavailable — indexer not configured'), 'history must remain an explicit unavailable state');
assert(dashboard.includes('Reference marks unavailable'), 'reference marks must remain an explicit unavailable state');
assert(dashboard.includes('SYNTHETIC FIXTURE'), 'fixture boundary must be explicit');
assert(dashboard.includes("runtime?.source === 'runtime-config'"), 'live deployed reads must require runtime-config verification');
assert(!dashboard.includes("runtime?.source === 'runtime-config' && code === 'USD'"), 'dashboard reads must not be restricted to USD');
assert(dashboard.includes('clientFor(code,'), 'dashboard must reuse the existing verified V2 client');
assert(dashboard.includes("readDashboardAnalytics('system'") && dashboard.includes("readDashboardAnalytics('dashboard-discovery'"), 'public dashboard reads must use the hourly analytics cache');
assert(dashboard.includes('function hourlyReadNote(') && dashboard.includes('auto-refresh hourly'), 'dashboard must show its hourly update age');
assert(dashboard.includes('{ resume: !coverage.force }'), 'manual reload must force full discovery while normal reads resume incrementally');
assert(v2.includes("clientFor(field('currency').value, { fresh: true })") && v2.includes('clientFor(code, { fresh: true })'), 'guided quote/read paths must force fresh verification');
assert(actions.includes('v2.clientFor(code, { fresh: true })'), 'guided transaction preparation must force fresh verification');
assert(actions.includes('window.IMF_V2_APP.onReadReceipt?.(receipt)') && actions.includes('window.IMF_DASHBOARD.invalidate?.()'), 'confirmed receipts must invalidate dashboard analytics');
assert(dashboard.includes('window.IMF_DISCOVERY.discover'), 'dashboard must reuse event discovery');
assert(dashboard.includes('client.instance.transactions?.deployments?.MintingHub') === false, 'dashboard must delegate per-instance deployment discovery');
assert(read('assets/discovery.js').includes('client.instance.transactions?.deployments?.MintingHub'), 'discovery must use the selected currency deployment transaction');
assert(dashboard.includes('csvCell'), 'CSV exports must preserve formula-injection escaping');

const expectedCodes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CNY', 'BRL', 'PKR', 'BDT', 'INR', 'NGN', 'CHF'];
const configuredRegistries = JSON.parse(read('config/runtime.testnet.json')).registry;
assert.deepEqual(configuredRegistries.map((registry) => registry.code), expectedCodes, 'runtime must contain all approved registries in order');
for (const [index, code] of expectedCodes.entries()) {
  const source = JSON.parse(read(`../../dogeforex-protocol/scripts/deployment/deployments/chikyuV2/${code}_V2Registry.json`));
  assert.deepEqual(configuredRegistries[index], source.linkedData, `${code} runtime registry differs from protocol evidence`);
}

const forbiddenSynthetic = [/generatePositions/, /makeHistory/, /assetHistory/, /DEMO_NOW/, /SYNTHETIC TELEMETRY/, /const POSITIONS=/, /const SYSTEMS=/, /rng\(/];
for (const pattern of forbiddenSynthetic) {
  assert(!pattern.test(dashboard), `dashboard contains prototype-only synthetic data pattern ${pattern}`);
}
assert(!/https:\/\/fonts\.googleapis|fonts\.gstatic/.test(dashboard + styles + appHtml), 'dashboard must not load remote fonts');
assert(!/Number\([^)]*(?:minted|collateral|balance|price|supply|reserve|capacity|limit|shares|votes|debt)/i.test(dashboard), 'raw monetary values must not use Number conversion');
assert(build.includes('/assets/dashboard.js'), 'build must inject dashboard.js');
assert(discoveryCheck.includes("'/assets/dashboard.js'"), 'discoverability must assert dashboard script order');

const guide = articles.find((article) => article.id === 'dashboard-metrics');
assert(guide, 'dashboard guide is missing');
for (const topic of ['Collateral ratio', 'Equity', 'minter reserve', 'liquidation price', 'reference mark', 'source block', 'unavailable', 'runtime-config registries', 'synthetic fixture']) {
  assert(guide.html.includes(topic), `dashboard guide missing ${topic}`);
}

console.log(JSON.stringify({ ok: true, panels, guide: guide.id, staticBoundary: 'verified-reads-only' }, null, 2));
