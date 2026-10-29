import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const appUrl = process.env.IMF_FIXTURE_APP_URL || 'http://127.0.0.1:5192/';
const account = '0xF17e00000000000000000000000000000000000B';
const position = '0xF17e00000000000000000000000000000000000A';
const collateral = '0xf17e00000000000000000000000000000000000c';
const other = '0x1000000000000000000000000000000000000002';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mockSource = await readFile(path.join(root, 'scripts/mock-eip1193.mjs'), 'utf8');
const healthStatus = await new Promise((resolve, reject) => {
  const request = httpGet(appUrl, (response) => {
    response.resume();
    resolve(response.statusCode);
  });
  request.on('error', reject);
  request.setTimeout(5000, () => request.destroy(new Error(`Fixture health check timed out at ${appUrl}`)));
});
assert.equal(healthStatus, 200, `Start the fixture app at ${appUrl} first`);
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const results = [];
const watchdog = setTimeout(() => {
  console.error('Journey watchdog expired after:', results);
  process.exit(2);
}, 90000);

function pass(name) {
  results.push(name);
  console.log(`PASS ${name}`);
}

async function clickView(page, view, focus = null) {
  const selector = `[data-view="${view}"]${focus ? `[data-ecosystem-focus="${focus}"]` : ''}`;
  const target = page.locator(selector).first();
  if (!(await target.isVisible())) await page.locator('.workspace-more > summary').click();
  await target.click();
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript({ content: mockSource });
  await context.addInitScript(({ account, collateral, position }) => {
    window.__IMF_TEST_WALLET_CONTROLS__.reset({ connected: false, accounts: [account] });
    window.ethereum = window.__IMF_TEST_WALLET__;
    window.__IMF_TEST_DECORATE_PROVIDER__ = (provider) => {
      if (provider.__imfTestDecorated) return provider;
      const value = window.IMF_V2;
      const call = provider.call.bind(provider);
      const writeSelectors = new Set(Object.values(value.V2_ACTION_METADATA).map(({ signature }) => value.V2_ACTION_INTERFACE.getFunction(signature).selector));
      let approvedAmount = 0n;
      provider.call = async (transaction) => {
        if (approvedAmount > 0n && transaction.data?.startsWith('0xdd62ed3e') && transaction.to?.toLowerCase() === collateral.toLowerCase()) {
          return `0x${approvedAmount.toString(16).padStart(64, '0')}`;
        }
        if (writeSelectors.has(transaction.data?.slice(0, 10))) return '0x';
        return call(transaction);
      };
      provider.estimateGas = async () => 150000n;
      provider.getTransactionReceipt = async (hash) => {
        const entry = window.__IMF_TEST_WALLET_CONTROLS__.snapshot().transactions.find((item) => item.hash === hash);
        if (!entry) return null;
        const action = value.decodeV2Action(entry.transaction);
        if (action.operation === 'erc20.approve') approvedAmount = action.args.amount;
        const logs = [];
        if (action.operation === 'hub.openPosition' || action.operation === 'hub.clone') {
          const event = value.V2_ACTION_INTERFACE.getEvent('PositionOpened');
          const log = value.V2_ACTION_INTERFACE.encodeEventLog(event, [account, position, position, collateral]);
          logs.push({ address: entry.transaction.to, topics: log.topics, data: log.data, logIndex: 0, blockNumber: 6281971, transactionHash: hash });
        }
        return { status: 1, blockNumber: 6281971, transactionHash: hash, logs };
      };
      provider.__imfTestDecorated = true;
      return provider;
    };
  }, { account, collateral, position });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  globalThis.__journeyPage = page;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Browser:', message.text()); });
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.IMF_V2_APP?.state.verified.get('USD') === true);
  await page.locator('#wallet-connect').click();
  await page.waitForFunction(() => window.IMF_WALLET.getState().account !== null);
  assert.equal(await page.locator('#v2-position-form [name=account]').inputValue(), account.toLowerCase());
  pass('visible MetaMask connection uses the isolated fixture account');

  await page.locator('[data-view="create"]').click();
  await page.locator('#create-view').waitFor({ state: 'visible' });
  await page.locator('#v2-position-form [name=project]').fill('Isolated test project');
  await page.locator('#new-fields > summary').click();
  await page.locator('#v2-position-form [name=token]').fill(collateral);
  await page.locator('#v2-position-form [name=collateral]').fill('600000');
  await page.locator('#prepare-position').click();
  await page.waitForFunction(() => window.IMF_WALLET.getState().prepared?.operation === 'erc20.approve');
  let prepared = await page.evaluate(() => window.IMF_WALLET.getState().prepared);
  let decoded = await page.evaluate((tx) => window.IMF_V2.decodeV2Action(tx), { to: prepared.to, data: prepared.data });
  assert.equal(decoded.args.spender.toLowerCase(), '0xf17e000000000000000000000000000000000008');
  assert.equal(decoded.args.amount, 600000000000n);
  assert((await page.locator('#transaction-review').textContent()).includes('Exact allowance'));
  pass('new position prepares exact collateral allowance before opening');

  await page.locator('#transaction-send').click();
  await page.waitForFunction(() => window.IMF_WALLET.getJournal().some((entry) => entry.status === 'confirmed'));
  await page.locator('#prepare-position').click();
  await page.waitForFunction(() => window.IMF_WALLET.getState().prepared?.operation === 'hub.openPosition');
  prepared = await page.evaluate(() => window.IMF_WALLET.getState().prepared);
  decoded = await page.evaluate((tx) => window.IMF_V2.decodeV2Action(tx), { to: prepared.to, data: prepared.data });
  assert.equal(decoded.args.initialCollateral, 600000000000n);
  assert.equal(decoded.args.expirationSeconds, 31536000n);
  assert((await page.locator('#transaction-review').textContent()).includes('Irrevocable opening fee'));
  await page.locator('#transaction-send').click();
  await page.waitForFunction(() => window.IMF_WALLET.getJournal().filter((entry) => entry.status === 'confirmed').length === 2);
  await page.waitForFunction((expected) => document.querySelector('#manage-load-form [name=managePosition]').value.toLowerCase() === expected.toLowerCase(), position);
  const openingReceipt = await page.evaluate(() => window.IMF_WALLET.getJournal().filter((entry) => entry.status === 'confirmed').at(-1));
  assert.equal(openingReceipt.operation, 'hub.openPosition');
  assert(openingReceipt.hash);
  pass('open position confirms once and reconciles PositionOpened from the hub receipt');

  await page.locator('#v2-position-form input[name=action][value=mint]').check();
  await page.locator('#prepare-position').click();
  await page.waitForFunction(() => window.IMF_WALLET.getState().prepared?.operation === 'position.mint');
  prepared = await page.evaluate(() => window.IMF_WALLET.getState().prepared);
  decoded = await page.evaluate((tx) => window.IMF_V2.decodeV2Action(tx), { to: prepared.to, data: prepared.data });
  assert.equal(decoded.args.target.toLowerCase(), account.toLowerCase());
  assert.equal(decoded.args.amount, 1000000000000000000000n);
  pass('existing-position mint uses recipient and gross amount correctly');

  await clickView(page, 'connection');
  await page.locator('#fixture-scenario').selectOption('challenged');
  await page.waitForFunction(() => window.IMF_V2_APP.state.verifying.size === 0);
  await clickView(page, 'arena');
  const bid = page.locator('[data-operation="hub.bid"]');
  await bid.locator('[name=index]').fill('0');
  await bid.locator('[name=amount]').fill('1');
  await bid.locator('button[type=submit]').click();
  await page.waitForFunction(() => window.IMF_WALLET.getState().prepared?.operation === 'hub.bid');
  prepared = await page.evaluate(() => window.IMF_WALLET.getState().prepared);
  decoded = await page.evaluate((tx) => window.IMF_V2.decodeV2Action(tx), { to: prepared.to, data: prepared.data });
  assert.equal(decoded.args.challengeNumber, 0n);
  assert.equal(decoded.args.size, 1000000n);
  assert.equal(decoded.args.postponeCollateralReturn, false);
  assert((await page.locator('#transaction-review').textContent()).includes('Aversion window'));
  pass('auction form uses current challenge index, collateral units and phase');

  const forms = await page.locator('form[data-operation]').evaluateAll((elements) => elements.map((form) => form.dataset.operation));
  for (const operation of forms) {
    if (operation === 'hub.bid') continue;
    console.log(`CHECK ${operation}`);
    await page.evaluate(() => window.IMF_WALLET.invalidate('Next isolated form check'));
    const form = page.locator(`form[data-operation="${operation}"]`);
    const view = await form.evaluate((element) => element.closest('section[id$="-view"]').id.replace('-view', ''));
    const focus = view !== 'ecosystem' ? null
      : ['savings.save', 'savings.withdraw', 'savings.adjust', 'savings.refreshMyBalance', 'savings.refreshBalance'].includes(operation) ? 'savings'
        : ['equity.invest', 'equity.redeemExpected'].includes(operation) ? 'equity'
          : operation.startsWith('bridge.') ? 'bridge' : 'governance';
    await clickView(page, view, focus);
    const taskTab = { 'savings.save': 'savings-deposit', 'savings.withdraw': 'savings-withdraw', 'equity.invest': 'equity-invest', 'equity.redeemExpected': 'equity-redeem' }[operation];
    if (taskTab) await page.locator(`[data-task-tab="${taskTab}"]`).click();
    await form.evaluate((element) => { let parent = element.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } });
    const inputs = await form.locator('input, textarea').all();
    for (const input of inputs) {
      const name = await input.getAttribute('name');
      if (!name) continue;
      const type = await input.getAttribute('type');
      if (type === 'checkbox' || type === 'hidden') continue;
      const required = await input.getAttribute('required') !== null;
      const current = await input.inputValue();
      if (current && !['position', 'target', 'token', 'collateral', 'newOwner', 'minter'].includes(name)) continue;
      const values = {
        position, target: position, token: '0xf17e000000000000000000000000000000000002', collateral,
        newOwner: other, minter: other, recipient: account, amount: '1', newMinted: '0', newCollateral: '100000',
        newPrice: '2', price: '2', shares: '1', minimum: '1', applicationPeriod: '900', applicationFee: '1000',
        message: 'Isolated governance review', votes: '1', targets: other, ratePPM: '59400', index: '0',
        owner: account, repay: '1', mint: '1', collateralWithdraw: '1', collateralDeposit: '1', expiration: '2027-06-01T00:00',
      };
      if (values[name] !== undefined && (required || current || ['position', 'target', 'token', 'collateral', 'newOwner', 'minter'].includes(name))) await input.fill(values[name]);
    }
    for (const checkbox of await form.locator('input[type=checkbox][required]').all()) await checkbox.check();
    await form.locator('button[type=submit]').click();
    const expected = ({ 'position.close': 'position.repay', 'savings.save': 'savings.saveFor' })[operation] || operation;
    await page.waitForFunction((operation) => window.IMF_WALLET.getState().prepared?.operation === operation, expected, { timeout: 10000 });
    const tx = await page.evaluate(() => window.IMF_WALLET.getState().prepared);
    assert(tx.data.startsWith('0x'));
    assert.equal(tx.value, '0x0');
    pass(`visible form ${operation} prepares ${expected}`);
  }

  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.evaluate(async () => {
    window.IMF_WALLET.invalidate('Clear the isolated preparation');
    await window.IMF_WALLET.restore();
    for (const details of document.querySelectorAll('.advanced-actions, .advanced-actions details, .action-disclosure')) details.open = false;
    document.querySelector('details:has(form[data-operation="bridge.mintTo"])').open = true;
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  await page.locator('[data-view=create]').click();
  await page.locator('#v2-position-form input[name=action][value=new]').check();
  await page.screenshot({ path: path.join(root, 'artifacts/journey-app-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.querySelector('[data-view=manage]').click(); window.scrollTo({ top: 0, behavior: 'auto' }); });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false);
  await page.screenshot({ path: path.join(root, 'artifacts/journey-app-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: results.length, transactionSent: 'fixture-only', browserErrors: errors }, null, 2));
} catch (error) {
  const page = contextPage();
  if (page) {
    console.error('Journey diagnostic:', await page.evaluate(() => ({
      feedback: document.querySelector('#feedback')?.textContent,
      formError: document.querySelector('#v2-form-error')?.textContent,
      connectionError: document.querySelector('#connection-error')?.textContent,
      wallet: window.IMF_WALLET?.getState(),
      provider: window.IMF_V2_APP?.state.provider ? { call: typeof window.IMF_V2_APP.state.provider.call, estimateGas: typeof window.IMF_V2_APP.state.provider.estimateGas, receipt: typeof window.IMF_V2_APP.state.provider.getTransactionReceipt, keys: Object.keys(window.IMF_V2_APP.state.provider) } : null,
      read: window.IMF_V2_APP?.state.currentRead ? { eligible: window.IMF_V2_APP.state.currentRead.eligible, checks: window.IMF_V2_APP.state.currentRead.checks } : null,
    })));
  }
  throw error;
} finally {
  await browser.close();
  clearTimeout(watchdog);
}

function contextPage() {
  return globalThis.__journeyPage || null;
}
