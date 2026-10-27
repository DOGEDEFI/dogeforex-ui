import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const owned = [];
const environment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'CHROME_PATH'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));

async function available(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer(directory, portBase) {
  const url = `http://127.0.0.1:${portBase}/`;
  if (await available(url)) return;
  const child = spawn('python3', ['scripts/serve.py', '--root', directory, '--port-base', String(portBase)], { cwd: root, env: environment, stdio: 'inherit' });
  owned.push(child);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await available(url)) return;
    if (child.exitCode !== null) throw new Error(`Preview server exited with ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not become ready at ${url}`);
}

async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Browser check failed: ${args.join(' ')} (${code ?? signal})`);
}

try {
  for (const directory of ['dist', '.fixture-dist']) {
    for (const surface of ['website', 'docs', 'app']) {
      if (!fs.existsSync(path.join(root, directory, surface, 'index.html'))) throw new Error(`Missing ${directory}/${surface}/index.html; run the frontend builds first`);
    }
  }
  await ensureServer('dist', 5180);
  await ensureServer('.fixture-dist', 5190);
  await run(['scripts/browser-check.mjs']);
  await run(['scripts/browser-check.mjs', '--default']);
} finally {
  for (const child of owned.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
}
