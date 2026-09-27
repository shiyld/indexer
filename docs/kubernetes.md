# Kubernetes Reference

For anyone running this beyond a single `docker-compose` host — a real cluster,
horizontal scaling, or integrating into an existing K8s-based infrastructure.

## Start here: `k8s/` example manifests

The concrete, apply-able manifests (and the actual apply order) live next to them in
[`k8s/README.md`](../k8s/README.md), not duplicated here. Short version: `configmap`
→ a `Secret` (imperative `kubectl create secret`, or `secret.yaml.example` copied and
filled in) → optional bundled `redis.yaml` → `deployment.yaml` → `service.yaml` →
optional `ingress.yaml.example` (adapt to your own ingress controller/TLS setup).

**Status:** believed correct against the real environment variables the indexer
reads and the real Docker image, but not yet applied against a live cluster to
confirm. Treat it as a reviewed starting point.

## What these example manifests give you

The same **single-process combined mode** as `docker-compose.yml` — one Deployment
running the listener, REST API, and Socket.IO together. Postgres is assumed
**external** (a managed database service, or one you already run elsewhere) — these
manifests don't try to be a Postgres operator.

This is enough for a straightforward single-replica deployment. It is *not* the
shape you want if you're trying to scale read traffic horizontally — see below.

## Scaling beyond one replica: the server/worker split

A single combined-mode process can't safely run as multiple replicas — every replica
would run its own independent chain listener, all writing to the same Postgres rows
and racing each other. Shiyld's own production instance
(`indexer.shiyld.com`) instead runs the same image with two different commands:

- **`node apps/indexer/dist/server.js`** — stateless, horizontally scalable (N
  replicas). Serves the REST/Socket.IO API by reading from Postgres; never talks to
  RPC directly.
- **`node apps/indexer/dist/worker.js`** — a singleton (exactly 1 replica). The only
  process that runs the chain listener loops and writes to Postgres/publishes to
  Redis.

Both need `REDIS_URL` set (for the Socket.IO cross-replica adapter) — this is the one
case where Redis stops being optional. Running this split is a plain Deployment
change:

```yaml
# server Deployment (N replicas)
command: ["node", "apps/indexer/dist/server.js"]
---
# worker Deployment (exactly 1 replica, no readiness/liveness HTTP probe — it serves no port)
command: ["node", "apps/indexer/dist/worker.js"]
```

A ready-made example pair for this split isn't in `k8s/` yet — the example manifests
currently only cover the simpler single-process mode. Worth building once someone
actually needs to scale past one replica; Shiyld's own internal manifests (not part
of this public repo) are the reference if you want to build it yourself in the
meantime.

## TLS

Not handled by anything in `k8s/` — a real K8s deployment almost always already has
an ingress controller/load balancer terminating TLS in front of Services. Point that
at the indexer's plain HTTP port (`4001`) the same way you would for any other
internal HTTP service. See [`https-tls.md`](https-tls.md) if you don't already have
one.

## Helm chart

Not built yet. The plain manifests in `k8s/` are meant to be a proven, working
starting point first — a real Helm chart (or Kustomize base) is a natural next step
once they're confirmed correct against a live cluster, not a v1 requirement.
