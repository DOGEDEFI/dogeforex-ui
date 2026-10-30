import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const portBase = Number(process.env.IMF_TESTNET_PREVIEW_PORT || 5260);
const rpcOrigin = 'https://rpc.testnet.dogeos.com';
const indexerEnabled = Boolean(process.env.IMF_INDEXER_URL);
const endpoint = (port, pathname = '/') => `http://127.0.0.1:${port}${pathname}`;
const responsiveChecks = [];
const loadTimings = {};

async function checkLayout(page, label, width) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(80);
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    sidebarDisplay: document.querySelector('.sidebar-toggle') ? getComputedStyle(document.querySelector('.sidebar-toggle')).display : null,
    offenders: [...document.querySelectorAll('body *')].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.right > window.innerWidth + 1;
    }).slice(0, 6).map((element) => ({ tag: element.tagName, id: element.id, class: element.getAttribute('class'), right: element.getBoundingClientRect().right })),
  }));
  assert(layout.root <= layout.viewport + 1 && layout.body <= layout.viewport + 1, `${label} overflow at ${width}: ${JSON.stringify(layout)}`);
  if (layout.sidebarDisplay) assert.equal(layout.sidebarDisplay, width > 700 ? 'none' : 'flex', `${label}: incorrect sidebar disclosure at ${width}`);
  responsiveChecks.push({ label, width });
}

async function reachable(url) {
  try {
    return await new Promise((resolve, reject) => {
      const request = httpGet(url, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error(`Preview health check timed out at ${url}`)));
    });
  } catch {
    return false;
  }
}

if (await reachable(endpoint(portBase + 2))) throw new Error(`Testnet preview port ${portBase + 2} is already occupied`);
const server = spawn('python3', ['scripts/serve.py', '--root', '.production-dist', '--port-base', String(portBase)], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await reachable(endpoint(portBase + 2))) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Testnet preview did not start');

  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  let executablePath;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      executablePath = candidate;
      break;
    } catch {}
  }
  assert(executablePath, 'Chrome executable not found');
  browser = await chromium.launch({ executablePath, headless: true });
  const forbiddenMethods = [];
  const rpcMethods = [];
  const rpcRequests = [];
  const errors = [];
  const isForbiddenMethod = (method) => /^(?:eth_send|eth_sign|personal_(?:sign|send)|wallet_)/i.test(method)
    || /(?:broadcast|submit(?:work|hashrate)|senduseroperation)/i.test(method);
  const monitor = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      try {
        const body = JSON.parse(request.postData() || 'null');
        if (!body) return;
        const entries = Array.isArray(body) ? body : [body];
        const methods = entries.filter((entry) => entry && typeof entry.method === 'string').map((entry) => entry.method);
        if (!methods.length) return;
        const origin = new URL(request.url()).origin;
        for (const method of methods) {
          rpcMethods.push(method);
          rpcRequests.push({ origin, method });
          if (isForbiddenMethod(method)) forbiddenMethods.push(method);
        }
      } catch {}
    });
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  monitor(page);
  const response = await page.goto(endpoint(portBase + 2), { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.querySelector('#sidebar-connection')?.textContent === 'DogeOS testnet · 12 verified currencies', undefined, { timeout: 90000 });
  const noInjectedWallet = await page.evaluate(async () => {
    let connectError = null;
    try { await window.IMF_WALLET.connect(); } catch (error) { connectError = error.code; }
    return {
      providerAbsent: typeof window.ethereum === 'undefined',
      available: window.IMF_WALLET.getState().available,
      account: window.IMF_WALLET.getState().account,
      prepared: window.IMF_WALLET.getState().prepared,
      connectError,
      connectDisabled: document.querySelector('#wallet-connect').disabled,
      transactionPanelHidden: document.querySelector('#transaction-panel').hidden,
      transactionSendDisabled: document.querySelector('#transaction-send').disabled,
    };
  });
  assert.equal(noInjectedWallet.providerAbsent, true, 'The live read test must not inject or require MetaMask');
  assert.equal(noInjectedWallet.available, false);
  assert.equal(noInjectedWallet.account, null);
  assert.equal(noInjectedWallet.prepared, null);
  assert.equal(noInjectedWallet.connectError, 'WALLET_UNAVAILABLE');
  assert.equal(noInjectedWallet.connectDisabled, true);
  assert.equal(noInjectedWallet.transactionPanelHidden, true);
  assert.equal(noInjectedWallet.transactionSendDisabled, true);
  assert.deepEqual(forbiddenMethods, [], 'No injected wallet means no signing or broadcast path may run');
  const expectedCodes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CNY', 'BRL', 'PKR', 'BDT', 'INR', 'NGN', 'CHF'];
  assert.deepEqual(await page.locator('#ecosystem-currency option:not([disabled])').evaluateAll((options) => options.map((option) => option.value)), expectedCodes);
  assert.equal(await page.locator('#ecosystem-currency option').count(), 12);
  assert((await page.locator('#ecosystem-availability').textContent()).includes('12 of 12'));
  await page.locator('.workspace-more > summary').click();
  await page.locator('[data-view="connection"]').click();
  const registryText = await page.locator('#registry-summary').textContent();
  assert(registryText.includes('6281971'));
  for (const code of expectedCodes) assert(registryText.includes(code));
  assert((await page.locator('#runtime-message').textContent()).includes('tUSDC'));
  assert((await page.locator('#runtime-message').textContent()).includes('testnet'));
  await page.locator('[data-view="ecosystem"][data-ecosystem-focus="savings"]').click();
  await page.locator('input[name="ecosystemAccount"]').fill('0x8666f1d19e04c7831EA23066a4b14c0260fC2B50');
  await page.locator('#ecosystem-load-form button[type="submit"]').click();
  await page.waitForFunction(() => ['#bridge-state', '#savings-state', '#equity-state', '#minter-state'].every((selector) => (document.querySelector(selector)?.textContent || '').trim().length > 40), undefined, { timeout: 60000 });
  const bridgeText = await page.locator('#bridge-state').textContent();
  const savingsText = await page.locator('#savings-state').textContent();
  assert(bridgeText.includes('tUSDC'));
  assert(savingsText.includes('5.94%'));
  assert(rpcMethods.includes('eth_getCode'));
  assert(rpcMethods.includes('eth_call'));
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(desktopOverflow, false);
  await mkdir(path.join(root, 'artifacts'), { recursive: true });

  async function checkDashboard(targetPage) {
    const panels = ['overview', 'collateral', 'positions', 'markets', 'risk', 'activity', 'parameters'];
    await targetPage.goto(endpoint(portBase + 2), { waitUntil: 'networkidle' });
    assert.equal(await targetPage.locator('.sidebar .dashboard-nav').count(), 0);
    assert.equal(await targetPage.locator('.dashboard-nav[role="tablist"] [role="tab"]').count(), panels.length);
    assert.equal(await targetPage.locator('.dashboard-panel[role="tabpanel"]').count(), panels.length);
    await targetPage.locator('[data-view="dashboard"]').click();
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-source-status')?.textContent.includes('LIVE USD'), undefined, { timeout: 90000 });
    assert.equal(await targetPage.locator('#dashboard-currency option').count(), 12);
    await targetPage.locator('#dashboard-method-open').click();
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-method-dialog').open === true);
    assert((await targetPage.locator('#dashboard-method-dialog').textContent()).includes('Unavailable analytics'));
    await targetPage.locator('#dashboard-method-close').click();
    const pageTitles = { overview: 'Protocol at a glance.', collateral: 'Collateral, without the fog.', positions: 'Every position. One risk lens.', markets: 'Marks, volume and liquidity.', risk: 'Stress the book.', activity: 'The public ledger, in motion.', parameters: 'The system, parameter by parameter.' };
    for (const panel of panels) {
      await targetPage.goto(endpoint(portBase + 2, `#dashboard/${panel}`), { waitUntil: 'networkidle' });
      try {
        await targetPage.waitForFunction((name) => document.querySelector('#dashboard-view').hidden === false && document.querySelector(`#dashboard-${name}`).hidden === false && document.querySelector(`#dashboard-${name}`).innerText.length > 40, panel, { timeout: 90000 });
      } catch (error) {
        const diagnostic = await targetPage.evaluate((name) => ({
          title: document.querySelector('#view-title')?.textContent,
          source: document.querySelector('#dashboard-source-status')?.textContent,
          dashboardHidden: document.querySelector('#dashboard-view')?.hidden,
          panelHidden: document.querySelector(`#dashboard-${name}`)?.hidden,
          panelText: document.querySelector(`#dashboard-${name}`)?.innerText?.slice(0, 500),
          body: document.body.innerText.slice(0, 500),
          verified: [...(window.IMF_V2_APP?.state?.verified?.entries() ?? [])],
        }), panel);
        throw new Error(`dashboard/${panel} did not settle: ${error.message}; ${JSON.stringify(diagnostic)}`);
      }
      const source = await targetPage.locator('#dashboard-source-status').textContent();
      assert(source.includes('LIVE USD'), `${panel}: ${source}`);
      assert.equal(await targetPage.locator('#view-title').textContent(), pageTitles[panel]);
      if (panel === 'markets') assert((await targetPage.locator('#dashboard-markets').innerText()).includes('Reference marks unavailable'));
      if (panel === 'activity') {
        const activity = await targetPage.locator('#dashboard-activity').innerText();
        assert(activity.includes('Protocol event ledger'));
        if (indexerEnabled) {
          assert(activity.includes('Complete event result'));
          assert(activity.includes('indexed filters'));
          assert(source.includes('INDEXED HISTORY'));
        }
        await targetPage.locator('[data-event-type="challenge-started"]').click();
        assert.equal(await targetPage.locator('[data-event-type="challenge-started"]').getAttribute('aria-pressed'), 'true');
        await targetPage.locator('#dashboard-activity-sort').click();
        assert((await targetPage.locator('#dashboard-activity-sort').textContent()).includes('Oldest first'));
      }
      if (panel === 'parameters') {
        await targetPage.locator('[data-parameter-tab="sources"]').click();
        assert((await targetPage.locator('#dashboard-parameters').innerText()).includes('Analytics still required'));
      }
      if (panel === 'positions') {
        await targetPage.locator('#dashboard-position-account').fill('0x8666f1d19e04c7831EA23066a4b14c0260fC2B50');
        await targetPage.locator('#dashboard-position-scope').selectOption('account');
        await targetPage.waitForFunction(() => document.querySelectorAll('#dashboard-positions tbody tr').length > 0, undefined, { timeout: 120000 });
        await targetPage.locator('#dashboard-positions [data-position-detail]').first().click();
        await targetPage.waitForFunction(() => document.querySelector('#dashboard-drawer').hidden === false && document.querySelector('#dashboard-drawer-body').innerText.includes('Gross minted debt'));
        await targetPage.keyboard.press('Escape');
        await targetPage.waitForFunction(() => document.querySelector('#dashboard-drawer').classList.contains('open') === false);
      }
      if (panel === 'overview') {
        assert.equal(await targetPage.locator('.dash-system-node').count(), 3);
        assert.equal(await targetPage.locator('.dash-utilization').count(), 1);
      }
      for (const width of [320, 390, 700, 1024, 1440]) await checkLayout(targetPage, `dashboard/${panel}`, width);
    }
    const directContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const directPage = await directContext.newPage();
    monitor(directPage);
    for (const hash of ['#dashboard', '#dashboard/markets']) {
      const started = Date.now();
      await directPage.goto('about:blank');
      await directPage.goto(endpoint(portBase + 2, hash), { waitUntil: 'networkidle' });
      if (hash === '#dashboard') {
        await directPage.waitForFunction(() => document.querySelectorAll('.currency-supply-row').length > 0, undefined, { timeout: 90000 });
        loadTimings.firstCurrencyRowMs = Date.now() - started;
        await directPage.waitForFunction(() => document.querySelectorAll('.currency-supply-row').length === 12, undefined, { timeout: 90000 });
        loadTimings.allCurrencyRowsMs = Date.now() - started;
      }
      await directPage.waitForFunction(() => document.querySelector('#dashboard-source-status')?.textContent.includes('LIVE USD'), undefined, { timeout: 90000 });
      assert.equal(await directPage.evaluate(() => window.scrollY), 0, `${hash}: a fresh direct link must open at the top`);
      assert((await directPage.locator('.workspace-command').boundingBox()).y > 0, `${hash}: primary navigation must be visible`);
      assert.equal(await directPage.locator('.workspace-primary').isVisible(), true);
      for (const width of [320, 390]) {
        await directPage.setViewportSize({ width, height: 844 });
        assert.equal(await directPage.evaluate(() => {
          const nav = document.querySelector('.workspace-primary');
          const more = document.querySelector('.workspace-more');
          const items = [...nav.querySelectorAll(':scope > button, :scope > .workspace-more > summary')];
          return nav.scrollWidth <= nav.clientWidth + 1 && more.getBoundingClientRect().right <= nav.getBoundingClientRect().right + 1 && items.every((item) => item.scrollWidth <= item.clientWidth + 1);
        }), true, `${hash}: all primary actions must fit at ${width}px`);
        if (hash === '#dashboard') assert.equal(await directPage.locator('.wallet-bar').isVisible(), false, 'mobile read-only dashboard must not show the wallet panel');
      }
      await directPage.setViewportSize({ width: 1440, height: 1000 });
    }
    await directContext.close();
    await targetPage.locator('#dashboard-tab-overview').click();
    await targetPage.keyboard.press('ArrowRight');
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-collateral').hidden === false && document.activeElement.id === 'dashboard-tab-collateral');
    await targetPage.keyboard.press('End');
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-parameters').hidden === false && document.activeElement.id === 'dashboard-tab-parameters');
    await targetPage.keyboard.press('Home');
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-overview').hidden === false && document.activeElement.id === 'dashboard-tab-overview');
    assert.equal(await targetPage.locator('.dashboard-nav [aria-selected="true"]').count(), 1);
  }

  async function checkAllCurrencyDashboards(targetPage) {
    const observed = [];
    await targetPage.goto(endpoint(portBase + 2, '#dashboard/overview'), { waitUntil: 'networkidle' });
    for (const code of expectedCodes) {
      await targetPage.locator('#dashboard-currency').selectOption(code);
      await targetPage.waitForFunction((selected) => document.querySelector('#dashboard-source-status')?.textContent.includes(`LIVE ${selected}`) && document.querySelector('.dash-system-node.hub strong')?.textContent.includes(`K9${selected}`), code, { timeout: 120000 });
      if (indexerEnabled) {
        await targetPage.waitForFunction(() => document.querySelector('#dashboard-source-status')?.textContent.includes('INDEXED HISTORY'), undefined, { timeout: 120000 });
      } else {
        await targetPage.waitForFunction(() => document.querySelector('#dashboard-overview')?.innerText.includes('Historical curves and complete token-flow timelines need a configured indexer'), undefined, { timeout: 120000 });
      }
      const overview = await targetPage.locator('#dashboard-overview').innerText();
      const tokenSupply = await targetPage.locator('.dash-kpi').first().innerText();
      assert(tokenSupply.includes(`K9${code}`) && !tokenSupply.includes('Unavailable'), `${code}: current token supply read is missing`);
      if (indexerEnabled) {
        assert(overview.includes('INDEXED HISTORY'), `${code}: indexed debt history is missing`);
        assert(overview.includes('Zero-address token transfers'), `${code}: indexed token flow provenance is missing`);
      } else {
        assert(overview.includes('Historical curves and complete token-flow timelines need a configured indexer'), `${code}: unavailable history boundary changed`);
      }
      await targetPage.locator('#dashboard-tab-positions').click();
      await targetPage.waitForFunction(() => document.querySelectorAll('#dashboard-positions tbody tr').length === 3, undefined, { timeout: 120000 });
      const positions = await targetPage.locator('#dashboard-positions').innerText();
      for (const collateral of ['DEMO03', 'DEMO06', 'DEMO09']) assert(positions.includes(collateral), `${code}: missing ${collateral} position`);
      assert(positions.includes('Scanned blocks'), `${code}: discovery coverage is missing`);
      observed.push({ code, positions: 3, collateral: ['DEMO03', 'DEMO06', 'DEMO09'] });
      await targetPage.locator('#dashboard-tab-overview').click();
    }
    await targetPage.goto(endpoint(portBase + 2, '#dashboard/parameters/CHF'), { waitUntil: 'networkidle' });
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-source-status')?.textContent.includes('LIVE CHF') && document.querySelector('#dashboard-parameters')?.innerText.includes('CHF registry'), undefined, { timeout: 120000 });
    assert.equal(new URL(targetPage.url()).hash, '#dashboard/parameters/CHF');
    await targetPage.goto(endpoint(portBase + 2, '#dashboard/overview/USD'), { waitUntil: 'networkidle' });
    await targetPage.waitForFunction(() => document.querySelectorAll('#dashboard-overview .currency-table [data-compare-code]').length === 12, undefined, { timeout: 120000 });
    const comparison = await targetPage.locator('#dashboard-overview').innerText();
    for (const code of expectedCodes) assert(comparison.includes(`K9${code}`), `comparison: missing K9${code}`);
    await targetPage.locator('#dashboard-comparison-search').fill('CHF');
    await targetPage.waitForFunction(() => document.querySelectorAll('#dashboard-overview .currency-table [data-compare-code]').length === 1);
    await targetPage.locator('#dashboard-comparison-search').fill('');
    await targetPage.waitForFunction(() => document.querySelectorAll('#dashboard-overview .currency-table [data-compare-code]').length === 12);
    await targetPage.locator('[data-compare-sort="code"]').click();
    assert((await targetPage.locator('.currency-table tbody tr').first().innerText()).includes('K9AUD'));
    await targetPage.locator('.currency-table [data-compare-code="EUR"]').click();
    await targetPage.waitForFunction(() => document.querySelector('#dashboard-source-status')?.textContent.includes('LIVE EUR'), undefined, { timeout: 120000 });
    assert.equal(new URL(targetPage.url()).hash, '#dashboard/overview/EUR');
    await targetPage.locator('#dashboard-tab-positions').click();
    await targetPage.waitForFunction(() => document.querySelectorAll('#dashboard-positions tbody tr').length === 3, undefined, { timeout: 120000 });
    await targetPage.screenshot({ path: path.join(root, 'artifacts/testnet-dashboard-positions.png'), fullPage: true });
    await targetPage.locator('#dashboard-tab-overview').click();
    return { positions: observed, comparisonCurrencies: 12, currencyDeepLink: 'CHF' };
  }

  async function checkWorkspace(targetPage) {
    for (const view of ['dashboard', 'create', 'manage', 'arena', 'ecosystem', 'connection', 'offline', 'drafts', 'lifecycle']) {
      await targetPage.evaluate((name) => document.querySelector(`[data-view="${name}"]`).click(), view);
      await targetPage.waitForFunction((name) => document.querySelector(`#${name}-view`).hidden === false, view);
      for (const width of [320, 390, 768, 1440]) await checkLayout(targetPage, `app/${view}`, width);
    }
    await targetPage.evaluate(() => document.querySelector('[data-view="offline"]').click());
    await targetPage.locator('#position-form [name="project"]').fill('Responsive review');
    await targetPage.locator('#position-form [name="token"]').fill('0x1111111111111111111111111111111111111111');
    await targetPage.locator('#position-form button[type="submit"]').click();
    await targetPage.waitForFunction(() => document.querySelector('#review-view').hidden === false);
    for (const width of [320, 390, 768, 1440]) await checkLayout(targetPage, 'app/review', width);
    await targetPage.evaluate(() => document.querySelector('[data-view="create"]').click());
  }

  await checkWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(root, 'artifacts/testnet-app-desktop.png'), fullPage: true });
  await page.locator('[data-view="ecosystem"][data-ecosystem-focus="savings"]').click();
  assert(await page.locator('#savings-deposit-form').isVisible());
  assert.equal(await page.locator('#bridge-state').isVisible(), false);
  await page.locator('[data-task-tab="savings-withdraw"]').click();
  assert(await page.locator('#savings-withdraw-form').isVisible());
  assert.equal(await page.locator('#savings-deposit-form').isVisible(), false);
  await page.locator('[data-task-tab="savings-deposit"]').click();
  await page.screenshot({ path: path.join(root, 'artifacts/testnet-earn-desktop.png'), fullPage: true });
  await page.locator('[data-view="ecosystem"][data-ecosystem-focus="equity"]').click();
  assert(await page.locator('#equity-invest-form').isVisible());
  assert.equal(await page.locator('#savings-state').isVisible(), false);
  await page.locator('[data-task-tab="equity-redeem"]').click();
  assert(await page.locator('#equity-redeem-form').isVisible());
  await page.locator('[data-task-tab="equity-invest"]').click();
  await page.screenshot({ path: path.join(root, 'artifacts/testnet-invest-desktop.png'), fullPage: true });
  await page.locator('[data-view="create"]').click();
  await checkDashboard(page);
  const currencyDashboards = await checkAllCurrencyDashboards(page);
  const warmRpcBefore = rpcMethods.length;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#dashboard-source-status')?.textContent.includes('LIVE EUR') && !document.querySelector('#dashboard-overview')?.innerText.includes('Read in progress'), undefined, { timeout: 120000 });
  const warmReloadRpcDelta = rpcMethods.length - warmRpcBefore;
  const warmMethodCounts = rpcMethods.slice(warmRpcBefore).reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {});
  assert(warmReloadRpcDelta < 100, `warm dashboard reload made ${warmReloadRpcDelta} RPC requests instead of using the hourly cache: ${JSON.stringify(warmMethodCounts)}`);
  assert((await page.locator('#dashboard-snapshot').textContent()).toLowerCase().includes('hourly'));
  const freshVerificationRequest = page.waitForRequest((request) => (request.postData() || '').includes('"eth_getCode"'), { timeout: 120000 });
  await page.locator('#dashboard-refresh').click();
  await freshVerificationRequest;
  await page.waitForFunction(() => document.querySelector('#dashboard-refresh')?.disabled === false, undefined, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#dashboard-overview')?.innerText.includes('Read in progress'), undefined, { timeout: 120000 });
  const manualReloadRpcBurst = rpcMethods.length - warmRpcBefore - warmReloadRpcDelta;
  assert(manualReloadRpcBurst > 50, `manual Reload now must bypass the dashboard read cache; observed ${manualReloadRpcBurst} fresh RPC requests`);
  assert(manualReloadRpcBurst <= 500, `manual Reload now exceeded the 500-request freshness budget: ${manualReloadRpcBurst}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(root, 'artifacts/testnet-dashboard-desktop.png'), fullPage: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  monitor(mobilePage);
  await mobilePage.goto(endpoint(portBase + 2), { waitUntil: 'networkidle' });
  await mobilePage.waitForFunction(() => document.querySelector('#sidebar-connection')?.textContent === 'DogeOS testnet · 12 verified currencies', undefined, { timeout: 90000 });
  const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(mobileOverflow, false);
  await checkWorkspace(mobilePage);
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.waitForFunction(() => !document.querySelector('.workspace-more').open);
  await mobilePage.locator('.workspace-more > summary').click();
  await mobilePage.waitForFunction(() => document.querySelector('.workspace-more').open);
  await mobilePage.keyboard.press('Escape');
  await mobilePage.waitForFunction(() => !document.querySelector('.workspace-more').open && document.activeElement.matches('.workspace-more > summary'));
  await mobilePage.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await mobilePage.screenshot({ path: path.join(root, 'artifacts/testnet-app-mobile.png'), fullPage: true });

  const websitePage = await context.newPage();
  monitor(websitePage);
  const websiteResponse = await websitePage.goto(endpoint(portBase), { waitUntil: 'networkidle' });
  assert.equal(websiteResponse.status(), 200);
  assert((await websitePage.locator('.lead').textContent()).includes('International Money Foundry'));
  for (const width of [320, 390, 700, 768, 1440]) await checkLayout(websitePage, 'website', width);
  await websitePage.setViewportSize({ width: 1440, height: 1000 });
  await websitePage.screenshot({ path: path.join(root, 'artifacts/testnet-website-desktop.png'), fullPage: true });
  await websitePage.setViewportSize({ width: 390, height: 844 });
  await websitePage.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await websitePage.screenshot({ path: path.join(root, 'artifacts/testnet-website-mobile.png'), fullPage: true });
  await websitePage.close();

  const articles = JSON.parse(await readFile(path.join(root, 'assets/articles.json'), 'utf8'));
  const docsPage = await context.newPage();
  monitor(docsPage);
  const docsResponse = await docsPage.goto(endpoint(portBase + 1), { waitUntil: 'networkidle' });
  assert.equal(docsResponse.status(), 200);
  assert((await docsPage.locator('#article').textContent()).includes('What is the International Money Foundry?'));
  for (const guide of articles) {
    const url = endpoint(portBase + 1, `/guides/${guide.id}/`);
    const raw = await fetch(url).then((response) => response.text());
    assert(raw.includes(`<h1 id="guide-title" tabindex="-1">${guide.title}</h1>`), `${guide.id}: guide is not present in initial HTML`);
    assert(!raw.includes('Loading guides'));
    const guideResponse = await docsPage.goto(url, { waitUntil: 'load' });
    assert.equal(guideResponse.status(), 200);
    await docsPage.waitForFunction((title) => document.querySelector('#article h1')?.textContent === title, guide.title);
    const canonical = `https://docs.imf.li/guides/${guide.id}/`;
    assert.equal(await docsPage.locator('link[rel="canonical"]').getAttribute('href'), canonical);
    assert.equal(await docsPage.locator('#doc-links a[aria-current="page"]').getAttribute('data-guide'), guide.id);
    assert.equal(await docsPage.locator('#doc-links a[aria-current="page"]').count(), 1);
    assert.equal(await docsPage.locator('#article a[href^="#"]').count(), 0);
    for (const width of [320, 390, 768, 1440]) await checkLayout(docsPage, `docs/${guide.id}`, width);
    await docsPage.locator('#article img').evaluateAll((images) => images.forEach((image) => image.scrollIntoView({ block: 'center' })));
    await docsPage.waitForFunction(() => [...document.querySelectorAll('#article img')].every((image) => image.complete && image.naturalWidth > 0));
    await docsPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  }
  await docsPage.setViewportSize({ width: 390, height: 844 });
  await docsPage.waitForFunction(() => document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === 'false' && document.querySelector('.sidebar-content').hidden);
  await docsPage.screenshot({ path: path.join(root, 'artifacts/testnet-docs-mobile.png'), fullPage: true });
  await docsPage.setViewportSize({ width: 1440, height: 1000 });
  await docsPage.screenshot({ path: path.join(root, 'artifacts/testnet-docs-desktop.png'), fullPage: true });
  const missingDocs = await docsPage.goto(endpoint(portBase + 1, '/not-a-page'), { waitUntil: 'load' });
  assert.equal(missingDocs.status(), 404);
  await docsPage.close();
  const nonCanonicalGuide = await fetch(endpoint(portBase + 1, '/guides/savings'), { redirect: 'manual' });
  assert([301, 308].includes(nonCanonicalGuide.status));
  assert(nonCanonicalGuide.headers.get('location').endsWith('/guides/savings/'));

  for (const [surface, port, origin] of [['website', portBase, 'https://imf.li/'], ['docs', portBase + 1, 'https://docs.imf.li/'], ['app', portBase + 2, 'https://app.imf.li/']]) {
    const robots = await fetch(endpoint(port, '/robots.txt'));
    const sitemap = await fetch(endpoint(port, '/sitemap.xml'));
    const llms = await fetch(endpoint(port, '/llms.txt'));
    assert.equal(robots.status, 200);
    assert.equal(sitemap.status, 200);
    assert.equal(llms.status, 200);
    assert(robots.headers.get('content-type').startsWith('text/plain'));
    assert(/^(application|text)\/xml/.test(sitemap.headers.get('content-type')));
    assert(llms.headers.get('content-type').startsWith('text/plain'));
    assert((await robots.text()).includes('User-agent: *\nAllow: /'));
    const sitemapText = await sitemap.text();
    assert(sitemapText.includes(`<loc>${origin}</loc>`));
    if (surface === 'docs') {
      for (const guide of articles) assert(sitemapText.includes(`<loc>${origin}guides/${guide.id}/</loc>`));
    }
    const llmsText = await llms.text();
    assert(llmsText.includes('DogeOS Chikyū testnet'));
    assert(!llmsText.includes('No live V2 registry is configured'));
    const missing = await fetch(endpoint(port, '/not-a-page'));
    assert.equal(missing.status, 404);
  }

  const crawlerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, javaScriptEnabled: false });
  const crawlerPage = await crawlerContext.newPage();
  monitor(crawlerPage);
  const rpcBeforeCrawling = rpcMethods.length;
  const crawlerResponse = await crawlerPage.goto(endpoint(portBase + 1, '/guides/governance/'), { waitUntil: 'load' });
  assert.equal(crawlerResponse.status(), 200);
  assert((await crawlerPage.locator('#article').textContent()).includes('strictly more than 2%'));
  assert.equal(await crawlerPage.locator('#doc-links a').count(), articles.length);
  assert(await crawlerPage.locator('.sidebar-content').isVisible());
  assert.equal(await crawlerPage.locator('.sidebar-toggle').isVisible(), false);
  await crawlerPage.screenshot({ path: path.join(root, 'artifacts/testnet-docs-nojs-mobile.png'), fullPage: true });
  await crawlerPage.goto(endpoint(portBase), { waitUntil: 'load' });
  assert((await crawlerPage.locator('.lead').textContent()).includes('International Money Foundry'));
  assert(await crawlerPage.locator('.navlinks').isVisible());
  assert.equal(await crawlerPage.locator('.menu').isVisible(), false);
  await crawlerPage.goto(endpoint(portBase + 2), { waitUntil: 'load' });
  assert((await crawlerPage.locator('#view-title').textContent()).includes('Borrow'));
  assert((await crawlerPage.locator('main > noscript').textContent()).includes('Interactive V2 forms require JavaScript'));
  assert.equal(rpcMethods.length, rpcBeforeCrawling);
  await crawlerContext.close();
  const walletPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  monitor(walletPage);
  await walletPage.goto(endpoint(portBase + 2, '/#start'), { waitUntil: 'networkidle' });
  assert.equal(await walletPage.locator('script[src$="dogeos-wallet.js"]').count(), 0, 'DogeOS SDK must not load before explicit connection');
  await walletPage.locator('#wallet-dogeos').click();
  await walletPage.getByText('Google', { exact: true }).waitFor({ timeout: 120000 });
  await walletPage.getByText('X', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await walletPage.locator('script[src$="dogeos-wallet.js"]').count(), 1, 'DogeOS SDK loads once after explicit connection');
  assert.equal(await walletPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'DogeOS wallet modal must fit the 390px mobile viewport');
  for (const label of ['Google', 'X']) {
    const target = await walletPage.getByText(label, { exact: true }).evaluate((element) => {
      const control = element.closest('button, a, [role="button"]') || element;
      const rect = control.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert(target.width >= 44 && target.height >= 44, `${label} login must have a mobile touch target of at least 44px`);
  }
  await walletPage.screenshot({ path: path.join(root, 'artifacts/testnet-dogeos-social-login-mobile.png'), fullPage: true });
  await walletPage.setViewportSize({ width: 320, height: 740 });
  assert.equal(await walletPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'DogeOS wallet modal must fit the 320px mobile viewport');
  await walletPage.screenshot({ path: path.join(root, 'artifacts/testnet-dogeos-social-login-320.png'), fullPage: true });
  await walletPage.keyboard.press('Escape');
  await walletPage.close();
  assert.deepEqual(forbiddenMethods, [], 'Opening the DogeOS wallet modal must not sign or broadcast');
  assert.deepEqual(errors, []);
  const result = {
    ok: true,
    dogeOsLazyModal: true,
    dogeOsSocialLogins: ['google', 'x'],
    automaticRegistryVerification: true,
    chainId: 6281971,
    testAssetLabel: 'tUSDC',
    liveBridgeSavingsEquityReads: true,
    dashboardPanels: 7,
    dashboardLiveCurrencies: expectedCodes,
    currencyDashboards,
    dashboardDiscoveryAndDrawer: true,
    warmReloadRpcDelta,
    manualReloadRpcBurst,
    indexerEnabled,
    staticGuideCount: articles.length,
    canonicalGuideMetadata: true,
    crawlerFiles: true,
    staticContentWithoutJavaScript: true,
    responsiveCheckCount: responsiveChecks.length,
    loadTimings,
    rpcRequestCount: rpcMethods.length,
    forbiddenMethods,
    browserErrors: errors,
    desktopOverflow,
    mobileOverflow,
    notFoundReturns404: true,
    screenshots: [
      'artifacts/testnet-website-desktop.png',
      'artifacts/testnet-website-mobile.png',
      'artifacts/testnet-docs-desktop.png',
      'artifacts/testnet-docs-mobile.png',
      'artifacts/testnet-docs-nojs-mobile.png',
      'artifacts/testnet-app-desktop.png',
      'artifacts/testnet-app-mobile.png',
      'artifacts/testnet-dashboard-desktop.png',
      'artifacts/testnet-dogeos-social-login-mobile.png',
      'artifacts/testnet-dogeos-social-login-320.png',
    ],
    transactionSent: false,
  };
  await writeFile(path.join(root, 'artifacts/testnet-browser-results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
