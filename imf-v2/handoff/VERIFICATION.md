# Verification record — IMF V2 frontend integration

Reviewed 2026-10-24, on the local working trees. This is implementation and test evidence, not a protocol audit or live-deployment certification.

**Historical scope:** except for the dated 2026-10-27 wallet verification section at the end, this file records the earlier read-only integration and public release as of 2026-10-24/26. Those results remain valid only for that historical scope; they do not verify the new MetaMask wallet, 37-action encoder, discovery, arena or guided transaction journeys.

## Source preservation and import

- The source `/Users/tonicaradonna/dogeforex-institutional` passed `npm run verify` before import: 86 local references, 13 guides, 11 currency systems, and both original interaction harnesses.
- Imported into the isolated `dogeforex-ui/imf-v2/` directory. Existing `dogeforex-ui/prototypes/` were not changed. `handoff/source-snapshot.json` records imported hashes.
- Public identity is International Multicurrency Framework. The positioning is project tokens as collateral → currency debt and spendable proceeds → a separate project-token allocation for DEX liquidity. It is an independent extension of Frankencoin mechanics, not an official Frankencoin or DogeOS deployment and not a shared FX basket.

## SDK and MCP

From `dogeforex-sdk-ts`:

```text
npm run extract:abis
npm run typecheck
npm test
npm run build
npm audit
```

- 58 tests passed across 7 files, including V2 registry, ABI, exact math, read models and legacy compatibility.
- Current V2 registry, exact decimal/price scaling, proposal funding, clone/family capacity, existing-position state, repayment, withdrawal, expiry, bridge/credit, savings, equity and governance paths are covered.
- `npm audit` reported **0 vulnerabilities** after updating the test toolchain compatibly. The declared Node engine is `>=22.12.0`.

From `dogeforex-mcp`:

```text
npm run typecheck
npm test
npm run build
npm audit
```

- 43 offline tests passed across 4 files; the 5 legacy live tests are skipped unless explicitly enabled.
- V2 read tools include registry verification, new/clone/existing mint, repayment, withdrawal, challenges, source bridge/credits, savings, equity and governance. New-position validity is explicitly scoped to opening terms/funding; a separate planned-mint review checks capacity, backing, overflow and usable proceeds.
- V2 guardian and allocation-bootstrap paths are not invoked. V2 writes fail before signer lookup, fee sampling, simulation or sending. `npm audit` reported **0 vulnerabilities**.

No live V2 registry or deployed V2 address set was available. SDK and MCP V2 tests use synthetic fixtures/mocked RPC; they do not prove a live connection. The SDK's separate legacy read-only smoke test is not a V2 deployment check.

## Frontend source and builds

From `dogeforex-ui/imf-v2`:

```text
npm run verify
```

Passed:

- JavaScript syntax and the V2 browser bundle.
- 109 local source references, 18 illustrated guide routes and 11 centralized currency entries.
- Separate review and fixture output roots, each with 65 local references and no internal handoff/test material.
- Exact teaching/legacy planning, non-executable JSON validation, draft save/load/delete, backup deduplication and corrupt-storage handling.
- The explicitly synthetic V2 fixture and all nine scenarios: valid, wrong-chain, missing-code, rpc-error, no-votes, cooldown, expired, challenged and zero-balance.
- V2 browser-bundle verification of proposal math, current/custom-expiry quotes, position eligibility, repayment/withdrawal, bridge credits/rounding, savings, equity and governance.

A production-style build using reserved `.example` origins also passed. Missing production origins correctly fail the build. The `.example` values are test placeholders, not a chosen domain or publication.

## Actual browser verification

```text
npm run verify:browser
```

Passed **45 checks: 28 fixture checks and 17 default-preview checks**. These used installed Chrome through `playwright-core`, with a new isolated profile and actual download events/files. No existing browser profile, keys, deployment or broadcast was used.

Coverage includes:

- Verified registry and code/link checks, six-decimal collateral metadata, exact pre-opening, clone and existing-position quotes.
- Proposal funding, caller authorization, capacity, backing, reserve/fee combinations, strict cooldown/expiry/challenge boundaries, missing-caller and failed-read states.
- Repayment wallet amount versus gross debt reduction, full-repayment caveats, withdrawal, expiry pricing, source bridge units/credits, savings locks, equity and vote qualification.
- Local V2 and legacy drafts, backup/import, reload persistence, malformed/disabled storage, and actual JSON file downloads with `executionEnabled: false`.
- All 18 documentation routes and image loading, search, unknown routes, failed guide requests, and separate-origin links/storage.
- Human/agent equivalent intent, keyboard details/menu/Escape/skip-link/focus, 360/390/768/1280/1440 layouts, 200% zoom, reduced motion, and no uncaught browser errors.

Evidence in the ignored `artifacts/` directory:

- `browser-results-fixture.json` — 28 passing checks.
- `browser-results-default.json` — 17 passing checks.
- `website-desktop.png`, `website-mobile.png`, `docs-mobile.png`, `app-desktop.png`, `app-desktop-final.png`, `app-mobile.png` and workflow captures.
- `downloads/` — actual exported planning JSON used for schema and content checks.

## Public DogeOS testnet deployment — 2026-10-26

### Origins and deployment identity

- Website: `https://imf.li/` — Vercel project `imf-website`, deployment `dpl_8TFuvkmyVURswDFsTCSndx8Ub2CL`.
- Documentation: `https://docs.imf.li/` — Vercel project `imf-docs`, deployment `dpl_9AghfhpWAQvs5ELY1zQfdzZs4owm`.
- Application: `https://app.imf.li/` — Vercel project `imf-app`, deployment `dpl_3tP8dwH6gHqGX2wxVo3itPpdDrjM`.
- Vercel scope: `operalag-gmailcoms-projects`. All three final deployments reported `READY` and aliased their respective custom origins.
- `www.imf.li`, `doge.forex` and `www.doge.forex` return 308 redirects to `https://imf.li/`, preserving the path and query. HTTP upgrades to HTTPS.
- `international-multicurrency-framework.com` still returns NXDOMAIN and has not been attached or configured.

The static Build Output bundles exclude source maps, dependencies, handoff files and credentials. Vercel link files and local OIDC files are preserved by repackaging but excluded from upload. Public `/.env`, `/.env.local` and missing-path checks return 404 on all three origins.

### Infomaniak and certificates

`config/vercel-dns.json` records the exact per-host results from `vercel domains verify`. Infomaniak remains the DNS provider; nameservers were not moved to Vercel.

- Both apexes have A records `216.150.1.1` and `216.150.16.1`.
- `www.imf.li` and `www.doge.forex` use `0d63af6ec312a27d.vercel-dns-016.com.`.
- `docs.imf.li` uses `891c91968e1fcc26.vercel-dns-016.com.`.
- `app.imf.li` uses `02cc43d352c636cb.vercel-dns-016.com.`.
- All use TTL 300. Existing NS, SPF and DMARC records were preserved.
- All six Vercel domain checks report valid configuration and all six managed certificates were issued.
- A final `npm run dns:vercel:dry-run` returned `keep` for all eight records, with no DNS drift.

### Live registry and read evidence

`config/runtime.testnet.json` exactly matches the `linkedData` in `dogeforex-protocol/scripts/deployment/deployments/chikyuV2/USD_V2Registry.json`. The public RPC is `https://rpc.testnet.dogeos.com`; the ordinary review configuration remains unconfigured and the fixture remains synthetic.

Direct SDK verification at source block `8915797` (`0xf6e5aae2441e61a5759468dc3b610dbbc9d64a13d68d6758bba81dd70ae075b9`) confirmed chain ID `6281971`, all eight required contract code/link checks, six-decimal tUSDC and decimal multiplier `1000000000000`. Separate current reads matched 100 raw-million tUSDC locked, 100 K9USD supply, five active genesis minters, 59,400 ppm leadrate and 1,000 pool shares. These are observations at that read time, not immutable state or production reserves.

### Final commands and results

```text
npm --prefix ../../dogeforex-sdk-ts run build
npm run verify
npm run verify:browser
npm run verify:testnet
npm run dns:vercel:dry-run
vercel deploy --prebuilt --prod --archive=tgz --yes --cwd .vercel-output/<surface>
```

- The sibling SDK build passed.
- `npm run verify` passed all source, content, exact-planning and fixture checks on the final source.
- All **45 existing browser checks** passed: 28 fixture and 17 default-preview checks.
- The repeatable production testnet build/content/package/browser command passed. Its real-Chrome run observed 104 read-only RPC requests, automatic registry verification, live bridge/savings/equity state, desktop/mobile layouts and 404 behavior.
- The final public-origin browser run observed 95 read-only RPC requests. It verified the live registry and bridge/savings/equity reads on `app.imf.li`, the project guide on `docs.imf.li`, cross-origin links, desktop/mobile layouts and production content. No browser errors or signing/transaction methods were observed.
- Final HTTP checks confirmed 200 responses for all three origins, 308 canonical redirects with path/query preservation, HTTPS upgrade, and 404 for missing/credential paths.
- A later public-content retry passed without a network retry: 31 public resources, including the complete static guides, crawler files, sitemaps and social image, match `.production-dist`. The local discovery checker passed all 21 static HTML pages, canonical metadata, JSON-LD, visible-FAQ parity, responsive images, robots, sitemaps and llms.txt. A real-browser connection check required no reconnect or redeployment. Evidence: `artifacts/public-seo-verification-2026-10-26.json`.
- Evidence: `artifacts/testnet-browser-results.json`, `artifacts/live-browser-results.json`, `artifacts/live-website-desktop.png`, `artifacts/live-docs-desktop.png`, `artifacts/live-app-desktop.png`, `artifacts/live-app-mobile.png`, and `artifacts/vercel-deployment-2026-10-26.json`.

No contract deployment, transaction simulation, signing or blockchain broadcast was performed for this frontend release.

## Remaining gates and non-claims

- **Blockscout display verification remains open.** All eight contracts retain Sourcify exact creation/runtime matches. Protocol diagnostics on 2026-10-27 submitted all eight through native standard-input and tested multi-part, flattened-code and Etherscan-compatible paths without any Blockscout `is_verified=true` result; see `dogeforex-protocol/scripts/deployment/deployments/chikyuV2/USD_BlockscoutDiagnostics.json`. Queue acceptance is not display verification, and this frontend release does not resolve the external blocker.
- **The long `.com` remains inactive.** Activate its redirect only after registration and DNS become available.
- **Production assets and economics remain open:** DogeOS stablecoin selection and issuer/freeze/upgrade/decimal/ERC20 behavior, source caps/redemption/liquidity, production collateral, initial-investor custody, current rate review, mainnet chain/RPC parameters and initial equity custody.
- **Review remains open:** independent contract audit, live challenge/bridge rehearsals, MiCA/legal assessment, source-asset trust, supplied-art redistribution permissions and production accessibility review. Publishing does not mark those permissions or reviews as complete.
- **Still not implemented here:** DEX execution, circular-liquidity policy, keeper/challenger infrastructure, cross-currency exposure and launch communications. The newer guided-wallet work adds event-log discovery, exact simulation and wallet-confirmed testnet transactions, not those separate services.

Protocol mechanisms and protocol deployment records were not changed as part of this frontend integration. Existing V1 operational files and the uncommitted V2 protocol work were preserved.

## MetaMask wallet and local-EVM verification — 2026-10-27

**Status: VERIFIED AND DEPLOYED TO THE PUBLIC TESTNET ORIGINS.** The frontend and protocol journey tests were run with Node 22 and Node 20 respectively, both repositories were pushed, and all three Vercel surfaces were deployed. No public blockchain transaction was performed.

Actual results:

- `node scripts/check-actions.mjs`: **37/37 canonical calldata comparisons**, 26 event-decoding checks and 26 invalid-input checks passed, including receipt-source validation and both browser entries. The action encoder adds no provider, private-key or message-signing path.
- `node scripts/wallet-check.mjs`: **27 isolated-Chrome wallet checks passed**, covering production/mock separation, connection and switching, stale responses and sessions, exact approvals, simulation/gas failures, double submission, rejection, pending/reverted/confirmed receipts, unknown outcomes and reload reconciliation without resubmission.
- `node scripts/journey-check.mjs`: **36 visible-app checks passed with zero browser errors**, including exact collateral approval, opening and `PositionOpened` reconciliation, existing mint, an auction bid and every visible operation form. Evidence: `artifacts/journey-app-desktop.png` and `artifacts/journey-app-mobile.png`.
- `npx hardhat test test/FrontendJourneysV2Tests.ts`: **9 local-EVM tests passed**; its coverage guard confirmed all 37 operations executed through `signer.sendTransaction`. This proves actual local contract calls, not merely encoding, and includes challenges, auctions, expired purchases, rolling, savings, equity and advanced governance.
- `npm run verify`: passed syntax, review/fixture builds, content and discovery, planning schemas, fixture/read models and the action checks.
- `npm run verify:browser`: passed **52 existing fixture/default checks**, the **27 wallet checks** and **36 journey checks**. This includes all nine workspace views, legacy documentation shortcuts, downloads, keyboard/no-JavaScript behavior, responsive layouts, 200% zoom and reduced motion. When the old default preview ports were occupied by unresponsive earlier processes, the checker selected a free port range and rebuilt local preview origins; it did not stop those existing processes.
- `npm run verify:testnet`: passed production-form build/content/package checks and real-Chrome live-read verification. It observed **104 read-only RPC requests** and completed **149 responsive checks**, with no forbidden methods, no browser errors, no injected wallet and **`transactionSent: false`**. Production packaging excludes fixture implementations and permits test hooks only behind explicit synthetic-runtime guards.

The Hardhat coverage is local-only real-contract execution, not a public DogeOS transaction or production certification. Mock receipts demonstrate wallet/UI orchestration, not deployed-state transitions. Real MetaMask and assistive-technology review remains pending; DOM harnesses are not substitutes for that review. Production readiness remains unclaimed, tUSDC remains a test asset, and Blockscout display verification remains unresolved.

## Public guided-testnet deployment — 2026-10-27

Published GitHub commits: `dogeforex-ui` `ce75db7c5fe3f45c295b611140f98b451357cb6d` (`feat: add guided DogeOS wallet actions`) and `dogeforex-protocol` `b42f15bbd8d3f4d84c66f137d89dedd4e7dc5166` (`test: cover frontend protocol journeys`). Local `main` matched remote `main` after pushing, and both newly triggered gitleaks CI runs passed. Direct pushes emitted the existing PR-preferred admin-bypass notices.

All three Vercel deployments reported **READY** and aliased their custom origins:

- Website: `https://imf.li/` — `dpl_CSqh3s5QsKcWq5Y4dHU5245tj1zw`.
- Documentation: `https://docs.imf.li/` — `dpl_BTm9gHp9fGNiqwPS2p7dwUQL4K9Y`.
- Application: `https://app.imf.li/` — `dpl_FGTCY99DWfpqhRmw4wSVVfuKVT4X`.

Public HTTP checks returned 200 for all three origins, confirmed the wallet/discovery/action assets and `testnet-metamask` runtime on chain `6281971`, returned 404 for missing/credential paths, and preserved the `www.imf.li` 308 redirect including path and query. No DNS changes were made.

A fresh public-Chrome check verified the USD registry and bridge/savings/equity reads with no injected wallet. It observed **104 read-only RPC requests**, zero forbidden signing/broadcast methods and zero browser errors; mobile layout had no overflow and `transactionSent: false`. Evidence: `artifacts/live-app-desktop.png` and `artifacts/live-app-mobile.png`. Real MetaMask interaction and assistive-technology review were not performed. This is a deployed DogeOS testnet interface, not a production-readiness or Blockscout-verification claim.

## Dashboard integration — 2026-10-27

**Status: IMPLEMENTED AND FULLY VERIFIED LOCALLY, NOT DEPLOYED.** The dashboard was integrated into the existing V2 application on the `app.imf.li` origin as the first workspace menu item, with seven subviews (Overview, Collateral, Positions, Markets, Risk Lab, Activity, Parameters) and deep links `https://app.imf.li/#dashboard` plus `#dashboard/<overview|collateral|positions|markets|risk|activity|parameters>`. The public website nav gained a Dashboard link pointing to `app/#dashboard`, and a `dashboard-metrics` guide was added to `assets/articles.json` (19 guides total). No contract, DNS, routing-framework or naming changes were made; Factory/Foundry/Framework naming and the navigation contract are preserved. The work is uncommitted pending review.

Implementation: `assets/dashboard.js` (read-only adapter — `getCapabilities`, `getSystemSnapshot`, `getDiscoveredPositions`, `getChallenge`, `getHistory`, `getReferenceMarks`, `getEvents` — plus the seven panel renderers), `assets/dashboard.css`, `scripts/check-dashboard.mjs`. Modified: `app/index.html`, `assets/app.js` (view registry, `#dashboard/<panel>` deep links, forced dashboard refresh on registry connect), `assets/discovery.js` (backwards-compatible event-log `events` array), build/discoverability scripts and package.json (script order `… discovery, v2, dashboard, actions, app`), website `index.html`, `README.md`, `AGENTS.md`, and the two browser checkers.

Data rules as implemented: raw monetary amounts, prices, votes and bridge capacities stay exact integer strings/BigInt (`Number` only for display percentages/geometry via a single scaling helper); every live snapshot carries source block, timestamp, registry identity and read status; failed/missing/stale reads stay unknown and are never rendered as zero; only runtime-config verified USD appears as live deployed V2 state while the other ten codes show planning/unavailable; history, reference marks, volume and depth are designed "unavailable — indexer/feed not configured" states; the labelled synthetic fixture build never ships to production packaging.

Actual results on the final source:

- `npm run check` — passed.
- `npm run verify` — passed, including the new `scripts/check-dashboard.mjs` static coverage.
- `npm run verify:browser` — passed: 33 fixture checks and 21 default/unconfigured checks, plus the 27 wallet-engine checks and 36 guided-journey checks. All ten workspace views (including the dashboard) and all 19 guides were exercised at 320–1440px with no uncaught browser errors.
- `npm run verify:testnet` — passed. Result JSON: `ok: true`, `dashboardPanels: 7`, `dashboardLiveUsdOnly: true`, `dashboardDiscoveryAndDrawer: true`, `staticGuideCount: 19`, `responsiveCheckCount: 175`, `rpcRequestCount: 1177`, `forbiddenMethods: []`, `browserErrors: []`, `transactionSent: false`. Evidence: `artifacts/testnet-dashboard-desktop.png` and `artifacts/testnet-browser-results.json`.
- `node scripts/check-actions.mjs` — 37/37 canonical operations.
- `node scripts/wallet-check.mjs` — 27 checks, isolated test wallet only.
- `node scripts/journey-check.mjs` — 36 checks, fixture-only.

Limitations: no indexer exists, so historical charts and the Activity replay use only real discovered events with explicit coverage metadata; reference marks and market volume/depth remain unavailable until a real feed exists; live reads cover the verified USD system only; Barkswap prices are analytics inputs, not protocol oracle prices; the Blockscout display-verification blocker recorded above remains open and unresolved by this work.

## Public dashboard deployment — 2026-10-28

Published GitHub commit: `dogeforex-ui` `53393d5` (`feat: add read-only IMF dashboard workspace`), pushed to `main` (existing direct-main PR-preferred bypass notice emitted). `npm run verify:testnet` was rerun on the committed source before packaging and passed unchanged: `dashboardPanels: 7`, `dashboardLiveUsdOnly: true`, `dashboardDiscoveryAndDrawer: true`, `staticGuideCount: 19`, `responsiveCheckCount: 175`, `rpcRequestCount: 1177`, `forbiddenMethods: []`, `browserErrors: []`, `transactionSent: false`.

All three Vercel deployments reported **READY** and aliased their custom origins (scope `operalag-gmailcoms-projects`):

- Website: `https://imf.li/` — deployment `4xpKnKSy5ZibCHUX7eqL2i6kR8R6`.
- Documentation: `https://docs.imf.li/` — deployment `Aw3bxfSf82oSh6xu8tmTUgoJHBeK`.
- Application: `https://app.imf.li/` — deployment `7wv2aDmNB449XMYQeY2JpiDxewfo`.

Public HTTP checks returned 200 for all three origins and the new `/guides/dashboard-metrics/` route; `app.imf.li/assets/dashboard.js` and `dashboard.css` return 200; the app script order includes `dashboard.js` between `v2.js` and `actions.js`; the deployed bundle carries the `testnet-metamask` runtime and chain `6281971`; the website nav links to `https://app.imf.li/#dashboard`; missing paths return 404; and the `www.imf.li` 308 redirect preserves path and query. No DNS changes were made and no blockchain transaction was broadcast. Live dashboard deep links: `https://app.imf.li/#dashboard` and `#dashboard/<overview|collateral|positions|markets|risk|activity|parameters>`.

## Dashboard navigation and visual UX optimization — 2026-10-28

**Status: IMPLEMENTED AND VERIFIED LOCALLY, NOT COMMITTED OR DEPLOYED.** The nested dashboard sidebar and duplicate heading were removed. The single workspace rail is grouped into Monitor, Positions, Participate and Resources; all seven dashboard subviews remain available through one horizontal tablist with the existing deep links. Tabs implement tab/tabpanel relationships, roving tabindex, Arrow Left/Right, Home/End and active-tab reveal on selection and viewport resize. At 320–390px the tab row scrolls horizontally rather than becoming another menu grid.

Overview now uses the institutional visual language with a three-node currency-system map and bridge utilization. Both use the same verified V2 reads as the existing dashboard; bridge percentages use exact BigInt arithmetic before display formatting. Full registry/block/timestamp provenance stays in the source header, while KPI cards retain concise per-read block context. History, reference markets, volume/depth and cross-currency comparisons remain explicitly unavailable. No dependency, contract, routing-framework, fixture-data or write-path change was made.

Actual Node 22 results on the final source:

- `npm run check` and `npm run verify` — passed, including static assertions for the single navigation hierarchy, tab relationships, keyboard handlers and exact-integer visual calculations.
- `npm run verify:browser` — passed: **33 fixture checks and 21 default/unconfigured checks**, plus **27 wallet-engine checks and 36 guided-journey checks**. Dashboard coverage includes all seven panels, deep links, keyboard tabs, active-tab visibility after resize, live-data visual presence, 320/390/700/1024/1440px layouts, exports and zero uncaught browser errors. The complete run also exercised all 19 guides and all ten workspace views.
- `npm run verify:testnet` — passed: `ok: true`, `dashboardPanels: 7`, `dashboardLiveUsdOnly: true`, `dashboardDiscoveryAndDrawer: true`, `staticGuideCount: 19`, `responsiveCheckCount: 196`, `rpcRequestCount: 1146`, `forbiddenMethods: []`, `browserErrors: []`, `transactionSent: false`.
- `node scripts/check-actions.mjs`, `node scripts/wallet-check.mjs` and `node scripts/journey-check.mjs` ran within the verification commands above: 37 canonical operations, 27 wallet checks and 36 fixture-only journey checks passed.

Reviewed screenshots: `artifacts/testnet-dashboard-desktop.png`, `artifacts/dashboard-desktop-synthetic-fixture.png`, `artifacts/dashboard-mobile-synthetic-fixture.png`, and `artifacts/dashboard-mobile-unconfigured.png`. The public origins still serve the earlier dashboard deployment above; this optimization is not yet committed, pushed or deployed. Real MetaMask and assistive-technology review remains a separate manual gate, and Blockscout display verification remains unresolved.


## Prototype-style dashboard integration — 2026-10-28

**Status: IMPLEMENTED AND VERIFIED LOCALLY, NOT COMMITTED OR DEPLOYED.** The dashboard now follows the standalone prototype's information design inside the existing app shell: page-specific titles, compact KPI cards, analytical two-column grids, position-count composition, debt-weighted contract-parameter CR, current risk bubbles and CR buckets, health and event filters, a methodology dialog, working copy-link/export controls, and prototype-style Risk Lab, Activity and Parameters layouts. The single grouped workspace rail and horizontal keyboard-accessible dashboard tablist remain; no nested sidebar or routing framework was added.

The data boundary remains strict. Only runtime-config verified USD is presented as live deployed state. Collateral composition uses discovered position counts rather than inferred market values; CR uses each position's stored liquidation price rather than an external mark; raw monetary calculations remain exact integer/BigInt and compact KPI formatting is string-based. History, volume, reference marks, market depth, composite risk scores and cross-currency comparisons remain explicit unavailable states. No synthetic telemetry, remote fonts, chart dependencies, contract changes or write-path changes were introduced.

Actual Node 22 verification results:

- `npm run check` and `npm run verify` — passed, including all 37 canonical action checks and static dashboard/data-boundary assertions.
- `npm run verify:browser` — passed on the final source: 33 fixture checks, 21 default/unconfigured checks, 27 wallet-engine checks and 36 guided-journey checks. Dashboard coverage includes page copy, methodology, currency controls, health/CR/event filters, copy/export, deep links, keyboard tabs, replay, responsive screenshots and zero uncaught browser errors. The preview runner now keeps review and fixture port ranges distinct when the review server falls forward.
- `npm run verify:testnet` — passed: `dashboardPanels: 7`, `dashboardLiveUsdOnly: true`, `dashboardDiscoveryAndDrawer: true`, `staticGuideCount: 19`, `responsiveCheckCount: 196`, `rpcRequestCount: 1244`, `forbiddenMethods: []`, `browserErrors: []`, `transactionSent: false`.
- `node scripts/check-actions.mjs`, `node scripts/wallet-check.mjs` and `node scripts/journey-check.mjs` ran within these suites: 37 canonical operations, 27 wallet checks and 36 fixture-only journeys passed.

Reviewed final screenshots include `artifacts/testnet-dashboard-desktop.png`, `artifacts/dashboard-desktop-synthetic-fixture.png`, `artifacts/dashboard-mobile-synthetic-fixture.png`, and the desktop/mobile Positions, Risk Lab and Activity fixture captures. Live data coverage remains limited by the absent indexer and market feed. Real MetaMask/MyDoge and assistive-technology review remains a separate manual gate. Blockscout display verification remains unresolved.
