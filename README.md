# DogeForex UI

Frontend work for the **International Multicurrency Framework (IMF)** on DogeOS.

## V2 website, documentation and application

[`imf-v2/`](imf-v2/) contains the isolated import and adaptation of `../dogeforex-institutional/`. It preserves the project-first journey, Chairpup/Scenario imagery, visual learning model and illustrated guides while adding exact, read-only V2 registry and position workflows through the sibling TypeScript SDK.

- Public testnet origins are `https://imf.li/`, `https://docs.imf.li/` and `https://app.imf.li/`, hosted as separate static Vercel projects with Infomaniak DNS.
- Every guide has a static `/guides/<id>/` page with canonical metadata and JSON-LD. All three surfaces provide robots.txt, sitemap.xml and an experimental llms.txt index. Responsive navigation, reduced image sources and no-JavaScript content support mobile and non-JavaScript readers.
- New proposals, cloning accepted terms and existing-position mints are distinct workflows.
- Registry identity, exact amounts/prices, borrowing quotes, eligibility, repayment, reserve effects, cooldowns and expiry use V2 read models rather than teaching percentages.
- No V1 addresses are used as V2 state. The public testnet configuration supplies the verified USD V2 registry and read-only DogeOS RPC; ordinary review remains unconfigured.
- This integration does not deploy contracts, simulate or sign transactions, broadcast, execute DEX actions or run challenger infrastructure.

Start with [`imf-v2/README.md`](imf-v2/README.md) and [`imf-v2/AGENTS.md`](imf-v2/AGENTS.md).

## Earlier prototypes

[`prototypes/`](prototypes/) contains the earlier interactive UI explorations. They are preserved separately and are not replaced by the V2 import.

The protocol is an independent extension of [Frankencoin](https://github.com/Frankencoin-ZCHF) mechanics. One independent system exists per currency; there is no automatic FX conversion or shared reserve engine in this frontend. Mainnet deployment, protocol audit, source/collateral approval and monetary-system launch authorization remain separate gates.
