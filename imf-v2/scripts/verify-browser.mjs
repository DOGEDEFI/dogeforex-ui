import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const owned = [];
const environment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'CHROME_PATH'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));

async function available(url) {
  try {
    return await new Promise((resolve, reject) => {
      const request = httpGet(url, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('error', reject);
      request.setTimeout(5000, () => request.destroy(new Error(`Preview health check timed out at ${url}`)));
    });
  } catch {
    return false;
  }
}

async function bindable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function freePortBase(preferred) {
  for (let candidate = preferred; candidate < preferred + 100; candidate += 10) {
    if (await Promise.all([bindable(candidate), bindable(candidate + 1), bindable(candidate + 2)]).then((results) => results.every(Boolean))) return candidate;
  }
  throw new Error(`No free three-port preview range near ${preferred}`);
}

async function ensureServer(directory, preferred) {
  if (await available(`http://127.0.0.1:${preferred}/`)) return preferred;
  const portBase = await freePortBase(preferred);
  const url = `http://127.0.0.1:${portBase}/`;
  const child = spawn('python3', ['scripts/serve.py', '--root', directory, '--port-base', String(portBase)], { cwd: root, env: environment, stdio: 'inherit' });
  owned.push(child);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await available(url)) return portBase;
    if (child.exitCode !== null) throw new Error(`Preview server exited with ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not become ready at ${url}`);
}

let ports = { review: 5180, fixture: 5190 };
async function run(args) {
  const env = {
    ...environment,
    IMF_REVIEW_PORT_BASE: String(ports.review),
    IMF_FIXTURE_PORT_BASE: String(ports.fixture),
    IMF_FIXTURE_APP_URL: `http://127.0.0.1:${ports.fixture + 2}/`,
  };
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Browser check failed: ${args.join(' ')} (${code ?? signal})`);
}

async function buildPreview(directory, portBase, fixture) {
  const env = {
    ...environment,
    IMF_WEBSITE_ORIGIN: `http://127.0.0.1:${portBase}/`,
    IMF_DOCS_ORIGIN: `http://127.0.0.1:${portBase + 1}/`,
    IMF_APP_ORIGIN: `http://127.0.0.1:${portBase + 2}/`,
  };
  const args = ['scripts/build.mjs', '--review', ...(fixture ? ['--fixture', '--out', directory] : [])];
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Preview build failed for ${directory} (${code ?? signal})`);
}

try {
  for (const directory of ['dist', '.fixture-dist']) {
    for (const surface of ['website', 'docs', 'app']) {
      if (!fs.existsSync(path.join(root, directory, surface, 'index.html'))) throw new Error(`Missing ${directory}/${surface}/index.html; run the frontend builds first`);
    }
  }
  ports = { review: await ensureServer('dist', 5180), fixture: 5190 };
  ports.fixture = await ensureServer('.fixture-dist', ports.review >= 5190 ? ports.review + 10 : 5190);
  await buildPreview('dist', ports.review, false);
  await buildPreview('.fixture-dist', ports.fixture, true);
  await run(['scripts/browser-check.mjs']);
  await run(['scripts/browser-check.mjs', '--default']);
  await run(['scripts/wallet-check.mjs']);
  await run(['scripts/journey-check.mjs']);
} finally {
  for (const child of owned.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
}
