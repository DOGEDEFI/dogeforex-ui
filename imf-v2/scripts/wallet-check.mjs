import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const appUrl = process.env.IMF_FIXTURE_APP_URL || 'http://127.0.0.1:5192/';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [walletSource, mockSource] = await Promise.all([
  readFile(path.join(root, 'assets/wallet.js'), 'utf8'),
  readFile(path.join(root, 'scripts/mock-eip1193.mjs'), 'utf8'),
]);
const account = '0x1000000000000000000000000000000000000001';
const otherAccount = '0x1000000000000000000000000000000000000002';
const destination = '0x2000000000000000000000000000000000000002';
const spender = '0x3000000000000000000000000000000000000003';
const chainId = '6281971';
const browserErrors = [];
const results = [];

async function reachable() {
  try {
    return await new Promise((resolve, reject) => {
      const request = httpGet(appUrl, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error(`Fixture health check timed out at ${appUrl}`)));
    });
  } catch {
    return false;
  }
}

assert(await reachable(), `Fixture app server is not available at ${appUrl}; start it separately before running this check`);
assert.doesNotMatch(walletSource, /method:\s*['"](?:personal_sign|eth_sign|eth_signTypedData|wallet_revokePermissions)/);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-first-run', '--disable-gpu'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: mockSource });
  await context.addInitScript({ content: walletSource });
  await context.addInitScript(() => {
    const install = () => {
      document.body.replaceChildren();
      for (const id of ['wallet-connect', 'wallet-switch', 'wallet-forget']) {
        const button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.textContent = id;
        document.body.append(button);
      }
      for (const id of ['wallet-status', 'transaction-panel']) {
        const element = document.createElement('div');
        element.id = id;
        document.body.append(element);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    return route.abort();
  });
  await page.goto(appUrl, { waitUntil: 'load' });

  async function fresh(options = {}) {
    return page.evaluate(async (options) => {
      const controls = window.__IMF_TEST_WALLET_CONTROLS__;
      controls.releaseAll();
      controls.reset({
        connected: options.connected !== false,
        accounts: options.accounts || [controls.DEFAULT_ACCOUNT],
        chainId: options.chainId,
        requireAddChain: options.requireAddChain,
        emitOnConnect: options.emitOnConnect,
      });
      if (!options.preserveJournal) window.localStorage.clear();
      delete window.ethereum;
      if (options.installEthereum) window.ethereum = window.__IMF_TEST_WALLET__;
      window.__walletPolicy = {
        writeMode: options.writeMode || 'mock-only',
        chainId: options.policyChainId || controls.DEFAULT_CHAIN_ID,
        registryKey: options.registryKey || 'USD:verified-fixture',
        readAllowed: true,
        chain: {
          name: 'DogeOS Chikyū testnet',
          rpcUrl: 'http://127.0.0.1:5192/fixture-rpc',
          explorerUrl: 'https://testnet-explorer.dogeos.com/',
          nativeCurrency: { name: 'Dogecoin', symbol: 'DOGE', decimals: 18 },
        },
      };
      const fixture = {
        calls: [],
        estimates: [],
        receiptCalls: [],
        gas: options.gas || '123456',
        callError: options.callError || null,
        gasError: options.gasError || null,
        receiptError: options.receiptError || null,
        receipt: options.receipt === undefined ? { status: 1, blockNumber: 1 } : options.receipt,
      };
      window.__readFixture = fixture;
      window.__readProvider = {
        async call(transaction) {
          fixture.calls.push(structuredClone(transaction));
          if (fixture.callError) throw new Error(fixture.callError);
          return '0x';
        },
        async estimateGas(transaction) {
          fixture.estimates.push(structuredClone(transaction));
          if (fixture.gasError) throw new Error(fixture.gasError);
          return BigInt(fixture.gas);
        },
        async getTransactionReceipt(hash) {
          fixture.receiptCalls.push(hash);
          if (fixture.receiptError) throw new Error(fixture.receiptError);
          if (!fixture.receipt) return null;
          return { ...structuredClone(fixture.receipt), transactionHash: hash };
        },
      };
      window.__walletEvents = { sessions: [], prepared: [], receipts: [], statuses: [] };
      window.__prepareInput = {
        operation: 'erc20-approve',
        label: 'Exact collateral approval',
        to: destinationForTest(),
        data: '0x',
        account: controls.DEFAULT_ACCOUNT,
        chainId: controls.DEFAULT_CHAIN_ID,
        registryKey: window.__walletPolicy.registryKey,
        contextKey: 'position:one:step:approve',
        review: { exactAmount: '1000000', nested: { humanChecked: true } },
      };
      window.IMF_WALLET.init({
        getPolicy: () => window.__walletPolicy,
        getReadProvider: () => window.__readProvider,
        onSession: (state) => window.__walletEvents.sessions.push(state),
        onPrepared: (prepared) => window.__walletEvents.prepared.push(prepared),
        onReceipt: (entry, receipt) => window.__walletEvents.receipts.push({ entry, receipt }),
        onStatus: (message, isError) => window.__walletEvents.statuses.push({ message, isError }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.connected !== false && options.establishChain !== false && window.IMF_WALLET.getState().available) await window.IMF_WALLET.connect();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return window.IMF_WALLET.getState();

      function destinationForTest() {
        return '0x2000000000000000000000000000000000000002';
      }
    }, options);
  }

  async function state() {
    return page.evaluate(() => window.IMF_WALLET.getState());
  }

  async function snapshot() {
    return page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.snapshot());
  }

  async function prepare(overrides = {}) {
    return page.evaluate((overrides) => window.IMF_WALLET.prepare({ ...window.__prepareInput, ...overrides }), overrides);
  }

  async function apiError(method, ...args) {
    const result = await page.evaluate(async ({ method, args }) => {
      try {
        const value = await window.IMF_WALLET[method](...args);
        return { unexpected: value };
      } catch (cause) {
        return { name: cause.name, code: cause.code, message: cause.message, userRejected: cause.userRejected === true };
      }
    }, { method, args });
    assert(!result.unexpected, `${method} unexpectedly succeeded`);
    return result;
  }

  async function waitFor(expression, argument, timeout = 6000) {
    await page.waitForFunction(expression, argument, { timeout });
  }

  async function test(name, run) {
    await run();
    results.push(name);
    console.log(`PASS ${name}`);
  }

  await test('production policy never falls back to the test-only mock', async () => {
    const initial = await fresh({ writeMode: 'testnet-metamask', connected: true });
    assert.equal(initial.available, false);
    const error = await apiError('connect');
    assert.equal(error.code, 'WALLET_UNAVAILABLE');
    assert.equal((await snapshot()).calls.length, 0);
  });

  await test('explicit connect requests accounts and reads the chain', async () => {
    await fresh({ connected: false });
    await page.evaluate(() => window.IMF_WALLET.connect());
    const current = await state();
    assert.equal(current.account, account);
    assert.equal(current.chainId, chainId);
    const methods = (await snapshot()).calls.map((call) => call.method);
    assert(methods.includes('eth_requestAccounts'));
    assert(methods.includes('eth_chainId'));
    assert((await page.locator('#wallet-status').textContent()).includes(account));
  });

  await test('restore uses eth_accounts without an account request or signature', async () => {
    await fresh({ connected: true, establishChain: false });
    assert.equal((await state()).account, account);
    await page.evaluate(() => {
      window.__IMF_TEST_WALLET_CONTROLS__.clearCalls();
      return window.IMF_WALLET.restore();
    });
    assert.deepEqual((await snapshot()).calls.map((call) => call.method), ['eth_accounts']);
  });

  await test('a restored account can prepare after a fresh chain read', async () => {
    const restored = await fresh({ connected: true, establishChain: false });
    assert.equal(restored.account, account);
    assert.equal(restored.chainId, null);
    const prepared = await prepare();
    assert.equal(prepared.chainId, chainId);
    assert.equal((await state()).chainId, chainId);
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('a stale connect response cannot overwrite a newer accountsChanged event', async () => {
    await fresh({ connected: false });
    await page.evaluate(() => {
      const controls = window.__IMF_TEST_WALLET_CONTROLS__;
      controls.deferNext('eth_requestAccounts');
      window.__connectResult = window.IMF_WALLET.connect();
    });
    await waitFor(() => window.__IMF_TEST_WALLET_CONTROLS__.snapshot().calls.some((call) => call.method === 'eth_requestAccounts'));
    await page.evaluate(() => {
      const controls = window.__IMF_TEST_WALLET_CONTROLS__;
      controls.setAccounts(['0x1000000000000000000000000000000000000002']);
      controls.releaseNext('eth_requestAccounts');
      return window.__connectResult;
    });
    assert.equal((await state()).account, otherAccount);
  });

  await test('connection rejection remains distinguishable from failure', async () => {
    await fresh({ connected: false });
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.failNext('eth_requestAccounts', { code: 4001, message: 'User declined.' }));
    const error = await apiError('connect');
    assert.equal(error.code, 4001);
    assert.equal(error.userRejected, true);
    assert.equal((await state()).status, 'rejected');
  });

  await test('4902 alone triggers add-chain with exact static policy metadata', async () => {
    await fresh({ chainId: '0x1', requireAddChain: true, establishChain: false });
    await page.evaluate(() => window.IMF_WALLET.switchChain());
    const current = await snapshot();
    assert.equal(current.addedChains.length, 1);
    assert.deepEqual(current.addedChains[0], {
      chainId: `0x${BigInt(chainId).toString(16)}`,
      chainName: 'DogeOS Chikyū testnet',
      rpcUrls: ['http://127.0.0.1:5192/fixture-rpc'],
      blockExplorerUrls: ['https://testnet-explorer.dogeos.com/'],
      nativeCurrency: { name: 'Dogecoin', symbol: 'DOGE', decimals: 18 },
    });
    assert.equal((await state()).chainId, chainId);
  });

  await test('switch rejection never falls through to add-chain', async () => {
    await fresh({ chainId: '0x1', requireAddChain: true, establishChain: false });
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.failNext('wallet_switchEthereumChain', { code: 4001, message: 'No switch.' }));
    assert.equal((await apiError('switchChain')).userRejected, true);
    assert.equal((await snapshot()).addedChains.length, 0);
  });

  await test('prepare simulates and estimates fresh without sending, then freezes review data', async () => {
    await fresh();
    const prepared = await prepare({ to: destination.toUpperCase().replace('0X', '0x'), data: '0xAABB' });
    assert.equal(prepared.from, account);
    assert.equal(prepared.to, destination);
    assert.equal(prepared.data, '0xaabb');
    assert.equal(prepared.value, '0x0');
    assert.equal(prepared.estimatedGas, '123456');
    assert.equal((await snapshot()).sendAttempts, 0);
    const evidence = await page.evaluate(() => ({
      calls: window.__readFixture.calls,
      estimates: window.__readFixture.estimates,
      frozen: Object.isFrozen(window.IMF_WALLET.getState().prepared),
      reviewFrozen: Object.isFrozen(window.IMF_WALLET.getState().prepared.review.nested),
      events: window.__walletEvents.prepared.map((entry) => entry?.id || null),
    }));
    assert.deepEqual(evidence.calls, [{ from: account, to: destination, data: '0xaabb' }]);
    assert.deepEqual(evidence.estimates, [{ from: account, to: destination, data: '0xaabb', value: '0x0' }]);
    assert.equal(evidence.frozen, true);
    assert.equal(evidence.reviewFrozen, true);
    assert.equal(evidence.events.at(-1), prepared.id);
    await page.evaluate((prepared) => window.IMF_WALLET.renderTransaction('#transaction-panel', prepared), prepared);
    const text = await page.locator('#transaction-panel').textContent();
    assert(text.includes('123456 gas units (not total OP Stack fee)'));
    assert(text.includes('0xaabb'));
  });

  await test('accountsChanged invalidates an unsent preparation', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.setAccounts(['0x1000000000000000000000000000000000000002']));
    assert.equal((await state()).prepared, null);
    await apiError('sendPrepared', prepared.id);
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('pre-send eth_accounts catches a silent account change', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.setAccounts(['0x1000000000000000000000000000000000000002'], false));
    assert.equal((await apiError('sendPrepared', prepared.id)).code, 'SESSION_MISMATCH');
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('chainChanged invalidates an unsent preparation', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.setChainId('0x1'));
    assert.equal((await state()).prepared, null);
    await apiError('sendPrepared', prepared.id);
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('pre-send eth_chainId catches a silent chain change', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.setChainId('0x1', false));
    assert.equal((await apiError('sendPrepared', prepared.id)).code, 'SESSION_MISMATCH');
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('registry policy changes make preparation stale', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => { window.__walletPolicy.registryKey = 'USD:different-registry'; });
    await apiError('sendPrepared', prepared.id);
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('context invalidation prevents sending an old preparation', async () => {
    await fresh();
    const prepared = await prepare({ contextKey: 'position:one:before-edit' });
    await page.evaluate(() => window.IMF_WALLET.invalidate('Review context edited.'));
    assert.equal((await apiError('sendPrepared', prepared.id)).code, 'PREPARATION_MISSING');
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('static-call failure sends nothing', async () => {
    await fresh({ callError: 'execution simulation reverted' });
    await apiError('prepare', await page.evaluate(() => window.__prepareInput));
    assert.equal((await snapshot()).sendAttempts, 0);
    assert.equal(await page.evaluate(() => window.__readFixture.estimates.length), 0);
  });

  await test('gas-estimation failure sends nothing', async () => {
    await fresh({ gasError: 'gas unavailable' });
    await apiError('prepare', await page.evaluate(() => window.__prepareInput));
    assert.equal((await snapshot()).sendAttempts, 0);
    assert.equal(await page.evaluate(() => window.__readFixture.estimates.length), 1);
  });

  await test('double-click sends exact approval calldata once and never auto-runs the next preparation', async () => {
    await fresh();
    const amount = '0xde0b6b3a7640000';
    const calldata = `0x095ea7b3${spender.slice(2).padStart(64, '0')}${BigInt(amount).toString(16).padStart(64, '0')}`;
    const prepared = await prepare({ data: calldata, review: { spender, exactAmount: BigInt(amount).toString() } });
    const entries = await page.evaluate((id) => Promise.all([window.IMF_WALLET.sendPrepared(id), window.IMF_WALLET.sendPrepared(id)]), prepared.id);
    assert.equal(entries[0].hash, entries[1].hash);
    await waitFor(() => window.__walletEvents.receipts.length === 1);
    const current = await snapshot();
    assert.equal(current.sendAttempts, 1);
    assert.equal(current.transactions.length, 1);
    assert.deepEqual(current.transactions[0].transaction, { from: account, to: destination, data: calldata, value: '0x0' });
    const methods = current.calls.map((call) => call.method);
    const sendIndex = methods.indexOf('eth_sendTransaction');
    assert.deepEqual(methods.slice(sendIndex - 2, sendIndex + 1), ['eth_accounts', 'eth_chainId', 'eth_sendTransaction']);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), await page.evaluate(() => window.IMF_WALLET.journalKey));
    assert.equal(stored.entries.length, 1);
    assert.equal(stored.entries[0].hash, entries[0].hash);
    assert.equal('review' in stored.entries[0], false);
    await prepare({ operation: 'mint-exact', label: 'Separate mint review', contextKey: 'position:one:step:mint' });
    await page.waitForTimeout(40);
    assert.equal((await snapshot()).sendAttempts, 1);
    assert.equal((await state()).prepared.operation, 'mint-exact');
  });

  await test('transaction rejection has no journal hash and no automatic retry', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.failNext('eth_sendTransaction', { code: 4001, message: 'User declined transaction.' }));
    const error = await apiError('sendPrepared', prepared.id);
    assert.equal(error.userRejected, true);
    assert.equal((await state()).status, 'rejected');
    assert.equal(await page.evaluate(() => window.IMF_WALLET.getJournal().length), 0);
    await page.evaluate(() => window.IMF_WALLET.reconcile());
    assert.equal((await snapshot()).sendAttempts, 1);
  });

  await test('null receipts remain pending and later confirm on the original read provider', async () => {
    await fresh({ receipt: null });
    const prepared = await prepare();
    const entry = await page.evaluate((id) => window.IMF_WALLET.sendPrepared(id), prepared.id);
    assert.equal(entry.status, 'pending');
    assert.equal((await state()).pending.hash, entry.hash);
    await page.waitForTimeout(30);
    assert.equal((await snapshot()).sendAttempts, 1);
    await page.evaluate(() => { window.__readFixture.receipt = { status: 1, blockNumber: 9 }; });
    await waitFor(() => window.__walletEvents.receipts.length === 1);
    assert.equal((await state()).status, 'confirmed');
    assert.equal(await page.evaluate(() => window.__walletEvents.receipts[0].receipt.blockNumber), 9);
  });

  await test('receipt status zero is terminal reverted and callbacks do not duplicate', async () => {
    await fresh({ receipt: { status: 0, blockNumber: 11 } });
    const prepared = await prepare();
    await page.evaluate((id) => window.IMF_WALLET.sendPrepared(id), prepared.id);
    await waitFor(() => window.__walletEvents.receipts.length === 1);
    assert.equal((await state()).status, 'reverted');
    assert.equal(await page.evaluate(() => window.IMF_WALLET.getJournal()[0].status), 'reverted');
    await page.evaluate(() => window.IMF_WALLET.reconcile());
    assert.equal(await page.evaluate(() => window.__walletEvents.receipts.length), 1);
  });

  await test('post-broadcast error remains unknown until a manual hash is supplied', async () => {
    await fresh();
    const prepared = await prepare();
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.failNext('eth_sendTransaction', { code: -32603, message: 'Transport https://rpc-secret.invalid/path failed' }));
    await apiError('sendPrepared', prepared.id);
    const unknown = await page.evaluate(() => window.IMF_WALLET.getJournal()[0]);
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.hash, null);
    assert(!unknown.lastError.includes('rpc-secret'));
    await page.evaluate(() => window.IMF_WALLET.reconcile());
    assert.equal((await snapshot()).sendAttempts, 1);
    const externalHash = `0x${'ab'.repeat(32)}`;
    await page.evaluate(({ id, hash }) => window.IMF_WALLET.reconcile(id, hash), { id: prepared.id, hash: externalHash });
    assert.equal(await page.evaluate(() => window.IMF_WALLET.getJournal()[0].status), 'confirmed');
    assert.equal(await page.evaluate(() => window.__walletEvents.receipts.length), 1);
    assert.equal((await snapshot()).sendAttempts, 1);
  });

  await test('reload restores and reconciles the journal without resubmission', async () => {
    await fresh({ receipt: null });
    const prepared = await prepare({ operation: 'reload-safe', contextKey: 'position:reload:step:one' });
    const submitted = await page.evaluate((id) => window.IMF_WALLET.sendPrepared(id), prepared.id);
    assert.equal(submitted.status, 'pending');
    await page.reload({ waitUntil: 'load' });
    await fresh({ preserveJournal: true, receipt: { status: 1, blockNumber: 21 } });
    await waitFor(() => window.__walletEvents.receipts.length === 1);
    const restored = await page.evaluate(() => window.IMF_WALLET.getJournal());
    assert.equal(restored.length, 1);
    assert.equal(restored[0].hash, submitted.hash);
    assert.equal(restored[0].status, 'confirmed');
    assert.equal(restored[0].operation, 'reload-safe');
    assert.equal(restored[0].contextKey, 'position:reload:step:one');
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('an unknown submission is retained alongside an older pending entry', async () => {
    await fresh({ receipt: null });
    const first = await prepare({ operation: 'first-pending', contextKey: 'position:multiple:step:first' });
    await page.evaluate((id) => window.IMF_WALLET.sendPrepared(id), first.id);
    const second = await prepare({ operation: 'second-unknown', contextKey: 'position:multiple:step:second' });
    await page.evaluate(() => window.__IMF_TEST_WALLET_CONTROLS__.failNext('eth_sendTransaction', { code: -32603, message: 'Connection dropped after possible broadcast.' }));
    await apiError('sendPrepared', second.id);
    const entries = await page.evaluate(() => window.IMF_WALLET.getJournal());
    assert.deepEqual(entries.map((entry) => entry.status), ['pending', 'unknown']);
    assert.equal(entries[1].operation, 'second-unknown');
    assert.equal(entries[1].hash, null);
    assert.equal((await snapshot()).sendAttempts, 2);
  });

  await test('init reconciles a persisted hash with reads only when no wallet is available', async () => {
    await fresh({ receipt: null });
    const prepared = await prepare({ operation: 'wallet-less-reconcile' });
    const submitted = await page.evaluate((id) => window.IMF_WALLET.sendPrepared(id), prepared.id);
    await page.reload({ waitUntil: 'load' });
    const unavailable = await fresh({
      preserveJournal: true,
      writeMode: 'testnet-metamask',
      connected: false,
      receipt: { status: 1, blockNumber: 22 },
    });
    assert.equal(unavailable.available, false);
    await waitFor(() => window.__walletEvents.receipts.length === 1);
    assert.equal(await page.evaluate(() => window.IMF_WALLET.getJournal()[0].status), 'confirmed');
    assert.equal(await page.evaluate(() => window.IMF_WALLET.getJournal()[0].hash), submitted.hash);
    assert.equal((await snapshot()).calls.length, 0);
  });

  await test('unresolved journal survives account and chain mismatches without receipt substitution', async () => {
    await fresh({ receipt: null });
    const prepared = await prepare({ operation: 'preserve-identity' });
    const submitted = await page.evaluate((id) => window.IMF_WALLET.sendPrepared(id), prepared.id);
    await page.reload({ waitUntil: 'load' });
    await fresh({
      preserveJournal: true,
      receipt: { status: 1 },
      accounts: [otherAccount],
      chainId: '0x1',
      policyChainId: '1',
      registryKey: 'USD:other-registry',
    });
    const restored = await page.evaluate(() => window.IMF_WALLET.getJournal());
    assert.equal(restored[0].status, 'pending');
    assert.equal(restored[0].from, account);
    assert.equal(restored[0].chainId, chainId);
    assert.equal(restored[0].operation, 'preserve-identity');
    assert.equal(restored[0].hash, submitted.hash);
    assert.equal(await page.evaluate(() => window.__readFixture.receiptCalls.length), 0);
    assert.equal((await snapshot()).sendAttempts, 0);
  });

  await test('forget is local-only and no forbidden signing or revocation methods are used', async () => {
    await fresh();
    await prepare();
    const forgotten = await page.evaluate(() => window.IMF_WALLET.forget());
    assert.equal(forgotten.account, null);
    assert.equal(forgotten.prepared, null);
    assert((await page.locator('#wallet-status').textContent()).includes('may still remember'));
    const methods = (await snapshot()).calls.map((call) => call.method);
    assert(!methods.some((method) => /^(?:personal_sign|eth_sign|wallet_revokePermissions)/.test(method)));
    await page.evaluate(() => window.IMF_WALLET.restore());
    assert.equal((await state()).account, account);
  });

  assert.deepEqual(browserErrors, [], `Unexpected browser errors: ${browserErrors.join('; ')}`);
  console.log(`\n${results.length} wallet engine checks passed in isolated Chrome with no real wallet or network calls.`);
} finally {
  await browser.close();
}
