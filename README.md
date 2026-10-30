# DogeForex UI

Frontend work for the **International Money Foundry (IMF)** on DogeOS.

## V2 website, documentation and application

[`imf-v2/`](imf-v2/) contains the isolated production frontend for Much Reserve World. It combines the approved low-poly Scenario world, guided protocol missions, visual learning and 20 illustrated guides with exact V2 registry, position and transaction workflows through the sibling TypeScript SDK.

- Public testnet origins are `https://imf.li/`, `https://docs.imf.li/` and `https://app.imf.li/`, hosted as separate static Vercel projects with Infomaniak DNS.
- Every guide has a static `/guides/<id>/` page with canonical metadata and JSON-LD. All three surfaces provide robots.txt, sitemap.xml and an experimental llms.txt index. Responsive navigation, reduced image sources and no-JavaScript content support mobile and non-JavaScript readers.
- New proposals, cloning accepted terms and existing-position mints are distinct workflows. Registry identity, exact amounts/prices, borrowing quotes, eligibility, repayment, reserve effects, cooldowns and expiry use V2 read models rather than teaching percentages.
- No V1 addresses are used as V2 state. The public testnet configuration supplies all 12 verified V2 registries and public DogeOS RPC; ordinary review remains unconfigured. Guided writes remain USD-only.
- DogeOS SDK 4.0.4 provides a lazy external-EVM wallet island. It loads only after explicit connection and hands the provider to the guarded IMF wallet engine; direct MetaMask remains available. Message signing, social/embedded login and non-EVM providers are not enabled.
- This frontend does not deploy contracts, execute DEX actions, run keeper/challenger infrastructure or send automatic follow-up transactions. Guided testnet transactions use fresh simulation, exact review and separate wallet confirmation.

Start with [`imf-v2/README.md`](imf-v2/README.md) and [`imf-v2/AGENTS.md`](imf-v2/AGENTS.md).

## Earlier prototypes

[`prototypes/`](prototypes/) contains the earlier interactive UI explorations. They are preserved separately and are not replaced by the V2 import.

The protocol is an independent extension of [Frankencoin](https://github.com/Frankencoin-ZCHF) mechanics. One independent system exists per currency; there is no automatic FX conversion or shared reserve engine in this frontend. Mainnet deployment, protocol audit, source/collateral approval and monetary-system launch authorization remain separate gates.
