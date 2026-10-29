(() => {
  'use strict';

  const CHUNK_SIZE = 10000;
  const MAX_CHUNKS = 100;
  const CACHE_KIND = 'discovery';
  const CACHE_KEY = 'events';
  const MAX_CACHED_EVENTS = 2000;
  const MAX_CACHED_ADDRESSES = 5000;

  async function logs(provider, address, topic, fromBlock, toBlock) {
    const result = [];
    const chunks = Math.ceil((toBlock - fromBlock + 1) / CHUNK_SIZE);
    if (chunks > MAX_CHUNKS) throw new Error(`Discovery needs ${chunks} block-range requests; reconnect later or use a position address manually`);
    for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, toBlock);
      const entries = await provider.getLogs({ address, fromBlock: start, toBlock: end, topics: [topic] });
      result.push(...entries);
    }
    return result;
  }

  function readCacheApi() {
    return window.IMF_READ_CACHE ?? null;
  }

  function sharedCache() {
    const api = readCacheApi();
    return api?.shared?.() ?? null;
  }

  function eventKey(event) {
    return `${event.type}|${event.transactionHash}|${event.logIndex}`;
  }

  function decodePositionEvent(contract, entry) {
    const decoded = contract.interface.parseLog(entry);
    return {
      type: 'position-opened',
      label: 'Position opened',
      summary: `Position ${decoded.args.position} opened by ${decoded.args.owner}`,
      position: decoded.args.position,
      owner: decoded.args.owner,
      transactionHash: entry.transactionHash,
      blockNumber: entry.blockNumber,
      logIndex: entry.logIndex,
    };
  }

  function decodeChallengeEvent(contract, entry) {
    const decoded = contract.interface.parseLog(entry);
    return {
      type: 'challenge-started',
      label: 'Challenge started',
      summary: `Challenge ${decoded.args.number.toString()} opened for position ${decoded.args.position}`,
      position: decoded.args.position,
      index: decoded.args.number.toString(),
      transactionHash: entry.transactionHash,
      blockNumber: entry.blockNumber,
      logIndex: entry.logIndex,
    };
  }

  function normalizeBlock(raw) {
    if (!raw || !Number.isSafeInteger(raw.number)) return null;
    return {
      number: raw.number,
      hash: typeof raw.hash === 'string' ? raw.hash : null,
      timestamp: raw.timestamp === undefined || raw.timestamp === null ? null : String(raw.timestamp),
    };
  }

  // Cached resume is opt-in via options.resume so the original full-range API
  // stays the default. Only the decoded event history is ever cached; every
  // position and challenge state is re-read from the chain on each call, so a
  // refresh always reflects current state. Without a cache, or on any cache
  // miss/mismatch, this falls back to the original full-range discovery.
  async function discover(state, client, account, options = {}) {
    if (state.fixture) return { positions: [], challenges: [], events: [], complete: true, synthetic: true, warnings: ['Synthetic fixture: no deployed event history is represented.'] };
    const deployment = client.instance.transactions?.deployments?.MintingHub;
    if (!deployment) throw new Error('The registry has no MintingHub deployment transaction; enter a position or challenge index manually');
    const code = client.instance.code;
    const cache = options.resume ? (options.cache ?? sharedCache()) : null;
    const [receipt, latest] = await Promise.all([state.provider.getTransactionReceipt(deployment), state.provider.getBlockNumber()]);
    if (!receipt) throw new Error('The MintingHub deployment receipt is unavailable; discovery cannot choose a safe starting block');
    const hub = client.instance.mintingHub;
    const contract = client.mintingHub;
    const positionEvent = contract.interface.getEvent('PositionOpened');
    const challengeEvent = contract.interface.getEvent('ChallengeStarted');

    let cached = null;
    if (cache) {
      try {
        const hit = cache.get(CACHE_KIND, CACHE_KEY, code);
        if (hit.status === 'hit'
          && hit.coverage
          && Number.isSafeInteger(hit.coverage.toBlock)
          && hit.value
          && Array.isArray(hit.value.events)
          && Array.isArray(hit.value.positionAddresses)
          && hit.coverage.toBlock >= receipt.blockNumber) {
          cached = hit;
        }
      } catch {
        cached = null;
      }
    }
    const resumeFrom = cached ? Math.max(Number(cached.coverage.toBlock) + 1, receipt.blockNumber) : receipt.blockNumber;
    let positionLogs = [];
    let challengeLogs = [];
    let sourceBlock = null;
    try {
      const positionPromise = resumeFrom <= latest ? logs(state.provider, hub, positionEvent.topicHash, resumeFrom, latest) : Promise.resolve([]);
      const challengePromise = resumeFrom <= latest ? logs(state.provider, hub, challengeEvent.topicHash, resumeFrom, latest) : Promise.resolve([]);
      const blockPromise = state.provider.getBlock(latest).catch(() => null);
      const settled = await Promise.all([positionPromise, challengePromise, blockPromise]);
      positionLogs = settled[0];
      challengeLogs = settled[1];
      sourceBlock = normalizeBlock(settled[2]);
    } catch (cause) {
      cache?.setError(CACHE_KIND, CACHE_KEY, code, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }

    const merged = new Map();
    if (cached) for (const event of cached.value.events) merged.set(eventKey(event), event);
    for (const entry of positionLogs) {
      const event = decodePositionEvent(contract, entry);
      merged.set(eventKey(event), event);
    }
    for (const entry of challengeLogs) {
      const event = decodeChallengeEvent(contract, entry);
      merged.set(eventKey(event), event);
    }
    let events = [...merged.values()].sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex);

    // Union of cached and freshly scanned position addresses, chronological
    // first-seen order, so the most-recent-100 behavior matches full scans.
    const freshAddresses = [...new Set(positionLogs.map((entry) => contract.interface.parseLog(entry).args.position))];
    const addressOrder = new Map();
    if (cached) for (const address of cached.value.positionAddresses) addressOrder.set(address, true);
    for (const address of freshAddresses) addressOrder.set(address, true);
    const addresses = [...addressOrder.keys()];

    const cachedCreations = new Map(Object.entries(cached?.value.positionCreations ?? {}));
    const creations = new Map(cachedCreations);
    for (const entry of positionLogs) {
      const decoded = contract.interface.parseLog(entry);
      creations.set(decoded.args.position, { owner: decoded.args.owner, transactionHash: entry.transactionHash });
    }

    const challengeOrder = new Map();
    if (cached) {
      for (const event of cached.value.events) {
        if (event.type === 'challenge-started') {
          challengeOrder.set(event.index, { index: event.index, transactionHash: event.transactionHash, blockNumber: event.blockNumber, logIndex: event.logIndex });
        }
      }
    }
    for (const entry of challengeLogs) {
      const decoded = contract.interface.parseLog(entry);
      challengeOrder.set(decoded.args.number.toString(), {
        index: decoded.args.number.toString(),
        transactionHash: entry.transactionHash,
        blockNumber: entry.blockNumber,
        logIndex: entry.logIndex,
      });
    }

    let capped = false;
    if (cache && addresses.length > MAX_CACHED_ADDRESSES) capped = true;
    const scannedAddresses = addresses.length > MAX_CACHED_ADDRESSES ? addresses.slice(-MAX_CACHED_ADDRESSES) : addresses;
    const warnings = [];
    if (addresses.length > 100) warnings.push(`Showing the 100 most recent of ${addresses.length} discovered positions; use the address for an older position.`);
    const positions = [];
    for (const candidate of scannedAddresses.slice(-100).reverse()) {
      try {
        const position = await client.positionState(candidate);
        if (!position.hubMatchesRegistry || !position.tokenMatchesRegistry) continue;
        const creation = creations.get(candidate);
        if (!creation) continue;
        positions.push({ ...position, createdBy: creation.owner, transactionHash: creation.transactionHash });
      } catch (error) {
        warnings.push(`${candidate}: ${error.message}`);
      }
    }
    const challenges = [];
    const challengeRecords = [...challengeOrder.values()].sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex).slice(0, 100);
    for (const record of challengeRecords) {
      try {
        const challenge = await client.challengeSnapshot(BigInt(record.index));
        const position = positions.find((item) => item.address === challenge.position) ?? await client.positionState(challenge.position);
        if (!position.hubMatchesRegistry || !position.tokenMatchesRegistry) continue;
        challenges.push({ ...challenge, positionState: position, transactionHash: record.transactionHash, settled: challenge.empty });
      } catch (error) {
        warnings.push(`Challenge log ${record.transactionHash}: ${error.message}`);
      }
    }

    if (cache && events.length > MAX_CACHED_EVENTS) capped = true;
    const storedEvents = events.length > MAX_CACHED_EVENTS ? events.slice(0, MAX_CACHED_EVENTS) : events;
    const storedAddresses = scannedAddresses;
    const storedCreations = Object.fromEntries([...creations.entries()].filter(([address]) => storedAddresses.includes(address)));
    const complete = !capped;
    const coverage = {
      complete,
      fromBlock: receipt.blockNumber,
      toBlock: latest,
      resumed: Boolean(cached),
      cache: cache ? (cached ? 'hit' : 'miss') : 'disabled',
      events: events.length,
    };
    if (cache) {
      try {
        cache.set(CACHE_KIND, CACHE_KEY, code, { events: storedEvents, positionAddresses: storedAddresses, positionCreations: storedCreations }, { sourceBlock, coverage });
      } catch {
        warnings.push('Discovery completed but the local read cache could not be updated; the next refresh will rescan.');
      }
    }
    if (capped) warnings.push(`Discovery history exceeds the local cache caps (${MAX_CACHED_EVENTS} events, ${MAX_CACHED_ADDRESSES} position addresses); older history is not represented in cached resume. Use a position address for older state.`);
    return {
      positions,
      challenges,
      events,
      account,
      fromBlock: receipt.blockNumber,
      toBlock: latest,
      complete,
      synthetic: false,
      coverage,
      sourceBlock,
      fetchedAt: Date.now(),
      warnings,
    };
  }

  // Invalidate cached discovery by currency, or the whole active identity when
  // no code is given. Returns false when no shared cache is configured.
  function invalidate(code = null) {
    const cache = sharedCache();
    if (!cache) return false;
    if (code) cache.invalidateCurrency(code);
    else cache.invalidateIdentity();
    return true;
  }

  // Post-receipt-compatible hook the parent calls after any confirmed
  // transaction receipt; pre-receipt cached discovery stops being served.
  function onReceipt(receipt = {}) {
    const cache = sharedCache();
    if (!cache) return false;
    cache.onReceipt(receipt);
    return true;
  }

  window.IMF_DISCOVERY = { discover, invalidate, onReceipt };
})();
