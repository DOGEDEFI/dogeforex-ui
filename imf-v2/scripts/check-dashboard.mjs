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
  assert(dashboard.includes(`'${panel}'`), `dashboard module does not name ${panel}`);
}
assert(appHtml.indexOf('data-view="dashboard"') < appHtml.indexOf('data-view="create"'), 'Dashboard must be the first workspace menu item');
assert(appHtml.includes('href="../assets/dashboard.css"'), 'app must load dashboard.css');
assert(appHtml.includes('id="dashboard-drawer"') && appHtml.includes('id="dashboard-source-status"'), 'dashboard shell is missing provenance or drawer');

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
