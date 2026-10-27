# IMF V2 integration handoff

This directory describes the imported frontend inside `dogeforex-ui/imf-v2`. The original workspace remains at `../../../../dogeforex-institutional/`; its internal planning page and output archives were not imported or published.

## Evidence and contracts

- `source-snapshot.json`: actual imported source paths, sizes and SHA-256 hashes. The source passed its own `npm run verify` before copying.
- `asset-provenance.json`: original supplied asset references and checksums. This is provenance, not a new license grant.
- `position-plan.schema.json` and `position-plan.example.json`: the legacy teaching-plan format. It is not a V2 operational request.
- `v2-read-plan.schema.json`: separate, non-executable V2 planning boundary. It has no transaction calldata, simulation success or signing authority.

## Receiving-project implementation

The current source is described in `../README.md` and `../AGENTS.md`. V2 registry, ABI, exact arithmetic and contract read models live in workspace-root `dogeforex-sdk-ts/src/v2/`. Read-only MCP adaptation lives in `dogeforex-mcp/`. Legacy V1 registry/client support is retained separately.

The frontend uses the actual protocol V2 `linkedData` registry shape. Legacy guardian and allocation-bootstrap contracts do not exist in the V2 path. No verified deployment registry was available at original import time; the current explicit `config/runtime.testnet.json` now supplies the USD Chikyū V2 registry. The ordinary runtime remains unconfigured/read-only. Synthetic fixtures remain labelled and accept only the isolated test wallet; they do not prove live deployment state, audit status, token acceptance, current market liquidity, real transaction execution or production readiness.

## Current MetaMask testnet boundary

- Guided writes are limited to verified `runtime-config` USD on DogeOS Chikyū testnet chain `6281971`. The fixed public RPC is `https://rpc.testnet.dogeos.com`, the explorer is `https://blockscout.testnet.dogeos.com`, and native currency is 18-decimal tDOGE. Imported registries and custom RPC connections remain read-only.
- `src/actions.ts` defines 37 canonical operations. The UI covers create/clone/mint, manage/repay/close/adjust, roll/ownership/rescue, challenges/bids/expired purchases/postponed returns, bridge/savings/equity and advanced governance, with a dedicated arena view and bounded event discovery followed by current-state reads.
- Each transaction uses exact approvals when needed, a fresh static call and gas estimate, explicit review and separate MetaMask confirmation. The receipt journal does not automatically resubmit or trigger a follow-up. Simulation is a current-state check, not a future guarantee.
- Planning exports remain non-executable. No private-key handling, message signing, DEX execution, keeper automation or agent execution is included.
- tUSDC is a deployer-minted test asset, not production USDC. Only USD is configured; the other ten codes remain planning identifiers and DEX support is not asserted. Production readiness is not claimed.
- All eight configured USD contracts retain Sourcify exact creation/runtime matches. Blockscout display verification remains open and is not resolved by this frontend work.

## Scope carried forward

Preserved: International Multicurrency Framework naming, project-first positioning, three surfaces, Chairpup/world art, visual learning, deeper illustrated guides, equivalent human/agent non-executable planning, independent currency systems, participant assessment/veto responsibility and explicit authorization boundaries.

Deferred/outside scope: circular-liquidity policy, automated challenger/keeper infrastructure, cross-currency exposure, DEX execution, production stablecoin/collateral approval, protocol audit and separate launch communications. Public testnet domain/DNS/hosting was implemented for the earlier read-only release; the inactive long `.com` remains a separate follow-up.

## Verification record

The source baseline passed before import. [VERIFICATION.md](VERIFICATION.md) preserves the historical 2026-10-24/26 SDK, MCP, frontend build, real-browser, read-only testnet, deployment and DNS/TLS results, including 45 then-current browser checks. Those results do not verify the new wallet, action, arena or guided-journey behavior.

The same file records the completed **2026-10-27 verification** for `check-actions.mjs`, `wallet-check.mjs`, `journey-check.mjs`, local Hardhat frontend journeys and the npm verify/browser/testnet commands. These are actual local/fixture and read-only live-RPC results; real MetaMask and assistive-technology review remains a separate gate.

See the root `BACKLOG.md` for launch and remaining ecosystem gates.
