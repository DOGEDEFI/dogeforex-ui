(() => {
  'use strict';

  const CHUNK_SIZE = 10000;
  const MAX_CHUNKS = 100;

  function rawRegistry(state) {
    return state.rawRegistry?.linkedData ?? state.rawRegistry ?? null;
  }

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

  async function discover(state, client, account) {
    if (state.fixture) return { positions: [], challenges: [], events: [], complete: true, synthetic: true, warnings: ['Synthetic fixture: no deployed event history is represented.'] };
    const registry = rawRegistry(state);
    const deployment = registry?.transactions?.deployments?.MintingHub;
    if (!deployment) throw new Error('The registry has no MintingHub deployment transaction; enter a position or challenge index manually');
    const [receipt, latest] = await Promise.all([state.provider.getTransactionReceipt(deployment), state.provider.getBlockNumber()]);
    if (!receipt) throw new Error('The MintingHub deployment receipt is unavailable; discovery cannot choose a safe starting block');
    const hub = client.instance.mintingHub;
    const contract = client.mintingHub;
    const positionEvent = contract.interface.getEvent('PositionOpened');
    const challengeEvent = contract.interface.getEvent('ChallengeStarted');
    const [positionLogs, challengeLogs] = await Promise.all([
      logs(state.provider, hub, positionEvent.topicHash, receipt.blockNumber, latest),
      logs(state.provider, hub, challengeEvent.topicHash, receipt.blockNumber, latest),
    ]);
    const positions = [];
    const warnings = [];
    const addresses = [...new Set(positionLogs.map((entry) => contract.interface.parseLog(entry).args.position))];
    if (addresses.length > 100) warnings.push(`Showing the 100 most recent of ${addresses.length} discovered positions; use the address for an older position.`);
    for (const candidate of addresses.slice(-100).reverse()) {
      try {
        const position = await client.positionState(candidate);
        if (!position.hubMatchesRegistry || !position.tokenMatchesRegistry) continue;
        const creation = positionLogs.find((entry) => contract.interface.parseLog(entry).args.position === candidate);
        positions.push({ ...position, createdBy: contract.interface.parseLog(creation).args.owner, transactionHash: creation.transactionHash });
      } catch (error) {
        warnings.push(`${candidate}: ${error.message}`);
      }
    }
    const challenges = [];
    for (const entry of challengeLogs.slice(-100).reverse()) {
      try {
        const decoded = contract.interface.parseLog(entry);
        const index = decoded.args.number;
        const challenge = await client.challengeSnapshot(index);
        const position = positions.find((item) => item.address === challenge.position) ?? await client.positionState(challenge.position);
        if (!position.hubMatchesRegistry || !position.tokenMatchesRegistry) continue;
        challenges.push({ ...challenge, positionState: position, transactionHash: entry.transactionHash, settled: challenge.empty });
      } catch (error) {
        warnings.push(`Challenge log ${entry.transactionHash}: ${error.message}`);
      }
    }
    const events = [
      ...positionLogs.map((entry) => {
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
      }),
      ...challengeLogs.map((entry) => {
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
      }),
    ].sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex);
    return {
      positions,
      challenges,
      events,
      account,
      fromBlock: receipt.blockNumber,
      toBlock: latest,
      complete: true,
      synthetic: false,
      warnings,
    };
  }

  window.IMF_DISCOVERY = { discover };
})();
