# International Multicurrency Framework — V2 frontend

An isolated import and adaptation of `../../../dogeforex-institutional/`, within `dogeforex-ui`. The earlier `../prototypes/` remain separate.

IMF helps project teams use project tokens as collateral, mint currency-denominated debt and plan DEX liquidity with a separate token allocation. It is an independent extension of Frankencoin mechanics, with one independent system per currency. It does not provide automatic FX conversion, shared reserves or cross-currency exposure accounting.

## Surfaces and domain

| Surface | Local review URL | Public origin |
| --- | --- | --- |
| Website | http://127.0.0.1:5180/ | `https://imf.li/` |
| Documentation | http://127.0.0.1:5181/ | `https://docs.imf.li/` |
| Application | http://127.0.0.1:5182/ | `https://app.imf.li/` |

Vercel is the static hosting target and Infomaniak remains the DNS provider. `www.imf.li`, `doge.forex` and `www.doge.forex` redirect to the canonical website. `international-multicurrency-framework.com` remains a future redirect while its registration/DNS is inactive. The older `docs.internationalmoneyfactory.local` quest seed is only a local placeholder.

## Current release boundary

- The website retains Chairpup/Scenario imagery, the three-step project journey, the hypothetical learning model, eleven-currency explorer and deeper mechanism links.
- The documentation includes searchable illustrated V2 guides with stable article IDs and statically rendered pages at `https://docs.imf.li/guides/<id>/`. Legacy `/#<id>` shortcuts redirect to those pages when JavaScript is available.
- The application separates new proposals, accepted-term clones and existing-position mints. Guided forms also cover repay/close/adjust, roll/ownership/rescue, challenges/bids/expired purchases/postponed returns, bridge/savings/equity and advanced governance. `src/actions.ts` defines 37 canonical operations; the arena is a separate workspace view.
- All 11 currency codes remain available for planning. Only currencies verified against the active V2 registry are enabled for ecosystem reads; other options are explicitly marked read-unavailable. The configured public testnet verifies USD only, and guided writes are restricted to that verified `runtime-config` USD system. This does not assert deployment of the other currencies or DEX support.
- Registry identity, chain ID, bytecode and contract-link checks precede current reads and writes. A registry's deployment postconditions are historical evidence, not current state. V1 addresses are never substituted.
- `config/runtime.testnet.json` selects `testnet-metamask` with status `configured-testnet-metamask`, chain ID `6281971`, RPC `https://rpc.testnet.dogeos.com`, explorer `https://blockscout.testnet.dogeos.com` and native 18-decimal tDOGE. The default `config/runtime.json` remains unconfigured/read-only. Imported registries and custom RPC connections are read-only; the synthetic fixture accepts only its isolated test wallet.
- Each guided write uses an exact approval when required, a fresh static call and gas estimate, explicit review and separate MetaMask confirmation. Receipts are journaled; no follow-up or resubmission is automatic. A static call reflects current state and is not a future guarantee. Read-derived checks and planning exports alone are not transaction authorization.
- There is no private-key handling, message signing, DEX execution, keeper automation or agent execution. Ordinary `imf.position-plan.v1` and `imf.v2-read-plan.v1` exports remain non-executable; the offline 20% reserve / 1% fee model is a teaching example, not a V2 quote.
- The eight configured USD contracts have Sourcify exact creation/runtime matches; Blockscout display verification remains open. tUSDC is a deployer-minted test asset, not USDC or a production reserve. Production readiness is not claimed.
- Drafts are local to the browser's app origin. Importing JSON does not import on-chain state or authority. No cross-device or cross-subdomain synchronization is implied.

## Static discovery and responsive reading

- The documentation index and all 18 guides are complete HTML before JavaScript runs. Clean guide URLs have unique titles/descriptions, canonical links and `TechArticle`/breadcrumb JSON-LD. Search enhancement and legacy hash redirects do not replace the static content.
- Every surface publishes `robots.txt`, an absolute-URL `sitemap.xml` and an experimental `llms.txt` index. The wildcard robots rule allows search and AI crawlers; no crawler-specific training or ranking outcome is claimed. Open Graph/Twitter metadata and structured data mirror visible content.
- At mobile widths, documentation and workspace navigation collapse into keyboard-accessible disclosure controls. Without JavaScript, navigation and guide content remain visible and the main navigation stays available. Form inputs use at least 16px on phones to avoid automatic browser zoom.
- Static images carry intrinsic dimensions and responsive 480px/960px sources where useful. These are resized versions of the existing artwork, not new imagery or a change to asset permissions.
- SEO and machine-readable files improve discovery and comprehension but do not guarantee indexing, ranking, traffic, AI retrieval or accurate citation. Search-console verification and any indexing requests are separate account actions.

## Install and review

Build the sibling SDK first, then install this frontend:

```bash
cd ../../dogeforex-sdk-ts
npm run extract:abis && npm run build
cd ../dogeforex-ui/imf-v2
npm install
npm run dev
```

`npm run dev` creates independent static roots under `dist/` and serves all three local origins. Stop an existing preview before rebuilding if you want to inspect a different build.

Use Node 22 for checks:

```bash
npm run verify
npm run verify:browser
```

`verify` checks source, exact planning, the V2 browser bundle and all three output roots, including ordered scripts, static guide content, canonical metadata, JSON-LD and discovery files. `verify:browser` additionally runs isolated-Chrome fixture and default workflows, actual downloads, drafts, keyboard/no-JavaScript checks, and 320–1440px overflow checks on the website, all 18 guides and all nine workspace views, including the arena. Healthy existing previews are reused without being stopped. If a preferred port range is occupied but unresponsive, the checker selects a free three-port range and rebuilds the local preview origins so navigation and metadata remain consistent. No existing browser profile is used.

Guided-action verification passed on 2026-10-27: all 37 canonical actions, 26 event-decoding checks, 26 invalid-input checks, 27 wallet-engine checks, 36 guided-journey checks, and nine local-EVM tests executing all 37 operations. The complete static and browser suites passed; live testnet verification retained `transactionSent: false`. See `handoff/VERIFICATION.md` for the actual results and remaining manual-review gates.

```bash
node scripts/check-actions.mjs
node scripts/wallet-check.mjs
node scripts/journey-check.mjs
npm run verify
npm run verify:browser
npm run verify:testnet
cd ../../dogeforex-protocol
npx hardhat test test/FrontendJourneysV2Tests.ts
```

The protocol Hardhat command is local-only real-contract execution coverage. Wallet/journey write tests use the isolated mock wallet or local EVM, never public DogeOS transactions.

The original source's `npm run verify` passed before import: 86 local references, 13 guides, 11 currencies and both original interaction harnesses. The imported implementation has additional exact-planning, registry/read-model, build and browser checks; see the final verification notes in `handoff/README.md` for what was actually run.

## Testnet production build and Vercel

Build and check the configured DogeOS testnet release with its explicit public origins:

```bash
npm run verify:testnet
```

This creates `dist/`-independent output under `.production-dist/{website,docs,app}` and Vercel Build Output bundles under `.vercel-output/{website,docs,app}/.vercel/output`. Production builds require the explicit `testnet-metamask` runtime, fixed DogeOS chain metadata, a verified USD registry and secure origins; review/fixture output, mock providers and source maps are rejected by the Vercel packager. The bundles contain static public assets only, with no handoff material, Node dependencies or credential files. The browser check uses real RPC reads without requiring MetaMask, monitors JSON-RPC methods on all origins, checks the no-injected-wallet and no-JavaScript boundaries, and must retain `transactionSent: false`.

The linked Vercel projects are `imf-website`, `imf-docs` and `imf-app`. After a verified build, deploy each surface from this directory:

```bash
vercel deploy --prebuilt --prod --archive=tgz --yes --cwd .vercel-output/website
vercel deploy --prebuilt --prod --archive=tgz --yes --cwd .vercel-output/docs
vercel deploy --prebuilt --prod --archive=tgz --yes --cwd .vercel-output/app
```

Repackaging preserves the Vercel project links. Vercel's local OIDC files and the Infomaniak `.env` are ignored and excluded from deployment. `handoff/VERIFICATION.md` records the current deployment IDs and public checks.

Infomaniak DNS is managed separately from Vercel deployments. Put `INFOMANIAK_API_TOKEN` in ignored `.env`, review the exact change set, then apply it:

```bash
npm run dns:vercel:dry-run
npm run dns:vercel:apply
```

`config/vercel-dns.json` records the per-host values returned by `vercel domains verify`; do not replace them with generic or another project's targets. The reconciler preserves unrelated records and stops on unexpected conflicts. `international-multicurrency-framework.com` is not configured while its registration is NXDOMAIN.

For another release configuration, set `IMF_RUNTIME_CONFIG` plus `IMF_WEBSITE_ORIGIN`, `IMF_DOCS_ORIGIN` and `IMF_APP_ORIGIN`, then run `npm run build`. Publish only the corresponding non-review output. Review localStorage behavior before changing the app origin: existing drafts do not migrate automatically.

## V2 registry and RPC

`config/runtime.json` remains deliberately unconfigured for ordinary review. `config/runtime.testnet.json` is the explicit DogeOS testnet MetaMask configuration and mirrors the protocol registry at `../../dogeforex-protocol/scripts/deployment/deployments/chikyuV2/USD_V2Registry.json`. Do not use an old aggregate registry merely because its schema label contains `v2`. The V2 SDK accepts actual `<CODE>_V2Registry.json` artifacts, their `linkedData`, or arrays of those artifacts. A staged subset of currencies is valid; only runtime-config USD has approved guided writes.

The app also supports reading a local V2 registry JSON file through **Wallet, registry & network** and connecting it to a public RPC endpoint without uploading that file to the application. Imported registries and custom RPC connections remain read-only and cannot authorize guided writes. Never put private keys, credentials or secret RPC URLs in any public runtime configuration. The ignored `.env` is exclusively for local deployment credentials.

The adapter checks required contract code and links, reads source block time, preserves method-specific decimal units and reports missing/failed state explicitly. It does not infer token eligibility from an address, mintability from a timer or live balances from deployment metadata.

For labeled synthetic fixture testing, run `npm run dev:fixture` and open the same three surfaces on ports **5190/5191/5192**. `npm run build:fixture` creates `.fixture-dist/` independently of the normal preview. `node scripts/browser-check.mjs` exercises that fixture in Chrome; `node scripts/browser-check.mjs --default` checks the ordinary unconfigured preview. Only the isolated test wallet may exercise fixture writes. The fixture has no deployed contracts, real reserves, real transactions or operational authority and is never a production configuration.

## Source map

- `index.html`, `assets/explore.js`: project-first website and learning interactions.
- `docs/index.html`, `assets/docs.js`, `assets/articles.json`: illustrated documentation, stable guide URLs, search enhancement and legacy shortcut redirects.
- `app/index.html`, `assets/app.js`: nine workspace views including the arena, verified read availability, human/agent planning and local draft handling.
- `assets/v2.js`: registry, V2 read models, exact position/bridge/equity/savings/governance views and runtime connection identity.
- `assets/wallet.js`: runtime-bound EIP-1193 policy, account/chain session checks, immutable preparation, explicit submission and receipt journal.
- `assets/discovery.js`: bounded position/challenge event discovery followed by current contract-state reads; events alone are not current state.
- `assets/actions.js`: guided form operations, exact approvals, fresh static call/gas estimation and explicit review before MetaMask confirmation.
- `src/actions.ts`: 37 canonical action encoders/decoders and receipt event decoding without provider, private-key or message-signing behavior.
- `assets/offline.js`, `assets/planning.js`: separate teaching planner, strict non-executable schemas and local backup/restore.
- `src/browser.ts`, `src/browser-fixture.ts`: browser entries for V2 reads/actions and the explicitly synthetic fixture.
- `scripts/check-actions.mjs`: canonical calldata, invalid-input, event and receipt-source checks.
- `scripts/wallet-check.mjs`, `scripts/journey-check.mjs`: isolated wallet and guided-journey verification; record their results only after running them.
- `scripts/browser-check.mjs`, `scripts/check-testnet-browser.mjs`: default/fixture browser checks and no-MetaMask live-read testnet checks, including all nine views and no-write boundaries.
- `scripts/build.mjs`, `scripts/discoverability.mjs`: SDK browser bundle, explicit runtime selection, static guide generation, canonical metadata, responsive images and discovery files.
- `scripts/check-discoverability.py`: ordered-script, static-content, metadata, JSON-LD, image and crawler-file validation.
- `scripts/prepare-vercel.mjs`: checked static Build Output packaging, exact-host canonical redirects and guide URL normalization.
- `scripts/serve.py`: local three-origin preview.
- `../../dogeforex-protocol/test/FrontendJourneysV2Tests.ts`: local-only Hardhat real-contract journey coverage, not a public testnet rehearsal.
- `handoff/`: imported provenance, schemas, current integration boundaries and dated verification status.

`package.json` description metadata and script wiring are owned separately from this documentation alignment and were not changed here; the existing read-only package description is not the runtime policy or verification evidence.

Trusted documentation HTML is repository-owned. Do not render remote/user HTML through that channel. Asset provenance is recorded separately; redistribution rights for the supplied art collection still need confirmation before external publication.
