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
  assert.equal(runtime.mode, 'read-only');
  assert.equal(runtime.fixture, undefined);
  assert(runtime.registry, `${surface}: production registry is missing`);
  assert.equal(runtime.rpcUrl, 'https://rpc.testnet.dogeos.com');
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
  ]) {
    assert(!publicText.includes(stale), `${surface}: stale unconfigured production content`);
  }
  for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt', 'assets/imf-social.jpg']) {
    const content = await readFile(path.join(source, file));
    assert(content.length > 0, `${surface}: missing public discovery asset ${file}`);
  }
  const robots = await readFile(path.join(source, 'robots.txt'), 'utf8');
  assert(robots.includes('User-agent: *\nAllow: /'), `${surface}: public crawlers are blocked`);
  assert(robots.includes(`Sitemap: ${origins[surface]}sitemap.xml`), `${surface}: wrong sitemap origin`);

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
