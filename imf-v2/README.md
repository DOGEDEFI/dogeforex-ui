# International Money Foundry — V2 frontend

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

- The shared Much Reserve World design system uses the approved low-poly Scenario island, Arena and Chairpup art, tactile pastel cards, and self-hosted Baloo 2, Inter, JetBrains Mono and Press Start 2P fonts with OFL licenses. The website leads with an interactive world map, three goal-led missions, the hypothetical learning model, twelve independent currency districts and deeper mechanism links.
- The documentation includes 20 searchable illustrated V2 guides grouped into Start here, Plan & borrow, Liquidity, Participate & operate, and Integrate & status, with stable article IDs and statically rendered pages at `https://docs.imf.li/guides/<id>/`. The Wallet & DogeOS SDK guide documents origin registration, the lazy provider bridge and transaction boundaries. Legacy `/#<id>` shortcuts redirect to those pages when JavaScript is available. Grouped navigation and full content remain available without JavaScript.
- Start here is the no-route landing view with a world map and five-step guided workflow; every app view is bookmarkable and the unified Website/Documentation/Workspace header includes a no-JavaScript mobile fallback. Borrow, Earn and Invest retain read-backed guided missions; Much Arena presents real challenge state without synthetic production opponents or medals. Local learning progress has no token, monetary value or cross-device identity claim. The workspace is organized around Borrow, Earn, Invest, Dashboard and More, with a shared currency selector, three-step journey explanations, a read-backed position browser, progressive expert fields, Deposit/Withdraw and Invest/Redeem tabs, and friendly `#earn`, `#invest`, `#bridge` and `#governance` routes alongside legacy hashes. `assets/glossary.json` powers native 44px (i) explanations with canonical guide links at critical decision points. The read-only Dashboard has Overview, Collateral, Positions, Markets & volume, Risk Lab, Activity and Parameters subviews, with existing `#dashboard/<panel>` and currency-aware `#dashboard/<panel>/<code>` links. Its default all-currency explorer loads every verified system with searchable/sortable native-unit rows, supply bars and an optional normalized radar; no cross-currency totals are inferred and unsupported history does not occupy the primary layout. Dependency-free SVG visuals include collateral segments, lifecycle/activity timelines, diverging token flows and projected-SVG dataqubes/cloudpoints with keyboard/pointer controls and a table fallback. Public dashboard analytics use an identity-bound one-hour cache with update-age labels, stale-while-revalidate and a busy Reload now button; expired data stays labelled and receipts invalidate cached analytics. Optional health-checked Ponder history remains separate from current verified contract state. No synthetic prices, DEX volume/depth or FX totals are introduced. The application separates new proposals, accepted-term clones and existing-position mints. Guided forms cover repay/close/adjust, roll/ownership/rescue, challenges/bids/expired purchases/postponed returns, bridge/savings/equity and advanced governance. `src/actions.ts` defines 37 canonical operations; the arena is a separate workspace view.
- DogeOS SDK 4.0.4 supplies an external-EVM-only wallet island through `src/dogeos-wallet.tsx`. The production client ID is public application configuration for approved IMF origins, not a secret. `assets/dogeos.js` loads the separate React/DogeOS bundle only after Connect wallet is chosen. The island hands `connectors.evm.provider` to the existing guarded IMF wallet engine; direct MetaMask remains a fallback. Email/social/embedded login, WalletConnect without a separate project ID, non-EVM connectors, message signing and wallet authentication are not enabled. `npm run check:dogeos` checks the integration and provider boundaries.
- All 12 currency codes, including CHF/K9CHF, remain available for planning. The configured public testnet carries all 12 actual V2 registries and enables each currency for ecosystem and dashboard reads after its own bytecode and contract links verify. Public dashboard analytics may reuse verification for up to one hour; every guided quote and write rereads and verifies fresh state. Guided writes remain restricted to the verified `runtime-config` USD system. Each system is independent; DEX support is not asserted.
- Registry identity, chain ID, bytecode and contract-link checks precede current reads and writes. A registry's deployment postconditions are historical evidence, not current state. V1 addresses are never substituted.
- `config/runtime.testnet.json` selects `testnet-metamask` with status `configured-testnet-metamask`, chain ID `6281971`, RPC `https://rpc.testnet.dogeos.com`, explorer `https://blockscout.testnet.dogeos.com` and native 18-decimal tDOGE. The default `config/runtime.json` remains unconfigured/read-only. Imported registries and custom RPC connections are read-only; the synthetic fixture accepts only its isolated test wallet.
- Each guided write uses an exact approval when required, a fresh static call and gas estimate, explicit review and separate wallet confirmation. Receipts are journaled; no follow-up or resubmission is automatic. A static call reflects current state and is not a future guarantee. Read-derived checks and planning exports alone are not transaction authorization.
- There is no private-key handling, message signing, DEX execution, keeper automation or agent execution. Ordinary `imf.position-plan.v1` and `imf.v2-read-plan.v1` exports remain non-executable; the offline 20% reserve / 1% fee model is a teaching example, not a V2 quote.
- The eight configured USD contracts have Sourcify exact creation/runtime matches; Blockscout display verification remains open. tUSDC is a deployer-minted test asset, not USDC or a production reserve. Production readiness is not claimed.
- Drafts are local to the browser's app origin. Importing JSON does not import on-chain state or authority. No cross-device or cross-subdomain synchronization is implied.

## Static discovery and responsive reading

- The documentation index and all 20 guides are complete HTML before JavaScript runs. Clean guide URLs have unique titles/descriptions, canonical links and `TechArticle`/breadcrumb JSON-LD. Search enhancement and legacy hash redirects do not replace the static content.
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

`verify` checks source, exact planning, the V2 browser bundle and all three output roots, including ordered scripts, static guide content, canonical metadata, JSON-LD and discovery files. `scripts/check-read-cache.mjs` covers BigInt round trips, cache identity/TTL, all 12 currency keys, fixture isolation, caps, receipt invalidation and incremental discovery. `verify:browser` additionally runs isolated-Chrome fixture and default workflows, dashboard panels, actual downloads, drafts, keyboard/no-JavaScript checks, and 320–1440px overflow checks on the website, all 20 guides and all 11 workspace views, including Start here, arena and dashboard. Healthy existing previews are reused without being stopped. If a preferred port range is occupied but unresponsive, the checker selects a free three-port range and rebuilds the local preview origins so navigation and metadata remain consistent. No existing browser profile is used.

Guided-action verification passed on 2026-10-27: all 37 canonical actions, 26 event-decoding checks, 26 invalid-input checks, 27 wallet-engine checks, 36 guided-journey checks, and nine local-EVM tests executing all 37 operations. The complete static and browser suites passed; live testnet verification retained `transactionSent: false`. The guided testnet website, docs and app were deployed to `imf.li`, `docs.imf.li` and `app.imf.li`; public browser reads passed without signing or broadcasting. See `handoff/VERIFICATION.md` for the actual results, deployment IDs and remaining manual-review gates.

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

This creates `dist/`-independent output under `.production-dist/{website,docs,app}` and Vercel Build Output bundles under `.vercel-output/{website,docs,app}/.vercel/output`. Production builds require the explicit `testnet-metamask` runtime, fixed DogeOS chain metadata, every approved actual V2 registry and secure origins; review/fixture output, mock providers and source maps are rejected by the Vercel packager. The bundles contain static public assets only, with no handoff material, Node dependencies or credential files. The browser check uses real RPC reads without requiring MetaMask, monitors JSON-RPC methods on all origins, checks the no-injected-wallet and no-JavaScript boundaries, and must retain `transactionSent: false`.

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

`config/runtime.json` remains deliberately unconfigured for ordinary review. `config/runtime.testnet.json` is the explicit DogeOS testnet MetaMask configuration and mirrors the `linkedData` from every actual protocol artifact at `../../dogeforex-protocol/scripts/deployment/deployments/chikyuV2/<CODE>_V2Registry.json`, ordered USD first. `scripts/check-dashboard.mjs` rejects drift from those source artifacts and requires CHF once its registry is available. Do not use an old aggregate registry merely because its schema label contains `v2`. The V2 SDK accepts actual artifacts, their `linkedData`, or arrays of those records. All configured currencies support verified reads; only runtime-config USD has approved guided writes.

The app also supports reading a local V2 registry JSON file through **Wallet, registry & network** and connecting it to a public RPC endpoint without uploading that file to the application. Imported registries and custom RPC connections remain read-only and cannot authorize guided writes. Never put private keys, credentials or secret RPC URLs in any public runtime configuration. The ignored `.env` is exclusively for local deployment credentials.

The dashboard has no indexer configured by default. For a local or hosted Ponder endpoint, set `IMF_INDEXER_URL` at build time or provide an `indexerUrl` in a separately reviewed runtime. Local HTTP is accepted only on localhost; public Vercel packaging requires HTTPS without credentials, query or hash. See `../../dogeforex-ponder/README.md` for manifest generation, indexing and reconciliation. The indexer supplies historical/event analytics only and never replaces current-state SDK verification.

The adapter checks required contract code and links, reads source block time, preserves method-specific decimal units and reports missing/failed state explicitly. It does not infer token eligibility from an address, mintability from a timer or live balances from deployment metadata.

The all-currency overview shares pending system reads and renders rows progressively before position discovery completes. Hourly caching remains intact: Reload now refreshes the selected system, while Refresh currencies explicitly refreshes the full comparison. At 320–700px the five primary actions fit onscreen, read-only dashboard KPIs/tables are compact, and labeled Info disclosures open a keyboard-accessible bottom sheet with Escape focus restoration. Production SDK bundles are minified; review and fixture builds retain source maps.

For labeled synthetic fixture testing, run `npm run dev:fixture` and open the same three surfaces on ports **5190/5191/5192**. `npm run build:fixture` creates `.fixture-dist/` independently of the normal preview. `node scripts/browser-check.mjs` exercises that fixture in Chrome; `node scripts/browser-check.mjs --default` checks the ordinary unconfigured preview. Only the isolated test wallet may exercise fixture writes. The fixture has no deployed contracts, real reserves, real transactions or operational authority and is never a production configuration.

## Source map

- `index.html`, `assets/explore.js`: project-first website and learning interactions.
- `docs/index.html`, `assets/docs.js`, `assets/articles.json`: illustrated documentation, stable guide URLs, search enhancement and legacy shortcut redirects.
- `app/index.html`, `assets/app.js`: 10 workspace views including the read-only dashboard and arena, verified read availability, human/agent planning and local draft handling.
- `assets/dashboard.js`, `assets/dashboard.css`: read-only dashboard data adapter, provenance/freshness states, seven subviews and dashboard-specific styling.
- `assets/v2.js`: registry, V2 read models, exact position/bridge/equity/savings/governance views and runtime connection identity.
- `assets/foundry.css`: shared Much Reserve World design system, self-hosted fonts, responsive world/mission/docs/app/dashboard styling and mobile navigation rules.
- `assets/wallet.js`: runtime-bound EIP-1193 policy, external provider registration, account/chain session checks, immutable preparation, explicit submission and receipt journal.
- `assets/dogeos.js`, `src/dogeos-wallet.tsx`: on-demand DogeOS SDK 4.0.4 loader and external-EVM React wallet island.
- `assets/discovery.js`: bounded position/challenge event discovery followed by current contract-state reads; events alone are not current state.
- `assets/actions.js`: guided form operations, exact approvals, fresh static call/gas estimation and explicit review before wallet confirmation.
- `src/actions.ts`: 37 canonical action encoders/decoders and receipt event decoding without provider, private-key or message-signing behavior.
- `assets/offline.js`, `assets/planning.js`: separate teaching planner, strict non-executable schemas and local backup/restore.
- `src/browser.ts`, `src/browser-fixture.ts`: browser entries for V2 reads/actions and the explicitly synthetic fixture.
- `scripts/check-actions.mjs`: canonical calldata, invalid-input, event and receipt-source checks.
- `scripts/check-dashboard.mjs`: dashboard panel, provenance, unavailable-state and no-synthetic-data source checks.
- `scripts/check-dogeos.mjs`: DogeOS lazy-loading, external-EVM-only, no-message-signing, runtime and provider-bridge checks.
- `scripts/wallet-check.mjs`, `scripts/journey-check.mjs`: isolated wallet and guided-journey verification, including provider-swap invalidation; record their results only after running them.
- `scripts/browser-check.mjs`, `scripts/check-testnet-browser.mjs`: default/fixture browser checks and no-MetaMask live-read testnet checks, including all 10 workspace views, dashboard deep links and no-write boundaries.
- `scripts/build.mjs`, `scripts/discoverability.mjs`: SDK browser bundle, explicit runtime selection, static guide generation, canonical metadata, responsive images and discovery files.
- `scripts/check-discoverability.py`: ordered-script, static-content, metadata, JSON-LD, image and crawler-file validation.
- `scripts/prepare-vercel.mjs`: checked static Build Output packaging, exact-host canonical redirects and guide URL normalization.
- `scripts/serve.py`: local three-origin preview.
- `../../dogeforex-protocol/test/FrontendJourneysV2Tests.ts`: local-only Hardhat real-contract journey coverage, not a public testnet rehearsal.
- `handoff/`: imported provenance, schemas, current integration boundaries and dated verification status.

`package.json` description metadata and script wiring are owned separately from this documentation alignment and were not changed here; the existing read-only package description is not the runtime policy or verification evidence.

Trusted documentation HTML is repository-owned. Do not render remote/user HTML through that channel. Asset provenance is recorded separately; redistribution rights for the supplied art collection still need confirmation before external publication.
