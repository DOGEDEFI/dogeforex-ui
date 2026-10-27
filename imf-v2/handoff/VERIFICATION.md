# Verification record — IMF V2 frontend integration

Reviewed 2026-10-24, on the local working trees. This is implementation and test evidence, not a protocol audit or live-deployment certification.

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
- **Not implemented here:** position/challenge discovery from chain history, transaction simulation/signing, DEX execution, circular-liquidity policy, challenger infrastructure, cross-currency exposure and launch communications.

Protocol mechanisms and protocol deployment records were not changed as part of this frontend integration. Existing V1 operational files and the uncommitted V2 protocol work were preserved.
