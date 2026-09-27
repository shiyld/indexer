# RPC Provider Guide

## The default: free, no signup

Out of the box, each network you index (`INDEXER_NETWORKS`) uses that network's free
public RPC endpoint from `@shiyld/shared`'s `NETWORKS` registry — the same defaults
Shiyld's own wallet and apps use. Nothing to configure, works immediately.

## When to move off the default

The free public endpoints are shared, rate-limited infrastructure. You'll want a
dedicated provider once you see:

- Frequent `degraded` readings in `/health` for a network that should be `synced`
- Slow initial backfill on a fresh instance (a full historical sync makes many
  `eth_getLogs` calls in quick succession — the free endpoints throttle this first)
- You're running this indexer to serve real production traffic for your own product,
  not just personal/low-volume use

## How to override

One environment variable per network, following the pattern
`RPC_URL_<SLUG_UPPERCASED_WITH_UNDERSCORES>` — e.g. for the `base-sepolia` slug:

```bash
RPC_URL_BASE_SEPOLIA=https://your-provider.example.com/v3/your-api-key
```

Set only the ones you're actually overriding — any network left unset falls through
to its free default. See `.env.example` for the full list of recognized slugs
(`base-sepolia`, `base`, `arbitrum-sepolia`, `arbitrum`, `ethereum-sepolia`,
`ethereum`).

## Picking a provider

Any standard EVM JSON-RPC endpoint works — this isn't tied to one vendor. Common
choices, roughly free-tier-to-paid:

| Provider | Notes |
|---|---|
| Alchemy | Generous free tier, widely used, good dashboards |
| Infura | Also has a free tier; this project's own experience (documented in the parent Shiyld repo) has seen it degrade under heavy testing load — a paid tier or a second provider as fallback is worth considering if you rely on it |
| A node you run yourself | No rate limits, full control, real operational overhead |

The indexer doesn't care which one you pick — it only ever needs standard
`eth_getLogs`/`eth_call`/`eth_blockNumber`-style JSON-RPC methods, nothing
provider-specific.

## A note on cost vs. traffic

RPC cost scales with how much history you're backfilling and how many networks
you're indexing at once — not with how many clients query *your* indexer's own API
(that traffic hits Postgres/your cache, never the upstream RPC directly). A single
network on a free tier is usually enough for personal or low-traffic use; multiple
networks or a public-facing instance is where a paid provider starts to matter.
