# Shiyld Indexer

Open-source, self-hostable indexer for the [Shiyld](https://shiyld.com) privacy
protocol — a zero-knowledge, shielded-pool DeFi protocol on Base and other EVM chains.

The indexer accelerates wallet sync (event history, Merkle proofs) without ever being
*trusted*: every response a wallet gets from an indexer is independently re-verified
against real on-chain state (`isKnownRoot()`) before it's used for proof generation. A
malicious or broken indexer can only ever serve stale or wrong data — never cause a
wrongly-accepted spend — and direct on-chain scanning always remains available as a
fallback if no indexer is reachable at all.

## What's in this repo

Two packages, one purpose:

- **`packages/indexer-core`** — published to npm as
  [`@shiyld/indexer-core`](https://www.npmjs.com/package/@shiyld/indexer-core). The
  embeddable library: multi-network event ingestion with self-sync/backfill, Merkle
  proof computation, a versioned REST + Socket.IO read API, caching, and access-mode
  hardening. Import it directly into your own Node service if you want the indexer
  running inside something you already operate (this is exactly how Shiyld's own
  `apps/api` embeds it).
- **`apps/indexer`** — a standalone, runnable server built on `packages/indexer-core`,
  published as a [Docker image](https://hub.docker.com/r/shiyld/indexer). Run it as-is
  if you just want a working indexer instance — see its own
  [README](apps/indexer/README.md) for the one-command quick start.

## Documentation

- [**Setup guide**](docs/setup.md) — the full walkthrough, including running without
  Docker and embedding `@shiyld/indexer-core` into your own service
- [**HTTPS/TLS**](docs/https-tls.md)
- [**RPC providers**](docs/rpc-providers.md) — free default vs. a dedicated provider
- [**Access modes**](docs/access-modes.md) — public vs. API-key-gated, rate limits
- [**Kubernetes**](docs/kubernetes.md) — beyond a single docker-compose host,
  including the server/worker split for horizontal scaling

## Why run your own indexer

The protocol works with **zero indexer at all** — a wallet can always fall back to
scanning on-chain events directly. An indexer is a pure performance/cost optimization,
never a protocol necessity, which is also why running one needs no stake or economic
bond (unlike a Shiyld relayer): a bad indexer is cheap to detect and switch away from,
the same trust posture as a block explorer or CDN relative to the chain it serves.
Run your own if you want dedicated speed/uptime for your own product, private indexing
of a network Shiyld doesn't officially serve, or just don't want to depend on anyone
else's instance.

## Versioning

This repo's releases are versioned independently, decoupled from Shiyld's internal
(private-monorepo) engineering history. The first release (`v0.1.0`) was marked a
pre-release — a deliberate dry run of the mirror → release → publish pipeline itself,
not yet a stability claim about the indexer. A real `v1.0.0` follows once that's
confirmed.

## Provenance

This repository is a mirrored, independently-versioned release of `apps/indexer` +
`packages/indexer-core` from Shiyld's private monorepo. Source changes land here via a
one-way mirror; publishing to npm and Docker Hub only ever happens when a real GitHub
Release is cut on this repo — a mirrored commit with no release cut publishes nothing.

## License

MIT
