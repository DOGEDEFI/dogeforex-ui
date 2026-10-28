import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const appHtml = read('app/index.html');
const dashboard = read('assets/dashboard.js');
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
assert(appHtml.includes('class="nav-group">Monitor') && appHtml.includes('class="nav-group">Positions') && appHtml.includes('class="nav-group">Participate') && appHtml.includes('class="nav-group">Resources'), 'workspace navigation must be grouped by user intent');
assert(dashboard.includes('ArrowLeft') && dashboard.includes('ArrowRight') && dashboard.includes("'Home'") && dashboard.includes("'End'"), 'dashboard tabs must support keyboard navigation');
assert(dashboard.includes('function systemMap(') && dashboard.includes('function bridgeUtilization('), 'live-data visual components are missing');
assert(dashboard.includes('minted * 10000n / limit'), 'bridge utilization must use exact integer arithmetic');
assert(appHtml.indexOf('data-view="dashboard"') < appHtml.indexOf('data-view="create"'), 'Dashboard must be the first workspace menu item');
assert(appHtml.includes('href="../assets/dashboard.css"'), 'app must load dashboard.css');
assert(appHtml.includes('id="dashboard-drawer"') && appHtml.includes('id="dashboard-source-status"'), 'dashboard shell is missing provenance or drawer');
for (const control of ['dashboard-currency', 'dashboard-copy-view', 'dashboard-export-view', 'dashboard-reset', 'dashboard-refresh', 'dashboard-method-dialog']) {
  assert(appHtml.includes(`id="${control}"`), `missing prototype dashboard control ${control}`);
}
for (const component of ['collateralComposition', 'reserveHealth', 'currentPositionScatter', 'crDistribution', 'scenarioExposure', 'filteredEvents', 'exportCurrentView']) {
  assert(dashboard.includes(`function ${component}(`), `missing prototype visual or interaction ${component}`);
}
assert(dashboard.includes('PANEL_COPY') && dashboard.includes('Protocol at a glance.') && dashboard.includes('Stress the book.'), 'prototype page copy is missing');
assert(dashboard.includes('Share of discovered position count, not collateral market value'), 'collateral composition must not imply value without FX provenance');
assert(dashboard.includes('not an estimated loss'), 'scenario debt exposure must not be presented as a loss waterfall');

for (const method of ['getCapabilities', 'getSystemSnapshot', 'getDiscoveredPositions', 'getChallenge', 'getHistory', 'getReferenceMarks', 'getEvents']) {
  assert(dashboard.includes(method), `dashboard adapter is missing ${method}`);
}
assert(dashboard.includes('History unavailable — indexer not configured'), 'history must remain an explicit unavailable state');
assert(dashboard.includes('Reference marks unavailable'), 'reference marks must remain an explicit unavailable state');
assert(dashboard.includes('SYNTHETIC FIXTURE'), 'fixture boundary must be explicit');
assert(dashboard.includes('runtime-config') && dashboard.includes("code === 'USD'"), 'live deployed reads must be runtime-config USD only');
assert(dashboard.includes('clientFor(code)'), 'dashboard must reuse the existing verified V2 client');
assert(dashboard.includes('window.IMF_DISCOVERY.discover'), 'dashboard must reuse event discovery');
assert(dashboard.includes('csvCell'), 'CSV exports must preserve formula-injection escaping');

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
for (const topic of ['Collateral ratio', 'Equity', 'minter reserve', 'liquidation price', 'reference mark', 'source block', 'unavailable', 'runtime-config verified USD', 'synthetic fixture']) {
  assert(guide.html.includes(topic), `dashboard guide missing ${topic}`);
}

console.log(JSON.stringify({ ok: true, panels, guide: guide.id, staticBoundary: 'verified-reads-only' }, null, 2));
