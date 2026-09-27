# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
# Pre-fetch the pinned pnpm binary at build time — without this, the
# runner stage's CMD triggers corepack to download pnpm from the registry
# at container STARTUP, giving a production container a network
# dependency just to boot (found during this project's own smoke test:
# a real container start was delayed by exactly this download).
RUN corepack prepare pnpm@11.16.0 --activate

FROM base AS pruner
RUN npm install -g turbo
COPY . .
RUN turbo prune --scope=@shiyld/indexer --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store --fetch-timeout=300000

FROM base AS builder
# Copy the WHOLE deps-stage filesystem, not just root node_modules — pnpm
# symlinks each workspace package's own dependencies into that package's
# own node_modules/ (e.g. apps/landing/node_modules/next), not just the
# root one. Copying only /app/node_modules here was a real, previously
# undiscovered bug (found via this project's own smoke test) that broke
# every app's production build silently until actually run end-to-end.
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
# turbo prune's pruned tree only carries files belonging to workspace
# packages it tracks — it drops root-level files like the monorepo's own
# tsconfig.json, which several packages/apps reach via a relative
# "extends": "../../tsconfig.json". Without this, tsc silently falls
# back to its ES3-era defaults instead of erroring, since a *missing*
# extended config is not itself a hard error — found via this project's
# own smoke test as a real, previously-masked build failure.
COPY --from=pruner /app/tsconfig.json ./tsconfig.json
RUN pnpm exec turbo run build --filter=@shiyld/indexer...

FROM base AS runner
ENV NODE_ENV=production
# Reuse the base node:22-alpine image's own built-in `node` user (uid/gid
# 1000) rather than a separate custom one - see apps/landing/Dockerfile's
# fix (2026-09-10): the k8s manifest's `runAsUser: 1000` assumes this user,
# and a custom `adduser -S` gets a non-matching uid, silently leaving the
# process without real write access to its own files under `/app`.
USER node
# Whole builder-stage tree, not cherry-picked paths — every workspace
# package this app imports at runtime needs its OWN node_modules/
# present (pnpm symlinks per-package, not just at the root); trying to
# enumerate which specific paths matter is exactly what caused the
# earlier builder-stage bug this Dockerfile already fixed above.
COPY --chown=node:node --from=builder /app/ ./

EXPOSE 4001
# Default CMD runs the combined single-process mode (dist/index.js) — one
# process does listener + REST + Socket.IO together, no Redis required. This
# is what a self-hoster's plain `docker compose up` actually runs. Shiyld's
# own clustered indexer.shiyld.com instead overrides `command` on this SAME
# image to run dist/server.js (N replicas, stateless) and dist/worker.js (the
# singleton that talks to RPC) as separate Deployments — one image, three
# entrypoints, avoids maintaining a second container build. Both split
# entrypoints require REDIS_URL; the combined default does not. See
# CLAUDE.md's "Indexer: Full Design & Public Distribution Plan."
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4001/health || exit 1
CMD ["node", "apps/indexer/dist/index.js"]
