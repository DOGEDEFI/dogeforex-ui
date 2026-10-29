import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { createDiscoverability } from './discoverability.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const review = process.argv.includes('--review');
const fixture = process.argv.includes('--fixture');
if (fixture && !review) throw new Error('Fixture builds require explicit review mode and are never production artifacts');
const outputArg = process.argv.indexOf('--out');
const output = path.resolve(root, outputArg >= 0 ? process.argv[outputArg + 1] : 'dist');
if (output === root || !output.startsWith(`${root}${path.sep}`)) throw new Error('Output must be a child of the frontend root');

function origin(name, port) {
  const value = review ? process.env[name] || `http://127.0.0.1:${port}/` : process.env[name];
  if (!value) throw new Error(`${name} is required for a production build`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} must not contain credentials, query or hash`);
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

function indexerUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('IMF_INDEXER_URL must use HTTPS outside localhost');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('IMF_INDEXER_URL must not contain credentials, query or hash');
  return url.href.replace(/\/$/, '');
}

const origins = {
  website: origin('IMF_WEBSITE_ORIGIN', 5180),
  docs: origin('IMF_DOCS_ORIGIN', 5181),
  app: origin('IMF_APP_ORIGIN', 5182),
};
const TESTNET_CHAIN_ID = '6281971';
const TESTNET_CHAIN = {
  name: 'DogeOS Chikyū Testnet',
  rpcUrl: 'https://rpc.testnet.dogeos.com',
  explorerUrl: 'https://blockscout.testnet.dogeos.com',
  nativeCurrency: { name: 'Test DOGE', symbol: 'tDOGE', decimals: 18 },
};

function validateTestnetRuntime(configuration) {
  if (configuration.mode !== 'testnet-metamask' || configuration.status !== 'configured-testnet-metamask') {
    throw new Error('DogeOS testnet builds require explicit testnet-metamask mode and configured-testnet-metamask status');
  }
  const expectedCodes = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CNY', 'BRL', 'PKR', 'BDT', 'INR', 'NGN', 'CHF'];
  if (!Array.isArray(configuration.registry) || configuration.registry.length !== expectedCodes.length) {
    throw new Error(`The configured public runtime must contain exactly ${expectedCodes.length} V2 registries`);
  }
  configuration.registry.forEach((registry, index) => {
    if (String(registry.chainId) !== TESTNET_CHAIN_ID) throw new Error(`Runtime registry chain ID must be ${TESTNET_CHAIN_ID}`);
    if (registry.network !== 'chikyuV2' || registry.code !== expectedCodes[index]) {
      throw new Error(`Runtime registry ${index + 1} must identify ${expectedCodes[index]} on chikyuV2`);
    }
  });
  if (configuration.rpcUrl !== TESTNET_CHAIN.rpcUrl) throw new Error(`Runtime RPC must be ${TESTNET_CHAIN.rpcUrl}`);
  const chain = configuration.chain;
  if (!chain || chain.name !== TESTNET_CHAIN.name || chain.rpcUrl !== TESTNET_CHAIN.rpcUrl || chain.explorerUrl !== TESTNET_CHAIN.explorerUrl) {
    throw new Error('Static DogeOS chain name, RPC or explorer metadata does not match the approved configuration');
  }
  const native = chain.nativeCurrency;
  if (!native || native.name !== TESTNET_CHAIN.nativeCurrency.name || native.symbol !== TESTNET_CHAIN.nativeCurrency.symbol || native.decimals !== TESTNET_CHAIN.nativeCurrency.decimals) {
    throw new Error('Static DogeOS native currency must be 18-decimal Test DOGE (tDOGE)');
  }
}

const runtimeFile = fixture ? 'config/runtime.fixture.json' : process.env.IMF_RUNTIME_CONFIG || 'config/runtime.json';
const runtimePath = path.resolve(root, runtimeFile);
if (!runtimePath.startsWith(`${root}${path.sep}`)) throw new Error('Runtime configuration must be a child of the frontend root');
const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
if (process.env.IMF_INDEXER_URL) runtime.indexerUrl = process.env.IMF_INDEXER_URL;
if (runtime.indexerUrl !== undefined) {
  if (typeof runtime.indexerUrl !== 'string' || !runtime.indexerUrl) throw new Error('indexerUrl must be a nonempty URL when configured');
  runtime.indexerUrl = indexerUrl(runtime.indexerUrl);
}
if (runtime.protocolVersion !== 2 || !['read-only', 'testnet-metamask'].includes(runtime.mode)) {
  throw new Error('Runtime must explicitly select V2 read-only or testnet-metamask mode');
}
if (runtime.mode === 'testnet-metamask') validateTestnetRuntime(runtime);
if (fixture && (!runtime.fixture || runtime.mode !== 'read-only')) throw new Error('Fixture builds require an explicitly labelled read-only fixture configuration');
if (!fixture && runtime.fixture) throw new Error('Fixture configuration is forbidden in a normal or production build');
if (!review && runtime.mode !== 'testnet-metamask') throw new Error('Production builds require the explicit DogeOS testnet MetaMask runtime');
if (!review && !runtime.registry) throw new Error('Production builds require an explicit verified V2 runtime configuration');
if (runtime.registry && !runtime.rpcUrl) throw new Error('A configured registry requires an explicit public RPC URL');
if (runtime.rpcUrl && !(fixture && runtime.rpcUrl === 'fixture://v2') && !/^https?:\/\//.test(runtime.rpcUrl)) throw new Error('RPC URL must use HTTP(S)');
const currencies = JSON.parse(await readFile(path.join(root, 'assets/currencies.json'), 'utf8'));
if (currencies.length !== 12 || new Set(currencies.map(([code]) => code)).size !== 12) throw new Error('Expected twelve distinct currencies');
const articles = JSON.parse(await readFile(path.join(root, 'assets/articles.json'), 'utf8'));
if (articles.length < 18 || new Set(articles.map((article) => article.id)).size !== articles.length) throw new Error('Expected distinct documentation guides');
const imageDimensions = {};
for (const file of await readdir(path.join(root, 'assets'))) {
  if (!file.endsWith('.png')) continue;
  const data = await readFile(path.join(root, 'assets', file));
  if (data.length < 24 || data[0] !== 137 || data.toString('ascii', 1, 4) !== 'PNG') throw new Error(`Invalid PNG: ${file}`);
  imageDimensions[file] = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
const discoverability = createDiscoverability({ articles, origins, runtime, fixture, review, imageDimensions });

function surfaceLinks(html) {
  return html.replace(/href="([^"]+)"/g, (_, href) => {
    let match;
    if ((match = href.match(/^(?:\.\.\/)?docs\/#([a-z0-9-]+)$/))) return `href="${discoverability.guideURL(match[1])}"`;
    if ((match = href.match(/^(?:\.\.\/)?docs\/(.*)$/))) return `href="${origins.docs}${match[1]}"`;
    if ((match = href.match(/^(?:\.\.\/)?app\/(.*)$/))) return `href="${origins.app}${match[1]}"`;
    if ((match = href.match(/^(?:\.\.\/)?index\.html(#.*)$/))) return `href="${origins.website}${match[1]}"`;
    if (/^(?:\.\.\/?|\.\/?)$/.test(href)) return `href="${origins.website}"`;
    return `href="${href}"`;
  });
}

await rm(output, { recursive: true, force: true });
const surfaces = ['website', 'docs', 'app'];
for (const surface of surfaces) {
  const destination = path.join(output, surface);
  await mkdir(path.join(destination, 'assets'), { recursive: true });
  await cp(path.join(root, 'assets'), path.join(destination, 'assets'), {
    recursive: true,
    filter: (source) => !source.endsWith('.DS_Store'),
  });
  const sourceFile = surface === 'website' ? 'index.html' : `${surface}/index.html`;
  let html = await readFile(path.join(root, sourceFile), 'utf8');
  if (surface !== 'website') html = html.replaceAll('../assets/', '/assets/');
  html = surfaceLinks(html);
  html = html.replaceAll('src="assets/', 'src="/assets/');
  if (!review && runtime.mode === 'testnet-metamask') {
    const replacements = surface === 'website' ? [
      [
        'The app includes read-only V2 tooling, but no verified V2 deployment registry is currently configured. You can model a position, save a draft on this device and export a plan. It does not simulate, sign or broadcast transactions.',
        'The public app verifies 12 independent V2 registries and reads DogeOS Chikyū testnet state. Guided USD actions use current simulation and explicit MetaMask confirmation on chain 6281971; tUSDC and tDOGE are test assets. Planning JSON remains non-executable. Production readiness is not claimed.',
      ],
      [
        'The frontend supports local planning and read-only V2 tooling. Live contract state requires a verified deployment registry. Simulation, wallet signing and agent execution are not connected.',
        'The frontend supports local planning, verified DogeOS Chikyū testnet reads for 12 independent currency systems and USD-guided MetaMask transactions after current simulation and explicit confirmation. DEX and agent execution are not connected.',
      ],
      [
        'Frontend preview; network execution is not connected.',
        'DogeOS Chikyū testnet preview; explicit MetaMask transactions use test assets only. Production readiness is not claimed.',
      ],
    ] : surface === 'docs' ? [
      [
        'Frontend preview; network execution is not connected.',
        'DogeOS Chikyū testnet documentation; guided app transactions require explicit MetaMask confirmation. Test assets only; production readiness is not claimed.',
      ],
    ] : surface === 'app' ? [
      ['Read-only V2 preview · No verified deployment registry configured · No simulation, signing or transaction execution', 'DogeOS Chikyū testnet · Guided USD MetaMask transactions after simulation and explicit confirmation · Test assets only'],
      ['<span class="tag" id="sidebar-connection" hidden>V2 registry not configured</span>', '<span class="tag" id="sidebar-connection" hidden>DogeOS testnet · 12 verified currencies</span>'],
      ['<span class="tag" id="connection-status">Unconfigured</span>', '<span class="tag" id="connection-status">DogeOS testnet · 12 verified currencies</span>'],
      ['No verified V2 deployment registry is configured. You can inspect a V2 registry locally without sending it to a server.', runtime.message],
      ['Read-only preview; no production V2 registry, signing or execution is connected.', 'DogeOS Chikyū testnet preview; explicit MetaMask transactions require current simulation, review and confirmation. tUSDC is a test asset; production readiness is not claimed.'],
      ['<h2>Structured read-only planning intent</h2>', '<h2>Structured non-executable planning intent</h2>'],
    ] : [];
    for (const [before, after] of replacements) {
      if (!html.includes(before)) throw new Error(`${surface}: missing testnet content marker`);
      html = html.replace(before, after);
    }
  }
  html = html.replace(
    /<script src="\/?assets\/shared\.js" defer><\/script>/,
    '<script src="/assets/site-config.js" defer></script><script src="/assets/currencies.js" defer></script><script src="/assets/shared.js" defer></script>',
  );
  if (surface === 'app') html = html.replace(
    /<script src="\/?assets\/app\.js" defer><\/script>/,
    '<script src="/assets/protocol.js" defer></script><script src="/assets/planning.js" defer></script><script src="/assets/offline.js" defer></script><script src="/assets/wallet.js" defer></script><script src="/assets/discovery.js" defer></script><script src="/assets/read-cache.js" defer></script><script src="/assets/v2.js" defer></script><script src="/assets/dashboard.js" defer></script><script src="/assets/actions.js" defer></script><script src="/assets/app.js" defer></script>',
  );
  html = html.replace('</head>', '<noscript><style>.menu,.sidebar-toggle{display:none!important}#doc-search,label[for="doc-search"]{display:none}@media(max-width:700px){.navlinks{display:flex!important}}</style></noscript></head>');
  const docsTemplate = surface === 'docs' ? html : null;
  if (surface === 'docs') {
    html = html.replace('<!--DOC_NAV-->', discoverability.guideNavigation());
    html = html.replace(/<article class="doc" id="article">[\s\S]*?<\/article>/, discoverability.documentationHome());
  }
  const titles = {
    website: 'International Multicurrency Framework (IMF) on DogeOS',
    docs: 'IMF Documentation | Independent Currency Systems',
    app: discoverability.mode === 'testnet' ? 'IMF Workspace | DogeOS Testnet V2 & MetaMask' : 'IMF Workspace | V2 Position Planning',
  };
  const descriptions = {
    website: 'Use project tokens as collateral to mint currencies on DogeOS. IMF extends Frankencoin mechanics with one independent system per currency.',
    docs: 'Technical guides to project-token collateral, independent currency systems, V2 positions, non-executable planning and explicit DogeOS testnet workflows.',
    app: discoverability.mode === 'testnet'
      ? 'Inspect 12 verified V2 systems on DogeOS Chikyū testnet and prepare guided USD MetaMask transactions after current simulation and explicit review. Test assets only; production readiness is not claimed.'
      : 'Prepare non-executable project-collateral position plans with exact decimal-aware inputs and optional read-only V2 registry inspection. No signing or execution in this review.',
  };
  html = discoverability.metadata(html, { surface, canonical: origins[surface], title: titles[surface], description: descriptions[surface], type: surface === 'docs' ? 'CollectionPage' : 'WebPage' });
  html = discoverability.responsiveImages(html);
  await writeFile(path.join(destination, 'index.html'), html);
  if (surface === 'docs') {
    for (const guide of articles) {
      let guidePage = docsTemplate.replace('<!--DOC_NAV-->', discoverability.guideNavigation(guide.id));
      guidePage = guidePage.replace(/<article class="doc" id="article">[\s\S]*?<\/article>/, discoverability.documentationGuide(guide));
      guidePage = discoverability.metadata(guidePage, {
        surface: 'docs',
        canonical: discoverability.guideURL(guide.id),
        title: `${guide.label} | IMF documentation`,
        description: guide.intro,
        type: 'TechArticle',
        guide,
      });
      guidePage = discoverability.responsiveImages(guidePage);
      const guideDirectory = path.join(destination, 'guides', guide.id);
      await mkdir(guideDirectory, { recursive: true });
      await writeFile(path.join(guideDirectory, 'index.html'), guidePage);
    }
  }
  await writeFile(path.join(destination, 'assets/articles.json'), `${JSON.stringify(articles.map((guide) => ({ ...guide, html: discoverability.guideContent(guide.html) })), null, 2)}\n`);
  await writeFile(path.join(destination, 'robots.txt'), discoverability.robots(surface));
  await writeFile(path.join(destination, 'sitemap.xml'), discoverability.sitemap(surface));
  await writeFile(path.join(destination, 'llms.txt'), discoverability.llms(surface));
  await writeFile(path.join(destination, 'assets/site-config.js'), `window.IMF_SITE=${JSON.stringify({ surface, origins, review, releaseStatus: discoverability.releaseStatus })};\n`);
  await writeFile(path.join(destination, 'assets/currencies.js'), `window.IMF_CURRENCIES=${JSON.stringify(currencies.map(([code, name]) => ({ code, name, symbol: `K9${code}` })))};\n`);
  await writeFile(path.join(destination, 'assets/runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`);
}

await bundle({
  entryPoints: [path.join(root, fixture ? 'src/browser-fixture.ts' : 'src/browser.ts')],
  outfile: path.join(output, 'app/assets/protocol.js'),
  bundle: true,
  format: 'iife',
  globalName: 'IMF_V2',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: review,
  logLevel: 'warning',
});

console.log(JSON.stringify({ mode: review ? 'review' : 'production', output, origins, registryConfigured: Boolean(runtime.registry) }, null, 2));
