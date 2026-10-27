(() => {
  'use strict';

  const DEFAULT_ACCOUNT = '0x1000000000000000000000000000000000000001';
  const DEFAULT_CHAIN_ID = '6281971';
  const listeners = { accountsChanged: new Set(), chainChanged: new Set() };
  let accounts = [DEFAULT_ACCOUNT];
  let connected = false;
  let chainId = `0x${BigInt(DEFAULT_CHAIN_ID).toString(16)}`;
  let requireAddChain = false;
  let emitOnConnect = false;
  let sendAttempts = 0;
  let calls = [];
  let transactions = [];
  let addedChains = [];
  let usableChains = new Set([chainId]);
  let failures = new Map();
  let gates = new Map();
  let hashes = [];

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  function rpcError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function emit(event, value) {
    for (const listener of [...listeners[event]]) listener(value);
  }

  function setAccounts(next, notify = true, connect = true) {
    accounts = [...next];
    connected = connect;
    if (notify) emit('accountsChanged', [...accounts]);
  }

  function setChainId(next, notify = true) {
    chainId = typeof next === 'string' && next.startsWith('0x') ? next.toLowerCase() : `0x${BigInt(next).toString(16)}`;
    usableChains.add(chainId);
    if (notify) emit('chainChanged', chainId);
  }

  function takeFailure(method) {
    const queue = failures.get(method);
    if (!queue?.length) return null;
    const next = queue.shift();
    throw rpcError(next.code ?? 4001, next.message || (next.code === 4902 ? 'Unrecognized chain.' : 'Request failed.'));
  }

  function handle(method, params) {
    if (method === 'eth_sendTransaction') sendAttempts += 1;
    takeFailure(method);
    if (method === 'eth_accounts') return connected ? [...accounts] : [];
    if (method === 'eth_requestAccounts') {
      connected = true;
      if (emitOnConnect) emit('accountsChanged', [...accounts]);
      return [...accounts];
    }
    if (method === 'eth_chainId') return chainId;
    if (method === 'wallet_switchEthereumChain') {
      const requested = params?.[0]?.chainId?.toLowerCase();
      if (requireAddChain && !usableChains.has(requested)) throw rpcError(4902, 'Unrecognized chain ID. Try adding the chain.');
      if (!usableChains.has(requested)) throw rpcError(4902, 'Unrecognized chain ID. Try adding the chain.');
      setChainId(requested);
      return null;
    }
    if (method === 'wallet_addEthereumChain') {
      const metadata = clone(params?.[0]);
      if (!metadata?.chainId) throw rpcError(-32602, 'Chain metadata is required.');
      addedChains.push(metadata);
      usableChains.add(metadata.chainId.toLowerCase());
      setChainId(metadata.chainId);
      return null;
    }
    if (method === 'eth_sendTransaction') {
      const transaction = clone(params?.[0]);
      const hash = hashes.length ? hashes.shift() : `0x${sendAttempts.toString(16).padStart(64, '0')}`;
      transactions.push({ transaction, hash });
      return hash;
    }
    if (['personal_sign', 'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'wallet_revokePermissions'].includes(method)) throw rpcError(4100, 'Method is disabled by the isolated test wallet.');
    throw rpcError(4200, `Unsupported method: ${method}`);
  }

  async function request({ method, params = [] }) {
    calls.push({ method, params: clone(params) });
    const queue = gates.get(method);
    if (queue?.length) {
      const gate = queue[0];
      const outcome = handle(method, params);
      await gate.promise;
      return clone(outcome);
    }
    return clone(handle(method, params));
  }

  const wallet = {
    request,
    on(event, listener) {
      if (!listeners[event]) throw new Error(`Unsupported event ${event}`);
      listeners[event].add(listener);
    },
    removeListener(event, listener) {
      listeners[event]?.delete(listener);
    },
  };

  function reset(options = {}) {
    for (const set of Object.values(listeners)) set.clear();
    accounts = [...(options.accounts || [DEFAULT_ACCOUNT])];
    connected = options.connected === true;
    chainId = options.chainId || `0x${BigInt(DEFAULT_CHAIN_ID).toString(16)}`;
    requireAddChain = options.requireAddChain === true;
    emitOnConnect = options.emitOnConnect === true;
    sendAttempts = 0;
    calls = [];
    transactions = [];
    addedChains = [];
    usableChains = new Set(options.usableChains || []);
    if (options.requireAddChain !== true) usableChains.add(chainId);
    failures = new Map();
    gates = new Map();
    hashes = [];
  }

  const controls = Object.freeze({
    DEFAULT_ACCOUNT,
    DEFAULT_CHAIN_ID,
    reset,
    setAccounts,
    setChainId,
    setConnected(value) {
      connected = value === true;
    },
    setRequireAddChain(value) {
      requireAddChain = value === true;
    },
    failNext(method, error = { code: 4001, message: 'User rejected the request.' }) {
      if (!failures.has(method)) failures.set(method, []);
      failures.get(method).push(error);
    },
    queueHash(hash) {
      hashes.push(hash);
    },
    deferNext(method) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      if (!gates.has(method)) gates.set(method, []);
      gates.get(method).push({ promise, release });
    },
    releaseNext(method) {
      const gate = gates.get(method)?.shift();
      if (!gate) throw new Error(`No deferred request for ${method}`);
      gate.release();
    },
    releaseAll() {
      for (const queue of gates.values()) {
        while (queue.length) queue.shift().release();
      }
    },
    clearCalls() {
      calls = [];
    },
    snapshot() {
      return clone({
        accounts,
        connected,
        chainId,
        requireAddChain,
        sendAttempts,
        calls,
        transactions,
        addedChains,
      });
    },
  });

  reset();
  window.__IMF_TEST_WALLET__ = wallet;
  window.__IMF_TEST_WALLET_CONTROLS__ = controls;
})();
