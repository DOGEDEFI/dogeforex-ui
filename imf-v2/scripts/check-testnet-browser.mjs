import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const portBase = Number(process.env.IMF_TESTNET_PREVIEW_PORT || 5260);
const rpcOrigin = 'https://rpc.testnet.dogeos.com';
const endpoint = (port, pathname = '/') => `http://127.0.0.1:${port}${pathname}`;
const responsiveChecks = [];

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
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
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
  const errors = [];
  const monitor = (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== rpcOrigin) return;
      try {
        const body = JSON.parse(request.postData() || '{}');
        const methods = Array.isArray(body) ? body.map((entry) => entry.method) : [body.method];
        rpcMethods.push(...methods);
        for (const method of methods) {
          if (/^(eth_send|eth_sign|personal_sign|wallet_)/.test(method || '')) forbiddenMethods.push(method);
        }
      } catch {}
    });
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  monitor(page);
  const response = await page.goto(endpoint(portBase + 2), { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.querySelector('#sidebar-connection')?.textContent === 'V2 read-only · 1 verified currency', undefined, { timeout: 60000 });
  assert.deepEqual(await page.locator('#ecosystem-currency option:not([disabled])').evaluateAll((options) => options.map((option) => option.value)), ['USD']);
  assert.equal(await page.locator('#ecosystem-currency option').count(), 11);
  assert((await page.locator('#ecosystem-availability').textContent()).includes('1 of 11'));
  await page.locator('[data-view="connection"]').click();
  const registryText = await page.locator('#registry-summary').textContent();
  assert(registryText.includes('6281971'));
  assert(registryText.includes('USD'));
  assert((await page.locator('#runtime-message').textContent()).includes('tUSDC'));
  assert((await page.locator('#runtime-message').textContent()).includes('testnet'));
  await page.locator('[data-view="ecosystem"]').click();
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

  async function checkWorkspace(targetPage) {
    for (const view of ['create', 'manage', 'ecosystem', 'connection', 'offline', 'drafts', 'lifecycle']) {
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

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  monitor(mobilePage);
  await mobilePage.goto(endpoint(portBase + 2), { waitUntil: 'networkidle' });
  await mobilePage.waitForFunction(() => document.querySelector('#sidebar-connection')?.textContent === 'V2 read-only · 1 verified currency', undefined, { timeout: 60000 });
  const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(mobileOverflow, false);
  await checkWorkspace(mobilePage);
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.waitForFunction(() => document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === 'false');
  await mobilePage.locator('.sidebar-toggle').click();
  await mobilePage.waitForFunction(() => document.querySelector('.sidebar-toggle').getAttribute('aria-expanded') === 'true');
  await mobilePage.keyboard.press('Escape');
  await mobilePage.waitForFunction(() => document.querySelector('.sidebar-content').hidden);
  await mobilePage.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await mobilePage.screenshot({ path: path.join(root, 'artifacts/testnet-app-mobile.png'), fullPage: true });

  const websitePage = await context.newPage();
  monitor(websitePage);
  const websiteResponse = await websitePage.goto(endpoint(portBase), { waitUntil: 'networkidle' });
  assert.equal(websiteResponse.status(), 200);
  assert((await websitePage.locator('.lead').textContent()).includes('International Multicurrency Framework'));
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
  assert((await docsPage.locator('#article').textContent()).includes('What is the International Multicurrency Framework?'));
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
  assert.equal(await crawlerPage.locator('#doc-links a').count(), 18);
  assert(await crawlerPage.locator('.sidebar-content').isVisible());
  assert.equal(await crawlerPage.locator('.sidebar-toggle').isVisible(), false);
  await crawlerPage.screenshot({ path: path.join(root, 'artifacts/testnet-docs-nojs-mobile.png'), fullPage: true });
  await crawlerPage.goto(endpoint(portBase), { waitUntil: 'load' });
  assert((await crawlerPage.locator('.lead').textContent()).includes('International Multicurrency Framework'));
  assert(await crawlerPage.locator('.navlinks').isVisible());
  assert.equal(await crawlerPage.locator('.menu').isVisible(), false);
  await crawlerPage.goto(endpoint(portBase + 2), { waitUntil: 'load' });
  assert((await crawlerPage.locator('#view-title').textContent()).includes('V2 position planner'));
  assert((await crawlerPage.locator('.sidebar-content').textContent()).includes('Interactive V2 forms require JavaScript'));
  assert.equal(rpcMethods.length, rpcBeforeCrawling);
  await crawlerContext.close();
  assert.deepEqual(forbiddenMethods, []);
  assert.deepEqual(errors, []);
  const result = {
    ok: true,
    automaticRegistryVerification: true,
    chainId: 6281971,
    testAssetLabel: 'tUSDC',
    liveBridgeSavingsEquityReads: true,
    staticGuideCount: articles.length,
    canonicalGuideMetadata: true,
    crawlerFiles: true,
    staticContentWithoutJavaScript: true,
    responsiveCheckCount: responsiveChecks.length,
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
    ],
    transactionSent: false,
  };
  await writeFile(path.join(root, 'artifacts/testnet-browser-results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
