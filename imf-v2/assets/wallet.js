(() => {
  'use strict';

  const JOURNAL_KEY = 'imf.wallet.transaction-journal.v1';
  const JOURNAL_SCHEMA = 'imf.wallet-transaction-journal.v1';
  const RECEIPT_ATTEMPTS = 30;
  const RECEIPT_DELAY_MS = 1000;
  const HEX = /^0x[0-9a-fA-F]*$/;
  const HASH = /^0x[0-9a-fA-F]{64}$/;
  const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
  const unresolvedStatuses = new Set(['pending', 'unknown']);
  let hooks = {};
  let provider = null;
  let readProvider = null;
  let policySnapshot = null;
  let policySignature = null;
  let preparedMeta = null;
  let journal = [];
  let activeEntryId = null;
  let submission = null;
  let submissionId = null;
  let preparationNonce = 0;
  let sessionNonce = 0;
  let sessionVersion = 0;
  let lifecycle = 0;
  let eventBinding = null;
  let domBindings = [];
  let statusMessage = 'Wallet not initialized.';
  const entryProviders = new Map();
  const polls = new Map();
  const state = {
    available: false,
    account: null,
    chainId: null,
    status: 'unavailable',
    prepared: null,
  };

  class WalletError extends Error {
    constructor(message, code = 'WALLET_ERROR', userRejected = false) {
      super(message);
      this.name = 'WalletError';
      this.code = code;
      this.userRejected = userRejected;
    }
  }

  function errorCode(cause) {
    return cause?.code ?? cause?.info?.error?.code ?? cause?.error?.code;
  }

  function cleanMessage(cause, fallback = 'Wallet operation failed.') {
    const raw = cause instanceof Error ? cause.message : String(cause || fallback);
    const urls = [policySnapshot?.chain?.rpcUrl, policySnapshot?.chain?.explorerUrl].filter(Boolean);
    let message = raw || fallback;
    for (const url of urls) message = message.split(url).join('<url>');
    return message
      .replace(/https?:\/\/[^\s,;)]+/gi, '<url>')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 280) || fallback;
  }

  function cleanError(cause, fallback) {
    if (cause instanceof WalletError) return cause;
    const rejected = Number(errorCode(cause)) === 4001;
    return new WalletError(cleanMessage(cause, fallback), rejected ? 4001 : 'WALLET_ERROR', rejected);
  }

  function failure(code, message) {
    return new WalletError(message, code, Number(code) === 4001);
  }

  function hook(name, ...args) {
    try {
      if (typeof hooks[name] === 'function') hooks[name](...args);
    } catch {}
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  function immutableCopy(value) {
    return deepFreeze(structuredClone(value));
  }

  function normalizeAddress(value, label = 'Address') {
    if (typeof value !== 'string' || !ADDRESS.test(value)) throw failure('INVALID_ADDRESS', `${label} must be a 20-byte 0x address.`);
    return value.toLowerCase();
  }

  function normalizeData(value) {
    if (typeof value !== 'string' || !HEX.test(value) || value.length % 2 !== 0) throw failure('INVALID_CALLDATA', 'Calldata must be complete 0x-prefixed hexadecimal bytes.');
    return value.toLowerCase();
  }

  function normalizeChainId(value) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw failure('INVALID_CHAIN', 'Chain ID is missing.');
    const text = String(value);
    if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(text)) throw failure('INVALID_CHAIN', 'Chain ID must be decimal or 0x hexadecimal.');
    const parsed = BigInt(text);
    if (parsed <= 0n) throw failure('INVALID_CHAIN', 'Chain ID must be positive.');
    return parsed.toString();
  }

  function chainHex(value) {
    return `0x${BigInt(normalizeChainId(value)).toString(16)}`;
  }

  function normalizeHash(value) {
    if (typeof value !== 'string' || !HASH.test(value)) throw failure('INVALID_HASH', 'Transaction hash must be 32 bytes of 0x hexadecimal.');
    return value.toLowerCase();
  }

  function requiredString(value, label, maximum = 240) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw failure('INVALID_INPUT', `${label} is required and must be at most ${maximum} characters.`);
    return value.trim();
  }

  function staticUrl(value, label, rpc = false) {
    if (typeof value !== 'string' || value.trim() !== value || !value) throw failure('INVALID_POLICY', `${label} must be an absolute HTTP(S) URL.`);
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw failure('INVALID_POLICY', `${label} must be an absolute HTTP(S) URL.`);
    }
    const local = ['127.0.0.1', 'localhost'].includes(parsed.hostname);
    if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !local)) throw failure('INVALID_POLICY', `${label} must use HTTPS outside localhost.`);
    if (parsed.username || parsed.password || (rpc && (parsed.search || parsed.hash))) throw failure('INVALID_POLICY', `${label} contains forbidden credentials, query or fragment data.`);
    return value;
  }

  function readPolicy() {
    const raw = typeof hooks.getPolicy === 'function' ? hooks.getPolicy() : null;
    if (raw === null || raw === undefined) return null;
    if (!['testnet-metamask', 'mock-only'].includes(raw.writeMode)) throw failure('INVALID_POLICY', 'Wallet write mode is not supported.');
    if (raw.readAllowed !== true) throw failure('INVALID_POLICY', 'Verified registry reads are required.');
    const chain = raw.chain;
    if (!chain || typeof chain !== 'object') throw failure('INVALID_POLICY', 'Static chain metadata is missing.');
    const currency = chain.nativeCurrency;
    if (!currency || typeof currency !== 'object') throw failure('INVALID_POLICY', 'Native currency metadata is missing.');
    if (!Number.isInteger(currency.decimals) || currency.decimals < 0 || currency.decimals > 255) throw failure('INVALID_POLICY', 'Native currency decimals are invalid.');
    return Object.freeze({
      writeMode: raw.writeMode,
      chainId: normalizeChainId(raw.chainId),
      registryKey: requiredString(raw.registryKey, 'Registry key'),
      readAllowed: true,
      chain: Object.freeze({
        name: requiredString(chain.name, 'Chain name'),
        rpcUrl: staticUrl(chain.rpcUrl, 'RPC URL', true),
        explorerUrl: staticUrl(chain.explorerUrl, 'Explorer URL'),
        nativeCurrency: Object.freeze({
          name: requiredString(currency.name, 'Native currency name'),
          symbol: requiredString(currency.symbol, 'Native currency symbol', 32),
          decimals: currency.decimals,
        }),
      }),
    });
  }

  function fingerprint(policy) {
    return policy ? JSON.stringify(policy) : null;
  }

  function providerFor(policy) {
    if (!policy) return null;
    const candidate = policy.writeMode === 'mock-only' ? window.__IMF_TEST_WALLET__ : window.ethereum;
    return candidate && typeof candidate.request === 'function' ? candidate : null;
  }

  function publicEntry(entry) {
    return entry ? Object.freeze({ ...entry }) : null;
  }

  function latestPending() {
    const active = journal.find((entry) => entry.id === activeEntryId && unresolvedStatuses.has(entry.status));
    return active || [...journal].reverse().find((entry) => unresolvedStatuses.has(entry.status)) || null;
  }

  function getState() {
    return {
      available: state.available,
      account: state.account,
      chainId: state.chainId,
      status: state.status,
      prepared: state.prepared,
      pending: publicEntry(latestPending()),
    };
  }

  function getJournal() {
    return journal.map(publicEntry);
  }

  function renderWallet() {
    if (typeof document === 'undefined') return;
    const target = document.querySelector('#wallet-status');
    if (target) target.textContent = statusMessage;
    const connect = document.querySelector('#wallet-connect');
    const switchButton = document.querySelector('#wallet-switch');
    const forget = document.querySelector('#wallet-forget');
    if (connect) connect.disabled = !state.available || ['connecting', 'restoring'].includes(state.status);
    if (switchButton) switchButton.disabled = !state.available || !policySnapshot || state.status === 'switching';
    if (forget) forget.disabled = !state.account && !state.prepared;
  }

  function setStatus(status, message, isError = false) {
    state.status = status;
    statusMessage = message;
    renderWallet();
    if (message) hook('onStatus', message, isError);
  }

  function sessionChanged() {
    hook('onSession', getState());
  }

  function clearPrepared(notify = true) {
    const hadPreparation = Boolean(state.prepared || preparedMeta);
    state.prepared = null;
    preparedMeta = null;
    if (notify || hadPreparation) hook('onPrepared', null);
  }

  function invalidate(reason = 'Preparation invalidated. Review and prepare again.') {
    preparationNonce += 1;
    clearPrepared();
    if (['preparing', 'prepared', 'validating'].includes(state.status)) state.status = state.account ? 'connected' : 'disconnected';
    statusMessage = reason;
    renderWallet();
    return null;
  }

  function unbindProvider() {
    if (!eventBinding) return;
    if (typeof eventBinding.provider.removeListener === 'function') {
      eventBinding.provider.removeListener('accountsChanged', eventBinding.accountsChanged);
      eventBinding.provider.removeListener('chainChanged', eventBinding.chainChanged);
    }
    eventBinding = null;
  }

  function bindProvider(nextProvider) {
    unbindProvider();
    if (!nextProvider || typeof nextProvider.on !== 'function') return;
    const accountsChanged = (accounts) => {
      sessionNonce += 1;
      sessionVersion += 1;
      invalidate('Accounts changed. Any unsent preparation was cleared.');
      let account = null;
      try {
        account = Array.isArray(accounts) && accounts.length ? normalizeAddress(accounts[0], 'Account') : null;
      } catch {
        state.account = null;
        state.status = 'error';
        statusMessage = 'The wallet returned an invalid account.';
        renderWallet();
        sessionChanged();
        return;
      }
      state.account = account;
      state.status = account ? 'connected' : 'disconnected';
      statusMessage = account ? `Account ${account} connected locally.` : 'Wallet accounts disconnected.';
      renderWallet();
      sessionChanged();
    };
    const chainChanged = (chainId) => {
      sessionNonce += 1;
      sessionVersion += 1;
      invalidate('Chain changed. Any unsent preparation was cleared.');
      try {
        state.chainId = normalizeChainId(chainId);
        state.status = policySnapshot && state.chainId !== policySnapshot.chainId ? 'wrong-chain' : 'connected';
        statusMessage = `Wallet chain ${state.chainId}.`;
      } catch {
        state.chainId = null;
        state.status = 'error';
        statusMessage = 'The wallet returned an invalid chain ID.';
      }
      renderWallet();
      sessionChanged();
    };
    nextProvider.on('accountsChanged', accountsChanged);
    nextProvider.on('chainChanged', chainChanged);
    eventBinding = { provider: nextProvider, accountsChanged, chainChanged };
  }

  function synchronizePolicy() {
    const nextPolicy = readPolicy();
    const nextSignature = fingerprint(nextPolicy);
    const nextProvider = providerFor(nextPolicy);
    const providerChanged = nextProvider !== provider;
    const policyChanged = nextSignature !== policySignature;
    if (!providerChanged && !policyChanged) {
      policySnapshot = nextPolicy;
      return { policy: nextPolicy, provider, signature: nextSignature };
    }
    sessionVersion += 1;
    preparationNonce += 1;
    clearPrepared();
    if (providerChanged) {
      unbindProvider();
      provider = nextProvider;
      state.account = null;
      state.chainId = null;
      bindProvider(provider);
    }
    policySnapshot = nextPolicy;
    policySignature = nextSignature;
    state.available = Boolean(provider);
    if (!state.available) {
      state.status = 'unavailable';
      statusMessage = nextPolicy ? 'No compatible EIP-1193 provider is available for this policy.' : 'No verified write policy is configured.';
    }
    renderWallet();
    sessionChanged();
    return { policy: nextPolicy, provider, signature: nextSignature };
  }

  function requireWallet() {
    const current = synchronizePolicy();
    if (!current.policy) throw failure('POLICY_REQUIRED', 'A verified write policy is required.');
    if (!current.provider) throw failure('WALLET_UNAVAILABLE', current.policy.writeMode === 'mock-only' ? 'The isolated test wallet is not installed.' : 'No browser EIP-1193 wallet is available.');
    return current;
  }

  function normalizedAccounts(accounts) {
    if (!Array.isArray(accounts)) throw failure('INVALID_ACCOUNT', 'Wallet accounts response was not an array.');
    return accounts.map((account) => normalizeAddress(account, 'Account'));
  }

  function applySession(accounts, chainId, cancelPreparation = true) {
    const account = accounts.length ? accounts[0] : null;
    const nextChain = chainId === undefined ? state.chainId : chainId;
    const changed = account !== state.account || nextChain !== state.chainId;
    if (!changed) return false;
    sessionVersion += 1;
    if (cancelPreparation) {
      preparationNonce += 1;
      clearPrepared();
    }
    state.account = account;
    state.chainId = nextChain;
    renderWallet();
    sessionChanged();
    return true;
  }

  function connectedStatus() {
    if (!state.account) return ['disconnected', 'No wallet account is connected locally.'];
    if (policySnapshot && state.chainId && state.chainId !== policySnapshot.chainId) return ['wrong-chain', `Connected on chain ${state.chainId}; required chain is ${policySnapshot.chainId}.`];
    return ['connected', `Account ${state.account} · chain ${state.chainId || 'not yet read'}.`];
  }

  async function connect() {
    const current = requireWallet();
    const requestNonce = ++sessionNonce;
    setStatus('connecting', 'Requesting wallet accounts…');
    try {
      const accounts = normalizedAccounts(await current.provider.request({ method: 'eth_requestAccounts' }));
      if (requestNonce !== sessionNonce) return getState();
      const chainId = normalizeChainId(await current.provider.request({ method: 'eth_chainId' }));
      if (requestNonce !== sessionNonce) return getState();
      applySession(accounts, chainId);
      setStatus(...connectedStatus());
      return getState();
    } catch (cause) {
      const error = cleanError(cause, 'Could not connect wallet accounts.');
      setStatus(error.userRejected ? 'rejected' : 'error', error.userRejected ? 'Wallet connection request rejected.' : error.message, true);
      throw error;
    }
  }

  async function restore() {
    const current = requireWallet();
    const requestNonce = ++sessionNonce;
    setStatus('restoring', 'Restoring locally permitted wallet accounts…');
    try {
      const accounts = normalizedAccounts(await current.provider.request({ method: 'eth_accounts' }));
      if (requestNonce !== sessionNonce) return getState();
      applySession(accounts, undefined);
      setStatus(...connectedStatus());
      return getState();
    } catch (cause) {
      const error = cleanError(cause, 'Could not restore wallet accounts.');
      setStatus('error', error.message, true);
      throw error;
    }
  }

  async function switchChain() {
    const current = requireWallet();
    const requestNonce = ++sessionNonce;
    const expected = current.signature;
    const chainId = chainHex(current.policy.chainId);
    setStatus('switching', `Requesting chain ${current.policy.chainId}…`);
    try {
      try {
        await current.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
      } catch (cause) {
        if (Number(errorCode(cause)) !== 4902) throw cause;
        if (requestNonce !== sessionNonce || fingerprint(readPolicy()) !== expected) throw failure('STALE_SESSION', 'Wallet policy changed before the chain could be added.');
        await current.provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId,
            chainName: current.policy.chain.name,
            rpcUrls: [current.policy.chain.rpcUrl],
            blockExplorerUrls: [current.policy.chain.explorerUrl],
            nativeCurrency: { ...current.policy.chain.nativeCurrency },
          }],
        });
      }
      if (requestNonce !== sessionNonce) return getState();
      const accounts = normalizedAccounts(await current.provider.request({ method: 'eth_accounts' }));
      const actualChain = normalizeChainId(await current.provider.request({ method: 'eth_chainId' }));
      if (requestNonce !== sessionNonce) return getState();
      applySession(accounts, actualChain);
      if (actualChain !== current.policy.chainId) throw failure('WRONG_CHAIN', `Wallet did not switch to required chain ${current.policy.chainId}.`);
      setStatus(...connectedStatus());
      return getState();
    } catch (cause) {
      const error = cleanError(cause, 'Could not switch wallet chain.');
      setStatus(error.userRejected ? 'rejected' : 'error', error.userRejected ? 'Chain switch request rejected.' : error.message, true);
      throw error;
    }
  }

  function forget() {
    sessionNonce += 1;
    sessionVersion += 1;
    invalidate('Local wallet session forgotten. Extension permission was not revoked.');
    state.account = null;
    state.chainId = null;
    setStatus('forgotten', 'Local wallet session forgotten. The extension may still remember site permission; use the extension to revoke it.');
    sessionChanged();
    return getState();
  }

  function currentReadProvider() {
    const next = typeof hooks.getReadProvider === 'function' ? hooks.getReadProvider() : null;
    if (!next || typeof next.call !== 'function' || typeof next.estimateGas !== 'function' || typeof next.getTransactionReceipt !== 'function') throw failure('READ_PROVIDER_REQUIRED', 'An ethers-compatible read provider with call, estimateGas and receipt support is required.');
    if (readProvider !== next) {
      readProvider = next;
      sessionVersion += 1;
      if (state.prepared || preparedMeta) {
        preparationNonce += 1;
        clearPrepared();
      }
      sessionChanged();
    }
    return next;
  }

  function assertPreparationCurrent(requestNonce, version) {
    if (requestNonce !== preparationNonce || (version !== undefined && version !== sessionVersion)) throw failure('STALE_PREPARATION', 'Preparation became stale. Review and prepare again.');
  }

  async function prepare(input) {
    const requestNonce = ++preparationNonce;
    clearPrepared();
    setStatus('preparing', 'Validating and simulating transaction. Nothing has been sent.');
    try {
      if (!input || typeof input !== 'object') throw failure('INVALID_INPUT', 'Preparation input is required.');
      const operation = requiredString(input.operation, 'Operation', 80);
      const label = requiredString(input.label, 'Label');
      const to = normalizeAddress(input.to, 'Destination');
      const data = normalizeData(input.data);
      const from = normalizeAddress(input.account, 'Account');
      const requestedChain = normalizeChainId(input.chainId);
      const registryKey = requiredString(input.registryKey, 'Registry key');
      const contextKey = requiredString(input.contextKey, 'Context key');
      const review = immutableCopy(input.review);
      const current = requireWallet();
      if (current.policy.chainId !== requestedChain || current.policy.registryKey !== registryKey) throw failure('POLICY_MISMATCH', 'Preparation does not match the active chain and registry policy.');
      if (state.account !== from || (state.chainId !== null && state.chainId !== requestedChain)) throw failure('SESSION_MISMATCH', 'Preparation does not match the connected account and chain.');
      const accounts = normalizedAccounts(await current.provider.request({ method: 'eth_accounts' }));
      const actualChain = normalizeChainId(await current.provider.request({ method: 'eth_chainId' }));
      assertPreparationCurrent(requestNonce);
      applySession(accounts, actualChain, false);
      if (accounts[0] !== from || actualChain !== requestedChain || state.account !== from || state.chainId !== requestedChain) throw failure('SESSION_MISMATCH', 'Wallet account or chain changed. Review and prepare again.');
      if (fingerprint(readPolicy()) !== current.signature) throw failure('POLICY_MISMATCH', 'Wallet policy changed during preparation.');
      const reader = currentReadProvider();
      const version = sessionVersion;
      await reader.call({ from, to, data });
      assertPreparationCurrent(requestNonce, version);
      const estimatedGas = BigInt(await reader.estimateGas({ from, to, data, value: '0x0' })).toString();
      assertPreparationCurrent(requestNonce, version);
      if (fingerprint(readPolicy()) !== current.signature) throw failure('POLICY_MISMATCH', 'Wallet policy changed during preparation.');
      const prepared = Object.freeze({
        id: crypto.randomUUID(),
        operation,
        label,
        from,
        to,
        data,
        value: '0x0',
        chainId: requestedChain,
        registryKey,
        contextKey,
        review,
        estimatedGas,
      });
      preparedMeta = {
        prepared,
        provider: current.provider,
        readProvider: reader,
        policySignature: current.signature,
        sessionVersion: version,
        createdAt: new Date().toISOString(),
      };
      state.prepared = prepared;
      setStatus('prepared', `${label} prepared · estimated ${estimatedGas} gas units, not total OP Stack fee. Nothing has been sent.`);
      hook('onPrepared', prepared);
      return prepared;
    } catch (cause) {
      const error = cleanError(cause, 'Transaction preparation failed.');
      if (requestNonce === preparationNonce) {
        clearPrepared();
        setStatus(error.userRejected ? 'rejected' : 'error', error.message, true);
      }
      throw error;
    }
  }

  function journalEntry(prepared, hash, status, createdAt) {
    const now = new Date().toISOString();
    return {
      id: prepared.id,
      operation: prepared.operation,
      label: prepared.label,
      from: prepared.from,
      to: prepared.to,
      data: prepared.data,
      value: '0x0',
      chainId: prepared.chainId,
      registryKey: prepared.registryKey,
      contextKey: prepared.contextKey,
      estimatedGas: prepared.estimatedGas,
      hash,
      status,
      createdAt,
      submittedAt: now,
      updatedAt: now,
      receiptNotified: false,
      lastError: null,
    };
  }

  function saveJournal() {
    try {
      window.localStorage.setItem(JOURNAL_KEY, JSON.stringify({ schema: JOURNAL_SCHEMA, entries: journal }));
      return true;
    } catch (cause) {
      hook('onStatus', `Transaction journal could not be persisted: ${cleanMessage(cause)}`, true);
      return false;
    }
  }

  function loadJournal() {
    journal = [];
    let parsed;
    try {
      const raw = window.localStorage.getItem(JOURNAL_KEY);
      if (!raw) return;
      parsed = JSON.parse(raw);
    } catch (cause) {
      hook('onStatus', `Transaction journal is unavailable or invalid: ${cleanMessage(cause)}`, true);
      return;
    }
    if (parsed?.schema !== JOURNAL_SCHEMA || !Array.isArray(parsed.entries)) {
      hook('onStatus', 'Transaction journal schema is not supported; existing storage was left untouched.', true);
      return;
    }
    for (const raw of parsed.entries) {
      try {
        const status = ['pending', 'unknown', 'confirmed', 'reverted'].includes(raw.status) ? raw.status : null;
        if (!status) throw new Error('Invalid status');
        const entry = {
          id: requiredString(raw.id, 'Journal ID', 128),
          operation: requiredString(raw.operation, 'Operation', 80),
          label: requiredString(raw.label, 'Label'),
          from: normalizeAddress(raw.from, 'Journal account'),
          to: normalizeAddress(raw.to, 'Journal destination'),
          data: normalizeData(raw.data),
          value: '0x0',
          chainId: normalizeChainId(raw.chainId),
          registryKey: requiredString(raw.registryKey, 'Registry key'),
          contextKey: requiredString(raw.contextKey, 'Context key'),
          estimatedGas: BigInt(raw.estimatedGas).toString(),
          hash: raw.hash === null ? null : normalizeHash(raw.hash),
          status,
          createdAt: requiredString(raw.createdAt, 'Creation time', 64),
          submittedAt: requiredString(raw.submittedAt, 'Submission time', 64),
          updatedAt: requiredString(raw.updatedAt, 'Update time', 64),
          receiptNotified: raw.receiptNotified === true,
          lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 280) : null,
        };
        if (['pending', 'confirmed', 'reverted'].includes(status) && !entry.hash) throw new Error('Missing hash');
        if (status === 'unknown' && entry.hash) entry.status = 'pending';
        journal.push(entry);
      } catch {
        hook('onStatus', 'A malformed transaction journal entry was ignored; no transaction was submitted.', true);
      }
    }
    activeEntryId = latestPending()?.id || null;
  }

  function recordEntry(entry, reader) {
    if (!journal.some((existing) => existing.id === entry.id)) journal.push(entry);
    const stored = journal.find((existing) => existing.id === entry.id);
    if (reader) entryProviders.set(stored.id, reader);
    activeEntryId = stored.id;
    saveJournal();
    return stored;
  }

  function receiptStatus(receipt) {
    if (!receipt || receipt.status === null || receipt.status === undefined) return null;
    if (receipt.status === 1 || receipt.status === '0x1' || receipt.status === '1') return 1;
    if (receipt.status === 0 || receipt.status === '0x0' || receipt.status === '0') return 0;
    throw failure('INVALID_RECEIPT', 'Receipt status was not 0, 1 or null.');
  }

  function finishReceipt(entry, receipt, status) {
    if (!unresolvedStatuses.has(entry.status)) return;
    entry.status = status === 1 ? 'confirmed' : 'reverted';
    entry.updatedAt = new Date().toISOString();
    entry.receiptNotified = true;
    entry.lastError = null;
    saveJournal();
    if (activeEntryId === entry.id) activeEntryId = null;
    setStatus(entry.status, status === 1 ? `Transaction confirmed: ${entry.hash}` : `Transaction reverted on chain: ${entry.hash}`, status === 0);
    hook('onReceipt', publicEntry(entry), receipt);
  }

  function pollReceipt(entry, reader) {
    if (polls.has(entry.id)) return polls.get(entry.id);
    const generation = lifecycle;
    const promise = (async () => {
      for (let attempt = 0; attempt < RECEIPT_ATTEMPTS; attempt += 1) {
        if (generation !== lifecycle || !unresolvedStatuses.has(entry.status)) return publicEntry(entry);
        let receipt = null;
        try {
          receipt = await reader.getTransactionReceipt(entry.hash);
          if (generation !== lifecycle) return publicEntry(entry);
          if (receipt?.transactionHash && normalizeHash(receipt.transactionHash) !== entry.hash) throw failure('RECEIPT_MISMATCH', 'Read provider returned a receipt for a different transaction.');
          const status = receiptStatus(receipt);
          if (status !== null) {
            finishReceipt(entry, receipt, status);
            return publicEntry(entry);
          }
        } catch (cause) {
          entry.lastError = cleanMessage(cause, 'Receipt read failed.');
          entry.updatedAt = new Date().toISOString();
        }
        if (attempt + 1 < RECEIPT_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RECEIPT_DELAY_MS));
      }
      if (generation === lifecycle && unresolvedStatuses.has(entry.status)) {
        saveJournal();
        setStatus(entry.status, `Receipt is still unresolved after ${RECEIPT_ATTEMPTS} bounded checks. Reconcile later; do not resubmit blindly.`, true);
      }
      return publicEntry(entry);
    })().finally(() => {
      if (polls.get(entry.id) === promise) polls.delete(entry.id);
    });
    polls.set(entry.id, promise);
    return promise;
  }

  async function reconcile(entryId, transactionHash) {
    const generation = lifecycle;
    if (entryId !== undefined || transactionHash !== undefined) {
      const entry = journal.find((candidate) => candidate.id === entryId);
      if (!entry) throw failure('JOURNAL_ENTRY_MISSING', 'Unknown journal entry for manual reconciliation.');
      if (entry.status === 'unknown' && !entry.hash) {
        entry.hash = normalizeHash(transactionHash);
        entry.status = 'pending';
        entry.updatedAt = new Date().toISOString();
        entry.lastError = null;
        activeEntryId = entry.id;
        saveJournal();
      } else if (transactionHash !== undefined && normalizeHash(transactionHash) !== entry.hash) {
        throw failure('HASH_MISMATCH', 'A journal entry cannot be assigned a different transaction hash.');
      }
    }
    const current = synchronizePolicy();
    let reader = null;
    const waiting = [];
    for (const entry of journal) {
      if (!unresolvedStatuses.has(entry.status) || !entry.hash || generation !== lifecycle) continue;
      let original = entryProviders.get(entry.id) || null;
      if (!original && current.policy?.chainId === entry.chainId && current.policy?.registryKey === entry.registryKey) {
        if (!reader) reader = currentReadProvider();
        original = reader;
        entryProviders.set(entry.id, original);
      }
      if (original) waiting.push(pollReceipt(entry, original));
    }
    const unresolved = latestPending();
    if (unresolved && !unresolved.hash) setStatus('unknown', 'Submission outcome is unknown and no hash is stored. Reconcile with an externally verified hash; do not submit again blindly.', true);
    else if (unresolved) setStatus('pending', `Transaction ${unresolved.hash} is awaiting a receipt. No automatic resubmission will occur.`);
    await Promise.all(waiting);
    return getJournal();
  }

  function sendPrepared(id) {
    if (submission) {
      if (submissionId === id) return submission;
      return Promise.reject(failure('SUBMISSION_IN_FLIGHT', 'Another transaction submission is already in flight.'));
    }
    submissionId = id;
    submission = (async () => {
      const prepared = state.prepared;
      const meta = preparedMeta;
      if (!prepared || !meta || prepared.id !== id || meta.prepared !== prepared) throw failure('PREPARATION_MISSING', 'Only the current immutable preparation can be submitted.');
      preparationNonce += 1;
      clearPrepared();
      setStatus('validating', 'Rechecking account, chain and policy immediately before submission…');
      let attempted = false;
      try {
        const current = requireWallet();
        if (current.provider !== meta.provider || current.signature !== meta.policySignature) throw failure('STALE_PREPARATION', 'Wallet provider or policy changed. Prepare again.');
        if (prepared.contextKey !== meta.prepared.contextKey || sessionVersion !== meta.sessionVersion) throw failure('STALE_PREPARATION', 'Wallet session or operation context changed. Prepare again.');
        const accounts = normalizedAccounts(await current.provider.request({ method: 'eth_accounts' }));
        const actualChain = normalizeChainId(await current.provider.request({ method: 'eth_chainId' }));
        if (fingerprint(readPolicy()) !== meta.policySignature || current.provider !== providerFor(readPolicy())) throw failure('STALE_PREPARATION', 'Wallet policy changed before submission. Prepare again.');
        if (accounts[0] !== prepared.from || actualChain !== prepared.chainId || state.account !== prepared.from || state.chainId !== prepared.chainId) {
          applySession(accounts, actualChain);
          throw failure('SESSION_MISMATCH', 'Wallet account or chain no longer matches the preparation. Nothing was sent.');
        }
        attempted = true;
        const hash = await current.provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: prepared.from, to: prepared.to, data: prepared.data, value: '0x0' }],
        });
        let normalizedHash;
        try {
          normalizedHash = normalizeHash(hash);
        } catch (cause) {
          const entry = recordEntry(journalEntry(prepared, null, 'unknown', meta.createdAt), meta.readProvider);
          entry.lastError = cleanMessage(cause);
          saveJournal();
          setStatus('unknown', 'The wallet returned no usable transaction hash after submission. Outcome is unknown; reconcile manually and do not retry blindly.', true);
          throw cleanError(cause, 'No usable transaction hash was returned.');
        }
        const entry = recordEntry(journalEntry(prepared, normalizedHash, 'pending', meta.createdAt), meta.readProvider);
        setStatus('pending', `Transaction submitted once: ${normalizedHash}. Waiting for a receipt; no further transaction will run automatically.`);
        pollReceipt(entry, meta.readProvider);
        return publicEntry(entry);
      } catch (cause) {
        const error = cleanError(cause, 'Transaction submission failed.');
        const ownEntry = journal.some((entry) => entry.id === prepared.id);
        if (attempted && !error.userRejected && !ownEntry) {
          const entry = recordEntry(journalEntry(prepared, null, 'unknown', meta.createdAt), meta.readProvider);
          entry.lastError = error.message;
          saveJournal();
          setStatus('unknown', 'Submission failed after broadcast was possible. Outcome is unknown; reconcile manually and never retry automatically.', true);
        } else if (error.userRejected || !ownEntry) {
          setStatus(error.userRejected ? 'rejected' : 'error', error.userRejected ? 'Transaction request rejected. No automatic retry occurred.' : error.message, true);
        }
        throw error;
      }
    })().finally(() => {
      if (submissionId === id) {
        submission = null;
        submissionId = null;
      }
    });
    return submission;
  }

  function renderTransaction(target, preparedOrEntry) {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) throw failure('RENDER_TARGET_MISSING', 'Transaction render target was not found.');
    if (!preparedOrEntry || typeof preparedOrEntry !== 'object') {
      container.replaceChildren();
      return;
    }
    const title = document.createElement('strong');
    title.textContent = preparedOrEntry.label || preparedOrEntry.operation || 'Transaction';
    const details = document.createElement('div');
    const status = preparedOrEntry.status || 'prepared';
    const rows = [
      `Status: ${status}`,
      `Operation: ${preparedOrEntry.operation || 'unknown'}`,
      `Chain: ${preparedOrEntry.chainId || 'unknown'}`,
      `From: ${preparedOrEntry.from || 'unknown'}`,
      `To: ${preparedOrEntry.to || 'unknown'}`,
      `Calldata: ${preparedOrEntry.data || '0x'}`,
      `Value: ${preparedOrEntry.value || '0x0'}`,
      `Context: ${preparedOrEntry.contextKey || 'unknown'}`,
    ];
    if (preparedOrEntry.estimatedGas) rows.push(`Estimated gas: ${preparedOrEntry.estimatedGas} gas units (not total OP Stack fee)`);
    if (preparedOrEntry.hash) rows.push(`Transaction hash: ${preparedOrEntry.hash}`);
    details.textContent = rows.join('\n');
    container.replaceChildren(title, details);
  }

  function bindControl(selector, handler) {
    if (typeof document === 'undefined') return;
    const element = document.querySelector(selector);
    if (!element) return;
    element.addEventListener('click', handler);
    domBindings.push({ element, handler });
  }

  function init(options) {
    lifecycle += 1;
    for (const binding of domBindings) binding.element.removeEventListener('click', binding.handler);
    domBindings = [];
    unbindProvider();
    hooks = options || {};
    provider = null;
    readProvider = null;
    policySnapshot = null;
    policySignature = null;
    preparedMeta = null;
    activeEntryId = null;
    submission = null;
    submissionId = null;
    entryProviders.clear();
    polls.clear();
    preparationNonce += 1;
    sessionNonce += 1;
    sessionVersion += 1;
    state.account = null;
    state.chainId = null;
    state.prepared = null;
    state.available = false;
    state.status = 'disconnected';
    loadJournal();
    try {
      synchronizePolicy();
      if (state.available) setStatus('disconnected', 'Wallet available. Restore or explicitly connect an account.');
      else setStatus('unavailable', statusMessage);
    } catch (cause) {
      provider = null;
      state.available = false;
      setStatus('error', cleanMessage(cause, 'Wallet policy is invalid.'), true);
    }
    bindControl('#wallet-connect', () => { connect().catch(() => {}); });
    bindControl('#wallet-switch', () => { switchChain().catch(() => {}); });
    bindControl('#wallet-forget', () => { forget(); });
    renderWallet();
    sessionChanged();
    const generation = lifecycle;
    (async () => {
      if (state.available) await restore();
      if (generation === lifecycle) await reconcile();
    })().catch(() => {});
    return api;
  }

  const api = Object.freeze({
    init,
    getState,
    getJournal,
    connect,
    restore,
    switchChain,
    forget,
    prepare,
    sendPrepared,
    invalidate,
    reconcile,
    renderTransaction,
    journalKey: JOURNAL_KEY,
  });

  window.IMF_WALLET = api;
})();
