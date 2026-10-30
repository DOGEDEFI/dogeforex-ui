import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [bridge, loader, wallet, runtime, build] = await Promise.all([
  readFile('src/dogeos-wallet.tsx', 'utf8'),
  readFile('assets/dogeos.js', 'utf8'),
  readFile('assets/wallet.js', 'utf8'),
  readFile('config/runtime.testnet.json', 'utf8').then(JSON.parse),
  readFile('scripts/build.mjs', 'utf8'),
]);

assert(/^[A-Za-z0-9]{64,128}$/.test(runtime.dogeos.clientId));
assert.equal(runtime.dogeos.metadata.url, 'https://app.imf.li/');
assert(bridge.includes("basicLogins: ['externalWallets']"));
assert(bridge.includes('socialLogins: []'));
assert(bridge.includes('ChainTypeEnum.EVM'));
assert(!bridge.includes('signMessage('));
assert(!bridge.includes('signInWithWallet('));
assert(!bridge.includes('getDogeOSAuth('));
assert(bridge.includes("connectors?.evm"));
assert(!loader.includes('dogeos-wallet.js" defer'));
assert(loader.includes("button.addEventListener('click', loadWallet)"));
assert(loader.includes("script.async = true"));
assert(wallet.includes('function registerProvider(nextProvider'));
assert(wallet.includes('externalProvider = nextProvider'));
assert(wallet.includes("invalidate(`${label} provider changed. Any unsent preparation was cleared.`)"));
assert(build.includes("entryPoints: [path.join(root, 'src/dogeos-wallet.tsx')]"));
assert(build.includes("if (runtime.dogeos?.clientId) await bundle"));
assert(!build.includes("entryPoints: [path.join(root, 'src/dogeos-wallet.tsx')],\n  outfile: path.join(output, 'website"));

console.log('PASS: DogeOS SDK is external-EVM-only, message-signing-free, production-scoped, provider-bound and lazy-loaded');
