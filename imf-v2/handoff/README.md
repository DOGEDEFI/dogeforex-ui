# IMF V2 integration handoff

This directory describes the imported frontend inside `dogeforex-ui/imf-v2`. The original workspace remains at `../../../../dogeforex-institutional/`; its internal planning page and output archives were not imported or published.

## Evidence and contracts

- `source-snapshot.json`: actual imported source paths, sizes and SHA-256 hashes. The source passed its own `npm run verify` before copying.
- `asset-provenance.json`: original supplied asset references and checksums. This is provenance, not a new license grant.
- `position-plan.schema.json` and `position-plan.example.json`: the legacy teaching-plan format. It is not a V2 operational request.
- `v2-read-plan.schema.json`: separate read-only V2 plan boundary. It has no transaction calldata, simulation success or signing authority.

## Receiving-project implementation

The new source is described in `../README.md` and `../AGENTS.md`. V2 registry, ABI, exact arithmetic and contract read models live in workspace-root `dogeforex-sdk-ts/src/v2/`. Read-only MCP adaptation lives in `dogeforex-mcp/`. Legacy V1 registry/client support is retained separately.

The frontend uses the actual protocol V2 `linkedData` registry shape. Legacy guardian and allocation-bootstrap contracts do not exist in the V2 path. No current V2 deployment registry was available at integration time. Synthetic test fixtures must be labelled as fixtures; they do not prove live deployment state, audit status, token acceptance, current market liquidity or production readiness.

## Scope carried forward

Preserved: International Multicurrency Framework naming, project-first positioning, three surfaces, Chairpup/world art, visual learning, deeper illustrated guides, equivalent human/agent planning, independent currency systems, participant assessment/veto responsibility and explicit signing boundaries.

Deferred/outside scope: circular-liquidity policy, challenger/keeper infrastructure, cross-currency exposure, DEX execution, wallet/signer integration, transaction simulation/broadcast, production stablecoin/collateral approval, protocol audit and separate launch communications. Public testnet domain/DNS/hosting is now implemented; the inactive long `.com` remains a separate follow-up.

## Verification record

The source baseline passed before import. [VERIFICATION.md](VERIFICATION.md) records the actual SDK, MCP, frontend build and real-browser commands and results, including 45 passing browser checks. It also records the configured DogeOS testnet registry, live read reconciliation, Vercel deployment IDs, Infomaniak DNS/TLS and public-origin checks. DOM harnesses alone are not browser or accessibility certification.

See the root `BACKLOG.md` for launch and remaining ecosystem gates.
