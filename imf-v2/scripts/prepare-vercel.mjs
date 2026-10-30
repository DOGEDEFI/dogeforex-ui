import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = path.join(root, '.production-dist');
const outputRoot = path.join(root, '.vercel-output');
const origins = {
  website: 'https://imf.li/',
  docs: 'https://docs.imf.li/',
  app: 'https://app.imf.li/',
};
const redirectHosts = [
  'www.imf.li',
  'doge.forex',
  'www.doge.forex',
  'international-multicurrency-framework.com',
  'www.international-multicurrency-framework.com',
];

for (const surface of ['website', 'docs', 'app']) {
  const source = path.join(sourceRoot, surface);
  const project = path.join(outputRoot, surface);
  const output = path.join(project, '.vercel', 'output');
  await rm(output, { recursive: true, force: true });
  const siteConfigText = await readFile(path.join(source, 'assets', 'site-config.js'), 'utf8');
  const match = siteConfigText.match(/^window\.IMF_SITE=(.*);$/m);
  assert(match, `${surface}: missing site configuration`);
  const siteConfig = JSON.parse(match[1]);
  assert.equal(siteConfig.review, false, `${surface}: review output cannot be deployed`);
  assert.deepEqual(siteConfig.origins, origins, `${surface}: unexpected public origins`);
  const runtime = JSON.parse(await readFile(path.join(source, 'assets', 'runtime.json'), 'utf8'));
  assert.equal(runtime.protocolVersion, 2);
  assert.equal(runtime.mode, 'testnet-metamask', `${surface}: production requires explicit testnet-metamask mode`);
  assert.equal(runtime.status, 'configured-testnet-metamask', `${surface}: stale or unconfigured production status`);
  assert.equal(runtime.fixture, undefined, `${surface}: fixture runtime cannot be deployed`);
  assert(Array.isArray(runtime.registry), `${surface}: production registry array is missing`);
  const expectedCodes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CNY', 'BRL', 'PKR', 'BDT', 'INR', 'NGN', 'CHF'];
  assert.equal(runtime.registry.length, expectedCodes.length, `${surface}: expected all approved registries`);
  runtime.registry.forEach((registry, index) => {
    assert.equal(String(registry.chainId), '6281971', `${surface}: registry chain ID mismatch`);
    assert.equal(registry.network, 'chikyuV2', `${surface}: registry network mismatch`);
    assert.equal(registry.code, expectedCodes[index], `${surface}: unexpected registry or ordering`);
  });
  assert.equal(runtime.rpcUrl, 'https://rpc.testnet.dogeos.com');
  if (runtime.indexerUrl !== undefined) {
    const indexer = new URL(runtime.indexerUrl);
    assert.equal(indexer.protocol, 'https:', `${surface}: public indexer must use HTTPS`);
    assert(!indexer.username && !indexer.password && !indexer.search && !indexer.hash, `${surface}: indexer URL must not contain credentials, query or hash`);
  }
  assert.deepEqual(runtime.chain, {
    name: 'DogeOS Chikyū Testnet',
    rpcUrl: 'https://rpc.testnet.dogeos.com',
    explorerUrl: 'https://blockscout.testnet.dogeos.com',
    nativeCurrency: { name: 'Test DOGE', symbol: 'tDOGE', decimals: 18 },
  }, `${surface}: static DogeOS chain metadata mismatch`);
  assert.equal(runtime.chain.rpcUrl, runtime.rpcUrl, `${surface}: registry RPC and wallet chain RPC differ`);
  const guideFiles = surface === 'docs'
    ? (await readdir(path.join(source, 'guides'), { recursive: true })).filter((file) => file.endsWith('.html')).map((file) => path.join(source, 'guides', file))
    : [];
  let publicText = await readFile(path.join(source, 'index.html'), 'utf8') + await readFile(path.join(source, 'assets', 'articles.json'), 'utf8');
  for (const file of guideFiles) publicText += await readFile(file, 'utf8');
  for (const stale of [
    'No verified deployment registry configured',
    'no verified V2 deployment registry is currently configured',
    'No verified V2 registry is configured in this release',
    'no live V2 deployment registry is configured',
    'No live V2 registry is configured',
    'No such live registry is configured',
    'no configured live V2 registry',
    'No current V2 deployment registry is configured',
    'No production source asset or live bridge registry is configured',
    'Read-only V2 preview',
    'read-only V2 tooling',
    'network execution is not connected',
    'No simulation, signing or transaction execution',
    'no production V2 registry, signing or execution is connected',
    'This frontend does not do so',
    'The frontend is read-only',
  ]) {
    assert(!publicText.includes(stale), `${surface}: stale production content: ${stale}`);
  }
  assert(publicText.includes('MetaMask'), `${surface}: explicit MetaMask transaction disclosure is missing`);
  assert(publicText.includes('tUSDC'), `${surface}: test-asset disclosure is missing`);
  assert(publicText.toLowerCase().includes('production readiness is not claimed'), `${surface}: production readiness boundary is missing`);
  for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt', 'assets/imf-social.jpg']) {
    const content = await readFile(path.join(source, file));
    assert(content.length > 0, `${surface}: missing public discovery asset ${file}`);
  }
  const robots = await readFile(path.join(source, 'robots.txt'), 'utf8');
  assert(robots.includes('User-agent: *\nAllow: /'), `${surface}: public crawlers are blocked`);
  assert(robots.includes(`Sitemap: ${origins[surface]}sitemap.xml`), `${surface}: wrong sitemap origin`);

  const sourceFiles = await readdir(source, { recursive: true });
  assert(!sourceFiles.some((file) => file.endsWith('.map')), `${surface}: source maps are not allowed in production`);
  for (const forbidden of ['runtime.fixture.json', 'mock-eip1193.mjs', 'browser-fixture.ts', 'browser-fixture.js']) {
    assert(!sourceFiles.some((file) => path.basename(file) === forbidden), `${surface}: test-only file is not allowed: ${forbidden}`);
  }
  if (surface === 'app') {
    const protocol = await readFile(path.join(source, 'assets/protocol.js'), 'utf8');
    for (const marker of ['__IMF_TEST_WALLET__', 'createFixtureProvider', 'fixtureControls', '__IMF_TEST_DECORATE_PROVIDER__', 'fixture://v2']) {
      assert(!protocol.includes(marker), `${surface}: test implementation ${marker} is not allowed in the production SDK bundle`);
    }
    const wallet = await readFile(path.join(source, 'assets/wallet.js'), 'utf8');
    assert(wallet.includes("policy.writeMode === 'mock-only' ? window.__IMF_TEST_WALLET__ : (externalProvider || window.ethereum)"), `${surface}: production wallet must use a registered EIP-1193 provider or window.ethereum outside the explicit mock policy`);
    const dogeOsBridge = await readFile(path.join(source, 'assets/dogeos.js'), 'utf8');
    const appHtml = await readFile(path.join(source, 'index.html'), 'utf8');
    assert(!appHtml.includes('src="/assets/dogeos-wallet.js"'), `${surface}: DogeOS SDK must not be eager-loaded`);
    assert(dogeOsBridge.includes("button.addEventListener('click', loadWallet)"), `${surface}: DogeOS SDK must load only after explicit wallet connection`);
    const actions = await readFile(path.join(source, 'assets/actions.js'), 'utf8');
    if (actions.includes('__IMF_TEST_DECORATE_PROVIDER__')) {
      assert(actions.includes('v2.state.fixture && window.__IMF_TEST_DECORATE_PROVIDER__'), `${surface}: test provider decoration must be gated by the synthetic fixture`);
    }
    const reads = await readFile(path.join(source, 'assets/v2.js'), 'utf8');
    assert(reads.includes('state.fixture ? sdk.createFixtureProvider() : new sdk.JsonRpcProvider'), `${surface}: production reads must not fall back to the fixture provider`);
    assert(reads.includes("state.fixture ? 'fixture://v2' : rpcUrl(rpc)"), `${surface}: fixture RPC must be confined to the explicit synthetic branch`);
  }

  const staticOutput = path.join(output, 'static');
  await mkdir(staticOutput, { recursive: true });
  await cp(source, staticOutput, {
    recursive: true,
    filter: (file) => !file.endsWith('.DS_Store'),
  });
  const files = await readdir(staticOutput, { recursive: true });
  assert(!files.some((file) => file.endsWith('.map')), `${surface}: source maps are not allowed in production`);

  const routes = surface === 'website'
    ? redirectHosts.map((host) => ({
        src: '^/(.*)$',
        has: [{ type: 'host', value: { eq: host } }],
        status: 308,
        headers: { Location: 'https://imf.li/$1' },
      }))
    : [];
  if (surface === 'docs') routes.push({ src: '^/guides/([a-z0-9-]+)$', status: 308, headers: { Location: '/guides/$1/' } });
  routes.push({ src: '^/index\\.html$', status: 308, headers: { Location: '/' } });
  const overrides = {
    'robots.txt': { contentType: 'text/plain; charset=utf-8' },
    'llms.txt': { contentType: 'text/plain; charset=utf-8' },
    'sitemap.xml': { contentType: 'application/xml; charset=utf-8' },
  };
  await writeFile(path.join(output, 'config.json'), `${JSON.stringify({ version: 3, routes, overrides }, null, 2)}\n`);
  console.log(JSON.stringify({ surface, project, files: files.length, redirectHosts: surface === 'website' ? redirectHosts : [] }));
}
