# Shiyld Indexer

Open-source indexer for the Shiyld protocol — accelerates wallet sync (Merkle proofs,
event history) without ever being trusted: every response a wallet gets from an
indexer is independently re-verified against real on-chain state before use. A
malicious or broken indexer can only ever serve stale/wrong data, never cause a
wrongly-accepted spend — direct on-chain scanning always remains available as a
fallback.

## Quick start

```bash
docker compose up
```

That's it — no `.env` file, no signup, no paid RPC required. This starts indexing
Base Sepolia immediately using a free public RPC endpoint, with a bundled Postgres
database. The API is available at `http://localhost:4001` (`/health` is a good first
check).

To customize anything (which network(s) to index, a dedicated RPC provider, access
control, rate limits), copy `.env.example` to `.env` and edit it — see that file for
every available option.

## HTTPS

Off by default (the indexer only ever speaks plain HTTP — TLS termination is your
choice of setup). An optional nginx + Let's Encrypt certbot setup is bundled; see the
usage steps in `docker-compose.yml`'s own comment above the `nginx`/`certbot` services,
and `nginx/nginx.conf.example`.

## Full documentation

A complete setup guide (RPC provider selection, access-mode tradeoffs, Kubernetes
deployment, and more) lives at [link once published — see CLAUDE.md's Phase 3
Documentation item]. This README only covers the docker-compose quick start above.

## Running without Docker

```bash
pnpm install
pnpm run build
DATABASE_URL=postgresql://... pnpm start
```

`pnpm start` runs the combined single-process mode (`dist/index.js`) — the same thing
the Docker image's default command runs.
