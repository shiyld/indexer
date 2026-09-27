# Setup Guide

## Quickest path: docker-compose

```bash
git clone https://github.com/shiyld/indexer.git
cd indexer
docker compose up
```

That's a genuinely complete, working instance — no `.env` file, no signup, no paid
RPC required. It bundles Postgres and Redis, and indexes Base Sepolia immediately
using `@shiyld/shared`'s free public RPC default. Check it came up:

```bash
curl http://localhost:4001/health
```

You should see `{"status":"healthy", ...}` with `networks.base-sepolia.state` moving
from `"syncing"` to `"synced"` as it catches up to the chain head.

## Customizing what it indexes

Copy `.env.example` to `.env` next to `docker-compose.yml` and edit it. The two most
common changes:

- **Which network(s) to watch** — `INDEXER_NETWORKS=base-sepolia,arbitrum-sepolia`
  (comma-separated slugs; a single instance can watch several networks at once, each
  with its own independent listener loop).
- **A dedicated RPC provider** instead of the free public default — see
  [`rpc-providers.md`](rpc-providers.md).

Everything else (HTTP port, access mode, rate limits) is documented inline in
`.env.example` — see [`access-modes.md`](access-modes.md) for the access-control pair
specifically.

## Running without Docker

```bash
pnpm install
pnpm run build
DATABASE_URL=postgresql://... pnpm start
```

`pnpm start` runs the combined single-process mode (`dist/index.js`) — the same thing
the Docker image's default command runs (listener + REST API + Socket.IO all in one
process). You'll need your own Postgres reachable at `DATABASE_URL`; Redis is
optional (see `REDIS_URL` in `.env.example` — unset means in-memory/single-instance
mode).

## Embedding it into your own service instead

If you'd rather run the indexer's logic inside a Node service you already operate
(instead of running `apps/indexer` as a standalone process), install the library
directly:

```bash
npm install @shiyld/indexer-core
```

This is exactly how Shiyld's own `apps/api` embeds it. See that package's own
`src/index.ts` exports for the public surface (registry, multi-network listener,
Merkle proof service, the REST/Socket.IO server builders).

## What's next

- [**HTTPS/TLS**](https-tls.md) — the indexer only ever speaks plain HTTP; this
  covers the bundled optional nginx+certbot setup.
- [**RPC providers**](rpc-providers.md) — when and how to move off the free default.
- [**Access modes**](access-modes.md) — public vs. API-key-gated, plus rate limits.
- [**Kubernetes**](kubernetes.md) — deploying beyond a single docker-compose host.
