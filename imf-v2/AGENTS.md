# IMF V2 frontend instructions

This isolated frontend belongs to `dogeforex-ui`. The earlier prototypes in `../prototypes/` are separate; do not overwrite them. The source was imported from `../../../dogeforex-institutional/` after its `npm run verify` passed on 2026-10-24. `handoff/source-snapshot.json` records imported hashes.

## Public scope

- Name: **International Multicurrency Framework (IMF)**. Older Factory/Foundry naming is historical.
- Primary journey: project tokens as collateral → mint a currency and record its debt → use a separate project-token allocation for DEX liquidity.
- Three surfaces: website at `https://imf.li/`, documentation at `https://docs.imf.li/` and application at `https://app.imf.li/`. Local review uses ports 5180, 5181 and 5182. `www.imf.li` and `doge.forex` are website redirects, not separate application origins.
- Preserve Chairpup, Scenario/world assets, visual learning, deeper guides, and equivalent human/agent planning. Keep meaningful captions and accessible controls with the imagery.
- Each currency is an independent system. No shared reserve, automatic FX conversion or cross-currency exposure engine is implemented. Collateral assessment and vetoes remain participant responsibilities.
- The protocol is described publicly only as an independent extension of Frankencoin mechanics. Do not restore intermediate-fork naming, claim official affiliation, inherited V2 audit coverage, production availability or MiCA compliance.

## V2 integration boundary

- Use the browser-safe V2 SDK from `../../dogeforex-sdk-ts`. The legacy aggregate schema named `dogeforex.registry/v2` is not protocol V2 identity. Only actual `<CODE>_V2Registry.json` artifacts/`linkedData` describe protocol V2.
- The USD V2 registry at `dogeforex-protocol/scripts/deployment/deployments/chikyuV2/USD_V2Registry.json` has eight Sourcify exact creation/runtime matches; Blockscout display verification remains open. `config/runtime.testnet.json` carries its exact `linkedData` and the public DogeOS testnet RPC for the read-only public build. Never substitute V1 addresses, teaching amounts or generated fixtures for verified state. Keep unavailable and failed reads distinct from zero. The test-only genesis example describes this USD deployment, not all 11 planning currencies.
- This integration is read-only. Do not add guardian/allocation-bootstrap dependencies, signing, transaction submission, DEX execution, keeper/challenger infrastructure or private-key handling. Read-derived eligibility and quotes are not transaction simulation or authorization.
- Amount, price and rate calculations use exact integer strings/BigInt and method-specific units. Browser `Number` is permitted for display percentages only, never raw monetary values.
- Preserve the offline learning model and `imf.position-plan.v1` compatibility separately from operational V2 read models. Exported JSON is never authorization. Browser storage is local to the app origin.
- `assets/articles.json` contains trusted repository-owned HTML only. Resolve its controlled origin/asset tokens before rendering; do not inject remote or user-provided HTML.

## Static discovery and responsive behavior

- Every guide is generated as complete HTML at `/guides/<id>/` with a unique title, description, canonical URL and `TechArticle`/breadcrumb JSON-LD. The documentation index is static too. Legacy `/#<id>` shortcuts redirect in JavaScript; do not return to hash-only guide content.
- `scripts/discoverability.mjs` owns trusted guide/status rendering, metadata, responsive image markup, robots.txt, sitemap.xml and the experimental llms.txt index. Release-specific guide status must match the selected runtime: only USD is configured publicly, tUSDC is not production USDC, and production readiness is unclaimed. Do not imply that schema or llms.txt guarantees indexing, ranking, citations or model training behavior.
- All 11 codes remain planning identifiers. Ecosystem/read-backed options are enabled only for currencies verified against the active registry; unavailable options are labelled and disabled for that workflow. Keep this distinct from local planning.
- Documentation search failure must not remove static guide content or navigation. Mobile sidebar controls are progressive enhancements: without JavaScript, guide content and navigation stay visible and the main mobile menu remains available.
- Test 320–1440px layouts across the website, every guide and every workspace view, including the teaching review. Include keyboard disclosure controls, no-JavaScript reading and mobile touch contexts. Responsive PNG derivatives retain the original artwork; their generation does not clear redistribution permissions.
- Generated script URLs are root-relative. `scripts/check-discoverability.py` asserts the exact ordered scripts, static guide content, canonical metadata, visible-FAQ/JSON-LD parity and public discovery files. `scripts/prepare-vercel.mjs` rejects stale production status and packages explicit guide/index redirects plus text/XML content types.

## Commands

- `npm install` after the sibling SDK has been built.
- `npm run verify`: syntax, separate review/fixture builds, static content/discovery checks, exact-planning and browser-bundle/read-model checks.
- `npm run build:review`: create separate local website/docs/app roots under `dist/`.
- `npm run dev`: build and serve `http://127.0.0.1:5180/`, `http://127.0.0.1:5181/` and `http://127.0.0.1:5182/`.
- `npm run dev:fixture`: serve the explicitly synthetic read-only fixture on `http://127.0.0.1:5190/`, `http://127.0.0.1:5191/` and `http://127.0.0.1:5192/`. Never treat it as deployed or production state.
- `npm run verify:browser`: build both preview types, start only missing local servers, and run isolated-Chrome interactions, screenshots, actual downloads and responsive checks via `playwright-core`. Existing preview servers are reused and never stopped by the checker. `node scripts/browser-check.mjs` runs only the fixture flow; add `--default` for the ordinary unconfigured flow. Set `CHROME_PATH` if Chrome is elsewhere. No existing browser profile is used.
- `npm run verify:testnet`: build the real DogeOS testnet configuration for the three `imf.li` origins under `.production-dist/`, check its content, package Vercel Build Output bundles under `.vercel-output/`, and run real-Chrome live RPC/read and responsive checks. Do not publish a review or fixture build.
- `vercel deploy --prebuilt --prod --archive=tgz --yes --cwd .vercel-output/<surface>`: deploy a linked website/docs/app project. Repackaging preserves Vercel links and local OIDC files; those credentials are excluded from uploads.
- `npm run dns:vercel:dry-run`: compare `config/vercel-dns.json` with Infomaniak without changing records. `npm run dns:vercel:apply` applies the reviewed change set. Keep the Infomaniak token only in ignored `.env` as `INFOMANIAK_API_TOKEN`; never print it or grant unrelated scopes.
- `config/runtime.json` remains deliberately unconfigured for ordinary review. `config/runtime.testnet.json` is the explicit public testnet configuration. Neither may contain credentials. The ignored `.env` is only for local deployment credentials and is never part of a site bundle.

Preserve page-specific script loading and the existing IDs/anchors unless updating all associated tests and links. Update this file and the README when behavior or verification status changes. Browser DOM harnesses are not substitutes for actual desktop/mobile, keyboard and accessibility checks.
