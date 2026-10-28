import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const fixture = !process.argv.includes('--default');
const reviewBase = Number(process.env.IMF_REVIEW_PORT_BASE || 5180);
const fixtureBase = Number(process.env.IMF_FIXTURE_PORT_BASE || 5190);
const portBase = fixture ? fixtureBase : reviewBase;
const origins = Object.fromEntries(['website', 'docs', 'app'].map((surface, index) => [surface, `http://127.0.0.1:${portBase + index}/`]));
const publicOrigins = origins;
const artifacts = path.resolve('artifacts');
const downloads = path.join(artifacts, 'downloads');
fs.mkdirSync(downloads, { recursive: true });
const results = [];
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(executablePath)) throw new Error('Set CHROME_PATH to an installed Chrome or Chromium executable');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imf-v2-chrome-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath,
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 },
  args: ['--no-first-run', '--disable-gpu'],
});
const browserErrors = [];
function watchPage(page) {
  page.on('pageerror', (error) => browserErrors.push(error.message));
}
let currentPage = await context.newPage();
watchPage(currentPage);
const pages = new Map();
let pendingDownload = null;

async function command(action, args = {}) {
  if (action === 'evaluate') {
    let timer;
    try {
      return await Promise.race([
        currentPage.evaluate(args.code),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser evaluation timed out: ${args.code.slice(0, 220)}`)), 20000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  if (action === 'fill') return currentPage.fill(args.selector, args.value);
  if (action === 'click') {
    pendingDownload = args.selector.includes('export') ? currentPage.waitForEvent('download', { timeout: 10000 }).catch(() => null) : null;
    return currentPage.click(args.selector);
  }
  if (action === 'navigate') return currentPage.goto(args.url, { waitUntil: 'load' });
  if (action === 'screenshot') return currentPage.screenshot({ path: args.path, type: args.format });
  if (action === 'upload') return currentPage.setInputFiles(args.selector, args.files);
  if (action === 'cdp') {
    const session = await context.newCDPSession(currentPage);
    return session.send(args.method, args.params);
  }
  throw new Error(`Unsupported browser action ${action}`);
}

async function evaluate(code) {
  return command('evaluate', { code });
}

function pass(name, detail) {
  results.push({ name, status: 'pass', detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}

async function open(url) {
  const origin = new URL(url).origin;
  if (pages.has(origin)) {
    currentPage = pages.get(origin);
    return;
  }
  currentPage = pages.size === 0 ? currentPage : await context.newPage();
  watchPage(currentPage);
  pages.set(origin, currentPage);
  await command('navigate', { url });
}

async function waitFor(code, timeout = 20000) {
  try {
    return await currentPage.waitForFunction(code, undefined, { timeout });
  } catch (cause) {
    let context = '';
    try {
      context = JSON.stringify(await evaluate(`({text:document.body.innerText.slice(-1500),error:document.querySelector('#v2-form-error')?.textContent,connection:document.querySelector('#connection-error')?.textContent})`));
    } catch (diagnostic) {
      context = `Diagnostic evaluation failed: ${diagnostic.message}`;
    }
    throw new Error(`Timed out: ${code}; cause: ${cause?.message}; ${context}`, { cause });
  }
}

async function fill(selector, value) {
  await command('fill', { selector, value: String(value) });
}

async function click(selector) {
  await command('click', { selector });
}

async function select(selector, value) {
  await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); element.value=${JSON.stringify(String(value))}; element.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}

async function viewport(width, height = 1000) {
  await currentPage.setViewportSize({ width, height });
}

async function screenshot(name) {
  await command('screenshot', { format: 'png', path: path.join(artifacts, `${name}.png`) });
}

async function readPositionForm() {
  return evaluate(`(() => { const state=window.IMF_V2_APP.state; return {error:document.querySelector('#v2-form-error').textContent,errorHidden:document.querySelector('#v2-form-error').hidden,net:document.querySelector('#v2-net').textContent,gross:document.querySelector('#v2-gross-out').textContent,eligible:state.currentRead?.eligible,checks:state.currentRead?.checks.map(x=>({code:x.code,status:x.status})),plan:state.lastPlan}; })()`);
}

async function waitForRead() {
  await waitFor(`window.IMF_V2_APP?.state?.currentRead !== null || !document.querySelector('#v2-form-error').hidden`);
  const result = await readPositionForm();
  assert.equal(result.errorHidden, true, result.error);
  assert(result.plan, result.error);
  assert.equal(result.plan.executionEnabled, false);
  assert.equal(result.plan.simulationStatus, 'not-run');
  assert.equal(result.plan.signatureStatus, 'not-requested');
  return result;
}

async function setScenario(scenario) {
  await open(`${origins.app}#connection`);
  await click('[data-view="connection"]');
  await waitFor(`document.querySelector('#fixture-scenario') !== null`);
  await select('#fixture-scenario', scenario);
  await waitFor(`window.IMF_V2_APP.state.verifying.size === 0 && window.IMF_V2.fixtureControls.scenario === ${JSON.stringify(scenario)}`);
}

async function checkDashboard(mode) {
  const panels = ['overview', 'collateral', 'positions', 'markets', 'risk', 'activity', 'parameters'];
  await command('navigate', { url: `${origins.app}#dashboard` });
  await waitFor(`window.IMF_V2_APP?.state?.runtime !== null && document.querySelector('#dashboard-view').hidden === false`);
  assert.equal(await evaluate(`document.querySelector('#view-title').textContent`), 'Protocol at a glance.');
  assert((await evaluate(`document.querySelector('#dashboard-source-status').textContent`)).includes(mode));
  assert.equal(await evaluate(`document.querySelector('#dashboard-currency').options.length`), 11);
  await click('#dashboard-method-open');
  await waitFor(`document.querySelector('#dashboard-method-dialog').open === true`);
  assert((await evaluate(`document.querySelector('#dashboard-method-dialog').textContent`)).includes('Collateral ratio and liquidation'));
  await click('#dashboard-method-close');
  await waitFor(`document.querySelector('#dashboard-method-dialog').open === false`);
  await click('#dashboard-copy-view');
  await waitFor(`document.querySelector('#feedback').textContent.includes('view link copied')`);
  assert.equal(await evaluate(`document.querySelectorAll('.sidebar .dashboard-nav').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.dashboard-nav[role="tablist"] [role="tab"]').length`), panels.length);
  assert.equal(await evaluate(`document.querySelectorAll('.dashboard-panel[role="tabpanel"]').length`), panels.length);
  await click('#dashboard-tab-overview');
  await key('ArrowRight');
  await waitFor(`document.querySelector('#dashboard-collateral').hidden === false && document.activeElement.id === 'dashboard-tab-collateral'`);
  assert.equal(await evaluate(`document.querySelector('#dashboard-tab-collateral').getAttribute('aria-selected')`), 'true');
  await key('End');
  await waitFor(`document.querySelector('#dashboard-parameters').hidden === false && document.activeElement.id === 'dashboard-tab-parameters'`);
  await key('Home');
  await waitFor(`document.querySelector('#dashboard-overview').hidden === false && document.activeElement.id === 'dashboard-tab-overview'`);
  assert.equal(await evaluate(`document.querySelectorAll('.dashboard-nav [aria-selected="true"]').length`), 1);
  const pageTitles = { overview: 'Protocol at a glance.', collateral: 'Collateral, without the fog.', positions: 'Every position. One risk lens.', markets: 'Marks, volume and liquidity.', risk: 'Stress the book.', activity: 'The public ledger, in motion.', parameters: 'The system, parameter by parameter.' };
  for (const panel of panels) {
    await evaluate(`location.hash = 'dashboard/${panel}'`);
    await waitFor(`document.querySelector('#dashboard-${panel}').hidden === false && document.querySelector('#dashboard-${panel}').innerText.length > 40`);
    assert((await evaluate(`location.hash`)).endsWith(panel));
    assert.equal(await evaluate(`document.querySelector('#view-title').textContent`), pageTitles[panel]);
  }
  if (mode !== 'UNCONFIGURED') {
    await evaluate(`location.hash = 'dashboard/positions'`);
    await waitFor(`document.querySelector('#dashboard-position-search') !== null`);
    await fill('#dashboard-position-search', 'browser-qa');
    await waitFor(`document.querySelector('#dashboard-positions .unavailable-card') !== null || document.querySelectorAll('#dashboard-positions tbody tr').length >= 0`);
    await click('[data-position-health="attention"]');
    assert.equal(await evaluate(`document.querySelector('[data-position-health="attention"]').getAttribute('aria-pressed')`), 'true');
    await evaluate(`(() => { const select=document.querySelector('#dashboard-position-cr'); select.value='150'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    assert.equal(await evaluate(`document.querySelector('#dashboard-position-cr').value`), '150');
    await click('#dashboard-reset');
    await waitFor(`document.querySelector('#dashboard-position-search').value === '' && document.querySelector('#dashboard-position-cr').value === '10000'`);
    await click('#dashboard-positions-export');
    const positionCsv = await download('dashboard-positions');
    assert(positionCsv.json === undefined, 'CSV helper must not treat CSV as JSON');
    await evaluate(`location.hash = 'dashboard/risk'`);
    await waitFor(`document.querySelector('#dashboard-risk-collateral') !== null`);
    await fill('#dashboard-risk-collateral', '-35');
    await waitFor(`document.querySelector('#dashboard-risk-collateral-out').textContent === '-35%'`);
    await click('#dashboard-scenario-export');
    const scenario = await download('dashboard-scenario');
    assert.equal(scenario.json.kind, 'scenario');
    assert.equal(scenario.json.executionEnabled, false);
    assert.equal(scenario.json.assumptions.collateralShockPercent, -35);
    if (fixture) {
      await setScenario('challenged');
      await command('navigate', { url: `${origins.app}#dashboard/activity` });
      await waitFor(`document.querySelector('#dashboard-activity').hidden === false && document.querySelector('#dashboard-load-challenge') !== null`);
      await click('#dashboard-load-challenge');
      await waitFor(`document.querySelector('#dashboard-challenge-panel').innerText.includes('First-phase deadline')`);
      const replay = await evaluate(`(() => { const input=document.querySelector('#dashboard-replay-scrub'); input.value=75; input.dispatchEvent(new Event('input',{bubbles:true})); return document.querySelector('#dashboard-replay-scrub-out').textContent; })()`);
      assert.equal(replay, '75%');
      await waitFor(`document.querySelector('#dashboard-challenge-panel').innerText.includes('Replay timestamp')`);
      await setScenario('valid');
    }
    await command('navigate', { url: `${origins.app}#dashboard/activity` });
    await click('[data-view="dashboard"]');
    await waitFor(`document.querySelector('#dashboard-activity').hidden === false && document.querySelector('[data-event-type="challenge-started"]')?.offsetParent !== null`);
    await click('[data-event-type="challenge-started"]');
    assert.equal(await evaluate(`document.querySelector('[data-event-type="challenge-started"]').getAttribute('aria-pressed')`), 'true');
    await click('#dashboard-activity-sort');
    assert((await evaluate(`document.querySelector('#dashboard-activity-sort').textContent`)).includes('Oldest first'));
    await evaluate(`location.hash = 'dashboard/parameters'`);
    await waitFor(`document.querySelector('[data-parameter-tab="sources"]') !== null`);
    await click('[data-parameter-tab="sources"]');
    await waitFor(`document.querySelector('#dashboard-parameters').innerText.includes('Analytics still required')`);
    await evaluate(`location.hash = 'dashboard/overview'`);
    await waitFor(`document.querySelector('.dash-donut-layout') !== null || document.querySelector('#dashboard-overview .dash-chart-unavailable') !== null`);
    await click('#dashboard-export-view');
    const overviewExport = await download('dashboard-overview');
    assert.equal(overviewExport.json.schema, 'imf.dashboard-view.v1');
    assert.equal(overviewExport.json.executionEnabled, false);
    assert.equal(overviewExport.json.panel, 'overview');
  }
  for (const width of [320, 390, 700, 1024, 1440]) {
    await viewport(width);
    await evaluate(`location.hash = 'dashboard/parameters'`);
    await waitFor(`document.querySelector('#dashboard-parameters').hidden === false`);
    await waitFor(`(() => { const nav=document.querySelector('.dashboard-nav'); const tab=document.querySelector('#dashboard-tab-parameters'); const navRect=nav.getBoundingClientRect(); const tabRect=tab.getBoundingClientRect(); return tab.getAttribute('aria-selected') === 'true' && tabRect.left >= navRect.left - 1 && tabRect.right <= navRect.right + 1; })()`);
    const tabState = await evaluate(`(() => { const nav=document.querySelector('.dashboard-nav'); const tab=document.querySelector('#dashboard-tab-parameters'); const navRect=nav.getBoundingClientRect(); const tabRect=tab.getBoundingClientRect(); return { display:getComputedStyle(nav).display, selected:tab.getAttribute('aria-selected'), visible:tabRect.left >= navRect.left - 1 && tabRect.right <= navRect.right + 1, overflow:document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
    assert.equal(tabState.display, 'flex', `dashboard tabs must remain one row at ${width}`);
    assert.equal(tabState.selected, 'true');
    assert.equal(tabState.visible, true, `active dashboard tab must be visible at ${width}`);
    assert.equal(tabState.overflow, false, `dashboard overflow at ${width}`);
    await evaluate(`location.hash = 'dashboard/overview'`);
    await waitFor(`document.querySelector('#dashboard-overview').hidden === false`);
    if (mode !== 'UNCONFIGURED') {
      await waitFor(`document.querySelector('.dash-system-map') !== null`);
      assert.equal(await evaluate(`document.querySelectorAll('.dash-system-node').length`), 3);
    }
    if (width === 390 || width === 1440) {
      await evaluate(`scrollTo(0,0)`);
      await screenshot(`dashboard-${width === 390 ? 'mobile' : 'desktop'}-${mode.toLowerCase().replaceAll(' ', '-')}`);
    }
  }
  for (const panel of ['positions', 'risk', 'activity']) {
    await evaluate(`location.hash = 'dashboard/${panel}'`);
    await waitFor(`document.querySelector('#dashboard-${panel}').hidden === false`);
    await viewport(1440);
    await evaluate(`scrollTo(0,0)`);
    await screenshot(`dashboard-${panel}-desktop-${mode.toLowerCase().replaceAll(' ', '-')}`);
    await viewport(390);
    await evaluate(`scrollTo(0,0)`);
    await screenshot(`dashboard-${panel}-mobile-${mode.toLowerCase().replaceAll(' ', '-')}`);
  }
  await viewport(1440);
  await click('[data-view="create"]');
  await waitFor(`document.querySelector('#create-view').hidden === false`);
  pass(`dashboard panels, deep links, unavailable states, exports and responsive layout (${mode.toLowerCase()})`);
}

async function download(namePart) {
  const download = await pendingDownload;
  if (!download) throw new Error(`No Chrome download matched ${namePart}`);
  const suggested = download.suggestedFilename();
  assert(suggested.includes(namePart), `Unexpected download ${suggested}`);
  const file = `${Date.now()}-${suggested}`;
  await download.saveAs(path.join(downloads, file));
  const content = fs.readFileSync(path.join(downloads, file), 'utf8');
  assert(content.length > 10);
  const trimmed = content.trim();
  const json = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(content) : undefined;
  return { file, content, json };
}

async function key(key) {
  await currentPage.keyboard.press(key);
}

await viewport(1440);

try {

if (fixture) {
  await open(origins.app);
  await waitFor(`window.IMF_V2_APP?.state?.verified?.get('USD') === true`);
  const initial = await evaluate(`({network:window.IMF_V2_APP.state.registry.network,notice:document.querySelector('#release-notice').textContent,originalDrafts:localStorage.getItem('imf-position-drafts-v2')})`);
  assert.equal(initial.network, 'fixture-v2');
  assert(initial.notice.includes('SYNTHETIC V2 FIXTURE'));
  globalThis.originalDrafts = initial.originalDrafts;
  pass('fixture identity and synthetic warning');
  assert.deepEqual(await evaluate(`[...document.querySelector('#ecosystem-currency').options].filter(option=>!option.disabled).map(option=>option.value)`), ['USD']);
  assert.equal(await evaluate(`document.querySelector('#ecosystem-currency').options.length`), 11);
  assert((await evaluate(`document.querySelector('#ecosystem-availability').textContent`)).includes('synthetic read model'));
  assert.equal(await evaluate(`document.querySelector('#ecosystem-load-form button[type="submit"]').disabled`), false);
  pass('only the verified fixture currency is enabled for ecosystem reads');
  await checkDashboard('SYNTHETIC FIXTURE');

  await fill('[name="project"]', 'Browser QA token project');
  await fill('[name="account"]', '0xF17e00000000000000000000000000000000000B');
  await fill('[name="token"]', '0xf17e00000000000000000000000000000000000c');
  await click('#review-v2-plan');
  const proposal = await waitForRead();
  assert.equal(Number(await evaluate(`document.querySelector('[name="collateralDecimals"]').value`)), 6);
  assert(proposal.net.includes('37030'));
  assert(proposal.net.includes('sK9USD'));
  assert.equal(proposal.eligible, true);
  assert(proposal.checks.filter((entry) => entry.code !== 'SYNTHETIC_FIXTURE').every((entry) => entry.status === 'pass'));
  assert.equal(proposal.plan.action, 'new');
  assert.equal(proposal.plan.inputs.token.decimals, '6');
  assert.equal(proposal.plan.inputs.liquidationPrice.decimals, '30');
  pass('new proposal: six-decimal metadata, funding and exact pre-opening quote', proposal.net);

  await click('#save-v2-plan');
  await click('[data-view="drafts"]');
  await waitFor(`document.querySelectorAll('.saved-row').length >= 1`);
  assert((await evaluate(`document.querySelector('#draft-list').innerText`)).includes('Browser QA token project'));
  await click('[data-view="create"]');
  await click('#export-v2-plan');
  const planDownload = await download('new-read-plan');
  assert.equal(planDownload.json.schema, 'imf.v2-read-plan.v1');
  assert.equal(planDownload.json.executionEnabled, false);
  assert.equal(planDownload.json.evidence.registry.status, 'fixture');
  pass('V2 local draft and actual JSON download', planDownload.file);

  await click('#agent-mode');
  const agent = await evaluate(`JSON.parse(document.querySelector('#agent-json').textContent)`);
  assert.equal(agent.schema, 'imf.v2-read-plan.v1');
  assert.equal(agent.action, 'new');
  assert.equal(agent.project, 'Browser QA token project');
  assert.equal(agent.executionEnabled, false);
  await click('#human-mode');
  pass('human and agent representations share V2 inputs');

  await click('[name="action"][value="clone"]');
  await fill('[name="parent"]', '0xF17e00000000000000000000000000000000000A');
  const expiration = await evaluate(`(async () => { const p=await window.IMF_V2_APP.state.clients.get('USD').positionState(window.IMF_V2.fixturePosition); return new Date(Number(p.expiration-86400n)*1000).toISOString().slice(0,16); })()`);
  await fill('[name="cloneExpiration"]', expiration);
  await click('#read-parent');
  const clone = await waitForRead();
  assert.equal(clone.eligible, true);
  assert.equal(clone.plan.action, 'clone');
  assert.equal(clone.plan.inputs.initialCollateral.decimals, '6');
  assert(clone.checks.every((entry) => entry.code === 'SYNTHETIC_FIXTURE' || entry.status === 'pass'));
  pass('clone accepted terms: parent capacity, owner and absolute child expiry');

  await click('[name="action"][value="mint"]');
  await fill('[name="position"]', '0xF17e00000000000000000000000000000000000A');
  await click('#read-position');
  const mint = await waitForRead();
  assert.equal(mint.eligible, true);
  assert.equal(mint.plan.action, 'mint');
  assert(mint.checks.every((entry) => entry.code === 'SYNTHETIC_FIXTURE' || entry.status === 'pass'));
  pass('existing mint: caller, cooldown, expiry, capacity and backing checks');

  await click('[data-view="manage"]');
  await fill('[name="managePosition"]', '0xF17e00000000000000000000000000000000000A');
  await fill('[name="manageAccount"]', '0xF17e00000000000000000000000000000000000B');
  await click('#manage-load-form button[type="submit"]');
  await waitFor(`window.IMF_V2_APP.state.manage?.snapshot?.address === window.IMF_V2.fixturePosition`);
  assert((await evaluate(`document.querySelector('#manage-state').innerText`)).includes('100000.0'));
  await fill('[name="manageAccount"]', '');
  await click('#manage-load-form button[type="submit"]');
  await waitFor(`window.IMF_V2_APP.state.manage?.snapshot?.caller === null`);
  assert.equal(await evaluate(`window.IMF_V2_APP.state.manage.snapshot.eligible`), null);
  await click('#withdrawal-form button[type="submit"]');
  await waitFor(`document.querySelector('#withdrawal-result').innerText.includes('Unknown')`);
  await fill('[name="manageAccount"]', '0xF17e00000000000000000000000000000000000B');
  await click('#manage-load-form button[type="submit"]');
  await waitFor(`window.IMF_V2_APP.state.manage?.snapshot?.caller === window.IMF_V2.fixtureAccount`);
  pass('missing caller leaves owner-specific eligibility unknown');
  await click('#repayment-form button[type="submit"]');
  await waitFor(`document.querySelector('#repayment-result').innerText.includes('Gross debt reduction')`);
  assert((await evaluate(`document.querySelector('#repayment-result').innerText`)).includes('1250.0'));
  await click('#full-repayment');
  await waitFor(`document.querySelector('#repayment-result').innerText.includes('Candidate covers all gross debt')`);
  await click('#withdrawal-form button[type="submit"]');
  await waitFor(`document.querySelector('#withdrawal-result').innerText.includes('Read-derived withdrawal eligibility')`);
  assert((await evaluate(`document.querySelector('#withdrawal-result').innerText`)).includes('Yes'));
  await click('#read-challenge');
  await waitFor(`document.querySelector('#challenge-result').innerText.length > 0`);
  pass('management: repayment reserve, full candidate, withdrawal and expiry');

  await click('[data-view="ecosystem"]');
  await fill('[name="ecosystemAccount"]', '0xF17e00000000000000000000000000000000000B');
  await click('#ecosystem-load-form button[type="submit"]');
  await waitFor(`window.IMF_V2_APP.state.ecosystem.bridge?.sourceDecimals === 6 && !!window.IMF_V2_APP.state.ecosystem.savings && !!window.IMF_V2_APP.state.ecosystem.equity`);
  await fill('[name="burnAmount"]', '100.000000000000000001');
  await click('#bridge-form button[type="submit"]');
  await waitFor(`document.querySelector('#bridge-quote').innerText.includes('Unburned local remainder')`);
  const bridge = await evaluate(`document.querySelector('#bridge-quote').innerText`);
  assert(bridge.includes('0.000000000000000001'));
  assert(bridge.includes('Unpaid credit'));
  await click('#equity-form button[type="submit"]');
  await waitFor(`document.querySelector('#equity-quote').innerText.includes('Quoted pool shares')`);
  await click('#governance-form button[type="submit"]');
  await waitFor(`document.querySelector('#governance-state').innerText.includes('Contract checkQualified')`);
  const governance = await evaluate(`document.querySelector('#governance-state').innerText`);
  assert(governance.includes('10.0%'));
  assert(governance.includes('Yes'));
  pass('bridge credits, savings, equity and vote qualification');

  await setScenario('no-votes');
  await click('[data-view="ecosystem"]');
  await click('#governance-form button[type="submit"]');
  await waitFor(`document.querySelector('#governance-state').innerText.includes('Contract checkQualified')`);
  const noVotes = await evaluate(`document.querySelector('#governance-state').innerText`);
  assert(noVotes.includes('0'));
  assert(noVotes.includes('No votes / undefined ratio'));
  assert(noVotes.includes('No'));
  pass('zero total votes: no qualification and no divide-by-zero display');

  for (const [scenario, code] of [['cooldown', 'COOLDOWN'], ['expired', 'EXPIRATION'], ['challenged', 'NO_CHALLENGE']]) {
    await setScenario(scenario);
    await click('[data-view="create"]');
    await click('[name="action"][value="mint"]');
    await click('#read-position');
    const result = await waitForRead();
    assert.equal(result.eligible, false);
    assert(result.checks.some((entry) => entry.code === code && entry.status === 'fail'));
  }
  pass('exact cooldown, expiry and challenge failures');

  await setScenario('zero-balance');
  await click('[data-view="create"]');
  await click('[name="action"][value="new"]');
  await click('#review-v2-plan');
  const underfunded = await waitForRead();
  assert.equal(underfunded.eligible, false);
  assert(underfunded.checks.some((entry) => entry.code === 'OPENING_FEE_FUNDED' && entry.status === 'fail'));
  pass('proposal funding failure remains visible');

  for (const scenario of ['wrong-chain', 'missing-code', 'rpc-error']) {
    await setScenario(scenario);
    const error = await evaluate(`document.querySelector('#connection-error').textContent`);
    assert(error.length > 0, scenario);
    assert.equal(await evaluate(`window.IMF_V2_APP.state.provider`), null);
  }
  pass('wrong-chain, missing-code and RPC failures are not zero state');

  await setScenario('valid');
  await click('[data-view="create"]');
  await click('[name="action"][value="mint"]');
  await click('#read-position');
  assert.equal((await waitForRead()).eligible, true);
  await screenshot('app-fixture-desktop');
  await click('[data-view="connection"]');
  await click('#disconnect-registry');
  assert.equal(await evaluate(`window.IMF_V2_APP.state.registry`), null);
  assert.equal(await evaluate(`window.IMF_V2_APP.state.currentRead`), null);
  assert.equal(await evaluate(`document.querySelector('#ecosystem-currency').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('#ecosystem-load-form button[type="submit"]').disabled`), true);
  await click('#connect-registry');
  await waitFor(`window.IMF_V2_APP.state.verified.get('USD') === true`);
  assert.deepEqual(await evaluate(`[...document.querySelector('#ecosystem-currency').options].filter(option=>!option.disabled).map(option=>option.value)`), ['USD']);
  pass('disconnect clears evidence and reconnects without V1 substitution');
}


await open(origins.app);
await waitFor(`window.IMF_V2_APP?.state?.runtime !== null`);
if (!fixture) {
  assert.equal(await evaluate(`window.IMF_V2_APP.state.registry`), null);
  assert((await evaluate(`document.querySelector('#v2-net').textContent`)).includes('Connect verified V2 state'));
  assert((await evaluate(`document.querySelector('#release-notice').textContent`)).includes('No verified deployment registry'));
  assert.equal(await evaluate(`document.querySelector('#ecosystem-currency').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('#ecosystem-load-form button[type="submit"]').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('#v2-currency').options.length`), 11);
  assert.equal(await evaluate(`document.querySelector('#v2-currency option[value="EUR"]').disabled`), false);
  assert((await evaluate(`document.querySelector('#v2-currency option[value="EUR"]').textContent`)).includes('read unavailable'));
  globalThis.originalDrafts = await evaluate(`localStorage.getItem('imf-position-drafts-v2')`);
  pass('default preview remains unconfigured with no V1 substitution');
  await checkDashboard('UNCONFIGURED');

  await click('#review-v2-plan');
  assert.equal(await evaluate(`document.querySelector('#v2-position-form').checkValidity()`), false);
  pass('native required-field validation runs in Chrome');
}

await click('[data-view="create"]');
await click('[name="action"][value="new"]');
await fill('[name="project"]', 'Browser QA project');
await fill('[name="token"]', '0x1234');
assert.equal(await evaluate(`document.querySelector('#v2-position-form').checkValidity()`), false);
await fill('[name="token"]', '0xf17e00000000000000000000000000000000000c');
await fill('[name="gross"]', '1e5');
await click('#export-v2-plan');
assert((await evaluate(`document.querySelector('#v2-form-error').textContent`)).includes('decimal'));
await fill('[name="gross"]', '50000');
pass('address and scientific-notation validation');

if (!fixture) {
  await click('[data-view="create"]');
  await fill('[name="project"]', 'Browser QA token project');
  await click('#save-v2-plan');
  await waitFor(`document.querySelector('#feedback').textContent.includes('V2 read plan saved')`);
  assert.equal(await evaluate(`window.IMF_V2_APP.state.lastPlan.status`), 'local-read-plan');
  assert.equal(await evaluate(`window.IMF_V2_APP.state.lastPlan.chainId`), null);
  assert.equal(await evaluate(`window.IMF_V2_APP.state.lastPlan.evidence.registry.status`), 'unconfigured');
  pass('unconfigured V2 draft saves without inventing live evidence');
}

await click('[data-view="offline"]');
await fill('#position-form [name="project"]', 'Browser QA teaching');
await fill('#position-form [name="token"]', '0x1111111111111111111111111111111111111111');
await click('#position-form button[type="submit"]');
await waitFor(`document.querySelector('#review-view').hidden === false`);
assert((await evaluate(`document.querySelector('#review-summary').innerText`)).includes('39500'));
await click('#acknowledge');
assert.equal(await evaluate(`document.querySelector('#save-plan').disabled`), false);
await click('#save-plan');
await click('#export-plan');
const teachingDownload = await download('position-plan');
assert.equal(teachingDownload.json.schema, 'imf.position-plan.v1');
assert.equal(teachingDownload.json.executionEnabled, false);
assert.equal(teachingDownload.json.illustrativeResult.net, 39500);
pass('teaching review, acknowledgment and actual legacy JSON download');

await click('#edit-plan');
await click('[data-view="drafts"]');
await evaluate(`(() => { const row=[...document.querySelectorAll('.saved-row')].find(row=>row.innerText.includes('Browser QA teaching')); row.querySelector('button').click(); })()`);
await waitFor(`document.querySelector('#offline-view').hidden === false`);
assert.equal(await evaluate(`document.querySelector('#position-form [name="project"]').value`), 'Browser QA teaching');
await click('[data-view="drafts"]');
await evaluate(`(() => { const row=[...document.querySelectorAll('.saved-row')].find(row=>row.innerText.includes('Browser QA teaching')); row.querySelectorAll('button')[1].click(); })()`);
await waitFor(`![...document.querySelectorAll('.saved-row')].some(row=>row.innerText.includes('Browser QA teaching') && row.querySelector('strong').textContent === 'Browser QA teaching')`);
await click('#export-drafts');
const backup = await download('draft-backup');
assert.equal(backup.json.schema, 'imf.draft-backup.v1');
await command('upload', { selector: '#draft-backup-file', files: [path.join(downloads, backup.file)] });
await waitFor(`document.querySelector('#feedback').textContent.includes('new local drafts imported')`);
pass('draft save, reload, load, delete, backup and file import');

await evaluate(`window.__qaGoodDrafts=localStorage.getItem('imf-position-drafts-v2');localStorage.setItem('imf-position-drafts-v2','{malformed');`);
await click('[data-view="drafts"]');
assert((await evaluate(`document.querySelector('#draft-list').innerText`)).includes('unavailable or invalid'));
await evaluate(`localStorage.setItem('imf-position-drafts-v2',window.__qaGoodDrafts);`);
await currentPage.reload({ waitUntil: 'load' });
await waitFor(`window.IMF_V2_APP?.state?.runtime !== null`);
await click('[data-view="drafts"]');
assert((await evaluate(`document.querySelector('#draft-list').innerText`)).includes('Browser QA token project'));
pass('malformed storage error and valid draft persistence across reload');

await click('[data-view="offline"]');
await fill('#position-form [name="project"]', 'Browser QA teaching');
await fill('#position-form [name="token"]', '0x1111111111111111111111111111111111111111');
await currentPage.addInitScript({ content: `(() => { const fail=()=>{throw new DOMException('Browser storage is disabled','SecurityError')};Storage.prototype.getItem=fail;Storage.prototype.setItem=fail; })();` });
await currentPage.reload({ waitUntil: 'load' });
await waitFor(`window.IMF_V2_APP?.state?.runtime !== null`);
await click('[data-view="drafts"]');
assert((await evaluate(`document.querySelector('#draft-list').innerText`)).includes('Browser storage is disabled'));
await click('[data-view="offline"]');
await fill('#position-form [name="project"]', 'Browser QA teaching');
await fill('#position-form [name="token"]', '0x1111111111111111111111111111111111111111');
await click('#position-form button[type="submit"]');
await waitFor(`document.querySelector('#review-view').hidden === false`);
await click('#acknowledge');
await click('#save-plan');
assert((await evaluate(`document.querySelector('#feedback').textContent`)).includes('Browser storage is disabled'));
await click('#export-plan');
const noStorageDownload = await download('position-plan');
assert.equal(noStorageDownload.json.executionEnabled, false);
await currentPage.close();
currentPage = await context.newPage();
watchPage(currentPage);
pages.set(new URL(origins.app).origin, currentPage);
await currentPage.goto(origins.app);
await waitFor(`window.IMF_V2_APP?.state?.runtime !== null`);
pass('disabled storage does not prevent planning or JSON export');

await open(origins.docs);
const guides = await evaluate(`fetch('/assets/articles.json').then(response=>response.json())`);
await waitFor(`document.querySelectorAll('#doc-links a').length === ${guides.length} && document.querySelector('#doc-search').dataset.ready === 'true'`);
for (const guide of guides) {
  const url = `${origins.docs}guides/${guide.id}/`;
  const response = await command('navigate', { url });
  assert.equal(response.status(), 200);
  await waitFor(`document.querySelector('#article h1')?.textContent === ${JSON.stringify(guide.title)}`);
  assert.equal(await evaluate(`document.querySelector('link[rel="canonical"]').href`), `${publicOrigins.docs}guides/${guide.id}/`);
  assert.equal(await evaluate(`document.querySelector('#doc-links a[aria-current="page"]').dataset.guide`), guide.id);
  assert(await evaluate(`JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].some(node=>node['@type']==='TechArticle' && node.headline===${JSON.stringify(guide.title)})`));
  assert(await evaluate(`document.querySelectorAll('#article figure').length >= 1 && document.querySelector('#article figcaption') !== null`));
  assert.equal(await evaluate(`document.querySelectorAll('#article a[href^="#"]').length`), 0);
  await evaluate(`document.querySelectorAll('#article img').forEach(image=>image.scrollIntoView({block:'center'}))`);
  await waitFor(`[...document.querySelectorAll('#article img')].every(image=>image.complete && image.naturalWidth > 0)`);
  await evaluate(`window.scrollTo({top:0,behavior:'auto'})`);
}
pass(`${guides.length} statically rendered documentation routes, canonical metadata, figures and local assets`);

await command('navigate', { url: `${origins.docs}guides/overview/` });
await waitFor(`document.querySelector('#article h1')?.textContent.includes('multicurrency')`);
const articleLinks = await evaluate(`[...document.querySelectorAll('#article a')].map(link=>link.href)`);
assert(articleLinks.some((href) => href.startsWith(publicOrigins.app)));
await command('navigate', { url: `${origins.docs}guides/source-bridge/` });
await waitFor(`document.querySelector('#article h1')?.textContent.includes('Normalize decimals')`);
assert((await evaluate(`document.querySelector('.lesson-nav a[href$="/guides/source-bridge/"]').href`)).startsWith(publicOrigins.docs));
await waitFor(`document.querySelector('#doc-search').dataset.ready === 'true'`);
await fill('#doc-search', 'nonexistent-query-xyz');
assert.equal(await evaluate(`document.querySelector('#search-status').textContent`), '0 guides found');
await fill('#doc-search', 'bridge');
assert((await evaluate(`document.querySelector('#search-status').textContent`)).includes('guide'));
await fill('#doc-search', '');
assert.equal(await evaluate(`[...document.querySelectorAll('#doc-links a')].filter(link=>!link.hidden).length`), guides.length);
await evaluate(`location.hash='repayment'`);
await waitFor(`location.pathname.endsWith('/guides/repayment/')`);
await waitFor(`document.querySelector('#article h1')?.textContent.includes('Repay debt first')`);
await evaluate(`location.hash='not-a-guide'`);
await waitFor(`document.querySelector('#article').innerText.includes('Guide not found')`);
pass('clean documentation links, search, empty results and legacy hash redirects');

await currentPage.route('**/assets/articles.json', (route) => route.abort('failed'));
await currentPage.reload({ waitUntil: 'load' });
await waitFor(`document.querySelector('#search-status').textContent.includes('Search is unavailable')`);
assert.equal(await evaluate(`document.querySelector('#doc-search').disabled`), true);
assert.equal(await evaluate(`document.querySelectorAll('#doc-links a').length`), guides.length);
assert((await evaluate(`document.querySelector('#article').innerText`)).includes('Repay debt first'));
await currentPage.unroute('**/assets/articles.json');
await currentPage.reload({ waitUntil: 'load' });
await waitFor(`document.querySelector('#doc-search').dataset.ready === 'true'`);
pass('failed search index request preserves the full static guide and navigation');

for (const [surface, origin] of Object.entries(origins)) {
  const robots = await fetch(new URL('robots.txt', origin)).then((response) => response.text());
  const sitemap = await fetch(new URL('sitemap.xml', origin)).then((response) => response.text());
  const llms = await fetch(new URL('llms.txt', origin)).then((response) => response.text());
  assert(robots.includes('User-agent: *\nAllow: /'));
  assert(sitemap.includes('<urlset') && sitemap.includes(`<loc>${publicOrigins[surface]}</loc>`));
  assert(llms.includes('International Multicurrency Framework'));
  assert(llms.includes('not transaction authorization'));
}
pass('robots, sitemaps and the experimental llms.txt index are publicly readable');

const interactivePage = currentPage;
currentPage = await context.newPage();
watchPage(currentPage);
await command('cdp', { method: 'Emulation.setScriptExecutionDisabled', params: { value: true } });
await viewport(390);
await command('navigate', { url: `${origins.docs}guides/governance/` });
assert((await evaluate(`document.querySelector('#article').innerText`)).includes('strictly more than 2%'));
assert.equal(await evaluate(`document.querySelectorAll('#doc-links a').length`), guides.length);
assert(await evaluate(`getComputedStyle(document.querySelector('.sidebar-content')).display !== 'none'`));
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sidebar-toggle')).display`), 'none');
assert.equal(await evaluate(`getComputedStyle(document.querySelector('#doc-search')).display`), 'none');
await command('navigate', { url: `${origins.docs}guides/currencies/` });
assert.equal(await evaluate(`document.querySelectorAll('#article table').length`), 1);
await screenshot('docs-nojs-mobile');
await command('navigate', { url: origins.website });
assert((await evaluate(`document.querySelector('.lead').textContent`)).includes('International Multicurrency Framework'));
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.menu')).display`), 'none');
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.navlinks')).display`), 'flex');
await screenshot('website-nojs-mobile');
await command('navigate', { url: origins.app });
assert((await evaluate(`document.querySelector('#view-title').textContent`)).includes('V2 position planner'));
assert((await evaluate(`document.querySelector('.sidebar-content').innerText`)).includes('Interactive V2 forms require JavaScript'));
await currentPage.close();
currentPage = interactivePage;
pass('mobile website, documentation and app retain static content and navigation without JavaScript');

await open(origins.website);
await waitFor(`document.querySelectorAll('.currency-orb').length === 11`);
await click('[data-story="2"]');
assert.equal(await evaluate(`document.querySelector('#story-title').textContent`), 'Two assets meet in a separate pool.');
assert.equal(await evaluate(`document.querySelector('[data-story="2"]').getAttribute('aria-pressed')`), 'true');
await evaluate(`(() => { const slider=document.querySelector('#learn-debt'); slider.value='65'; slider.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await select('#learn-currency', 'JPY');
assert.equal(await evaluate(`document.querySelector('#learn-net').textContent`), '51,350 K9JPY');
assert((await evaluate(`document.querySelector('#learn-plan').href`)).startsWith(`${publicOrigins.app}?currency=JPY&gross=65000`));
for (const { code, symbol } of await evaluate(`window.IMF_CURRENCIES`)) {
  await click(`[data-system="${code}"]`);
  assert.equal(await evaluate(`document.querySelector('#system-coin').textContent`), symbol);
  assert.equal(await evaluate(`document.querySelector('[data-system="${code}"]').getAttribute('aria-pressed')`), 'true');
}
pass('website story, teaching handoff and all eleven currency explorers');

await evaluate(`document.querySelector('.deep-paths details:last-child summary').focus()`);
const detailBefore = await evaluate(`document.querySelector('.deep-paths details:last-child').open`);
await key('Enter');
assert.notEqual(await evaluate(`document.querySelector('.deep-paths details:last-child').open`), detailBefore);
await viewport(390);
await click('.menu');
assert.equal(await evaluate(`document.querySelector('.menu').getAttribute('aria-expanded')`), 'true');
await key('Escape');
assert.equal(await evaluate(`document.querySelector('.menu').getAttribute('aria-expanded')`), 'false');
assert(await evaluate(`document.activeElement.classList.contains('menu')`));
await evaluate(`document.querySelector('.skip').focus()`);
await key('Enter');
assert.equal(await evaluate(`document.activeElement.id`), 'main');
await key('Tab');
assert(await evaluate(`['A','BUTTON','INPUT','SELECT','SUMMARY'].includes(document.activeElement.tagName)`));
assert.notEqual(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'none');
pass('keyboard details, mobile menu, Escape, skip link and visible focus');

await open(origins.app);
await viewport(390);
await evaluate(`window.scrollTo({top:0,behavior:'auto'})`);
assert.equal(await evaluate(`document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')`), 'false');
await click('.sidebar-toggle');
assert.equal(await evaluate(`document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')`), 'true');
assert.equal(await evaluate(`document.querySelector('.sidebar-content').hidden`), false);
await key('Escape');
assert.equal(await evaluate(`document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')`), 'false');
assert.equal(await evaluate(`document.querySelector('.sidebar-content').hidden`), true);
assert(await evaluate(`document.activeElement.classList.contains('sidebar-toggle')`));
await click('.sidebar-toggle');
await click('[data-view="connection"]');
assert.equal(await evaluate(`document.querySelector('.sidebar-content').hidden`), true);
assert.equal(await evaluate(`document.querySelector('#connection-view').hidden`), false);
await open(origins.docs);
await viewport(390);
await command('navigate', { url: `${origins.docs}guides/savings/` });
await waitFor(`document.querySelector('#doc-search').dataset.ready === 'true' && document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === 'false'`);
await click('.sidebar-toggle');
await waitFor(`document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === 'true'`);
await fill('#doc-search', 'savings');
assert((await evaluate(`document.querySelectorAll('#doc-links a:not([hidden])').length`)) < guides.length);
await key('Escape');
assert.equal(await evaluate(`document.querySelector('.sidebar-content').hidden`), true);
pass('mobile sidebar disclosure, Escape focus restoration, view selection and documentation search');

async function checkLayout(label, width) {
  await viewport(width);
  await evaluate(`new Promise(resolve=>setTimeout(resolve,80))`);
  const layout = await evaluate(`({viewport:innerWidth,root:document.documentElement.scrollWidth,body:document.body.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(element=>{const rect=element.getBoundingClientRect();return rect.width>0&&rect.right>innerWidth+1}).slice(0,6).map(element=>({tag:element.tagName,id:element.id,class:element.className,right:element.getBoundingClientRect().right}))})`);
  assert(layout.root <= layout.viewport + 1 && layout.body <= layout.viewport + 1, `${label} horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
  const sidebarDisplay = await evaluate(`document.querySelector('.sidebar-toggle') ? getComputedStyle(document.querySelector('.sidebar-toggle')).display : null`);
  if (sidebarDisplay) assert.equal(sidebarDisplay, width > 700 ? 'none' : 'flex', `${label}: incorrect sidebar disclosure at ${width}`);
}

await open(origins.website);
for (const width of [320, 360, 390, 700, 768, 1024, 1280, 1440]) await checkLayout('website', width);
await evaluate(`window.scrollTo({top:0,behavior:'auto'})`);
await viewport(390);
await screenshot('website-mobile');
await viewport(1440);
await screenshot('website-desktop');

await open(origins.docs);
for (const guide of guides) {
  await command('navigate', { url: `${origins.docs}guides/${guide.id}/` });
  for (const width of [320, 390, 768, 1440]) await checkLayout(`docs/${guide.id}`, width);
}
for (const width of [700, 1024, 1280]) await checkLayout('docs/savings', width);
await viewport(390);
await evaluate(`window.scrollTo({top:0,behavior:'auto'})`);
await waitFor(`document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === 'false' && document.querySelector('.sidebar-content').hidden`);
await screenshot('docs-mobile');
await viewport(1440);
await screenshot('docs-guide-desktop');

await open(origins.app);
for (const view of ['create', 'manage', 'arena', 'ecosystem', 'connection', 'offline', 'drafts', 'lifecycle']) {
  await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
  await waitFor(`document.querySelector('#${view}-view').hidden === false`);
  for (const width of [320, 390, 768, 1440]) await checkLayout(`app/${view}`, width);
}
await evaluate(`document.querySelector('[data-view="offline"]').click()`);
await fill('#position-form [name="project"]', 'Responsive review');
await fill('#position-form [name="token"]', '0x1111111111111111111111111111111111111111');
await click('#position-form button[type="submit"]');
await waitFor(`document.querySelector('#review-view').hidden === false`);
for (const width of [320, 390, 768, 1440]) await checkLayout('app/review', width);
await command('navigate', { url: origins.app });
await waitFor(`window.IMF_V2_APP?.state?.runtime !== null`);
await viewport(390);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('#v2-position-form [name="project"]')).fontSize`), '16px');
await evaluate(`window.scrollTo({top:0,behavior:'auto'})`);
await screenshot('app-mobile');
await viewport(1440);
await screenshot('app-desktop');
pass(`320–1440px overflow checks on the website, all ${guides.length} guides and all 10 workspace views, including 16px mobile form inputs`);

await open(origins.app);
await click('[data-view="create"]');
await evaluate(`window.scrollTo({top:0,behavior:'auto'})`);
await viewport(390);
await screenshot('app-mobile');
await viewport(1440);
await screenshot('app-desktop');
await command('cdp', { method: 'Emulation.setPageScaleFactor', params: { pageScaleFactor: 2 } });
await viewport(390);
assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
await command('cdp', { method: 'Emulation.setPageScaleFactor', params: { pageScaleFactor: 1 } });
await command('cdp', { method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] } });
assert(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
assert.equal(await evaluate(`getComputedStyle(document.documentElement).scrollBehavior`), 'auto');
await command('cdp', { method: 'Emulation.setEmulatedMedia', params: { features: [] } });
await viewport(1440);
await screenshot('app-desktop-final');
pass('200% zoom and reduced-motion behavior');

await open(origins.website);
assert.equal(await evaluate(`localStorage.getItem('imf-position-drafts-v2')`), null);
await open(origins.docs);
assert.equal(await evaluate(`localStorage.getItem('imf-position-drafts-v2')`), null);
pass('website and docs origins do not share app draft storage');

await open(origins.app);
await evaluate(`(() => { const value=${JSON.stringify(globalThis.originalDrafts ?? null)}; if(value===null)localStorage.removeItem('imf-position-drafts-v2');else localStorage.setItem('imf-position-drafts-v2',value); })()`);
assert.deepEqual(browserErrors, [], `Browser errors: ${JSON.stringify(browserErrors)}`);
pass('no uncaught browser errors');

fs.writeFileSync(path.join(artifacts, `browser-results${fixture ? '-fixture' : '-default'}.json`), `${JSON.stringify({ fixture, liveDeployment: false, origins, results }, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, fixture, checks: results.length, artifacts }, null, 2));
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
