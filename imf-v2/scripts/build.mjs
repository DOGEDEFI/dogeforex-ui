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

const origins = {
  website: origin('IMF_WEBSITE_ORIGIN', 5180),
  docs: origin('IMF_DOCS_ORIGIN', 5181),
  app: origin('IMF_APP_ORIGIN', 5182),
};
const runtimeFile = fixture ? 'config/runtime.fixture.json' : process.env.IMF_RUNTIME_CONFIG || 'config/runtime.json';
const runtimePath = path.resolve(root, runtimeFile);
if (!runtimePath.startsWith(`${root}${path.sep}`)) throw new Error('Runtime configuration must be a child of the frontend root');
const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
if (runtime.protocolVersion !== 2 || runtime.mode !== 'read-only') throw new Error('Runtime must explicitly select V2 read-only mode');
if (fixture && !runtime.fixture) throw new Error('Fixture build requires explicitly labelled fixture configuration');
if (!fixture && runtime.fixture) throw new Error('Fixture configuration is forbidden in a normal or production build');
if (!review && !runtime.registry) throw new Error('Production builds require an explicit verified V2 runtime configuration');
if (runtime.registry && !runtime.rpcUrl) throw new Error('A configured registry requires an explicit public RPC URL');
if (runtime.rpcUrl && !(fixture && runtime.rpcUrl === 'fixture://v2') && !/^https?:\/\//.test(runtime.rpcUrl)) throw new Error('RPC URL must use HTTP(S)');
const currencies = JSON.parse(await readFile(path.join(root, 'assets/currencies.json'), 'utf8'));
if (currencies.length !== 11 || new Set(currencies.map(([code]) => code)).size !== 11) throw new Error('Expected eleven distinct currencies');
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
  if (!review && runtime.status === 'configured-testnet-read-only') {
    const replacements = surface === 'website' ? [
      [
        'The app includes read-only V2 tooling, but no verified V2 deployment registry is currently configured. You can model a position, save a draft on this device and export a plan. It does not simulate, sign or broadcast transactions.',
        'The public app is configured for read-only DogeOS Chikyū testnet state and verifies the USD V2 registry, chain ID, bytecode and contract links in your browser. tUSDC is a test asset. You can model a position, save a draft and export a plan. The app does not simulate, sign or broadcast transactions.',
      ],
    ] : surface === 'app' ? [
      ['Read-only V2 preview · No verified deployment registry configured · No simulation, signing or transaction execution', 'DogeOS Chikyū testnet · Read-only V2 · No simulation, signing or transaction execution'],
      ['<span class="tag" id="sidebar-connection">V2 registry not configured</span>', '<span class="tag" id="sidebar-connection">DogeOS testnet · V2 read-only</span>'],
      ['<span class="tag" id="connection-status">Unconfigured</span>', '<span class="tag" id="connection-status">Testnet registry configured</span>'],
      ['No verified V2 deployment registry is configured. You can inspect a V2 registry locally without sending it to a server.', runtime.message],
      ['Read-only preview; no production V2 registry, signing or execution is connected.', 'Read-only testnet preview; tUSDC is not production USDC. Signing and execution are not connected.'],
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
    '<script src="/assets/protocol.js" defer></script><script src="/assets/planning.js" defer></script><script src="/assets/offline.js" defer></script><script src="/assets/v2.js" defer></script><script src="/assets/app.js" defer></script>',
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
    app: 'IMF Workspace | Read-only V2 Position Planning',
  };
  const descriptions = {
    website: 'Use project tokens as collateral to mint currencies on DogeOS. IMF extends Frankencoin mechanics with one independent system per currency.',
    docs: 'Technical guides to project-token collateral, independent currency systems, Frankencoin mechanics, V2 positions and read-only IMF workflows.',
    app: discoverability.mode === 'testnet'
      ? 'Inspect the verified USD V2 registry and DogeOS Chikyū testnet state, or prepare project-collateral plans. Read-only: no signing or execution.'
      : 'Prepare project-collateral position plans with exact decimal-aware inputs and optional read-only V2 registry inspection. No signing or execution.',
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
