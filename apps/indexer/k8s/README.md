# Shiyld Indexer — example K8s manifests

**Status: not build/deploy-tested yet.** These manifests are believed correct against
the real environment variables the indexer actually reads (`../src/config.ts`) and
the real image (`../Dockerfile`), but have not been applied to a real cluster. Treat
them as a reviewed starting point, not a proven one, until that happens.

Unlike `../docker-compose.yml` (which bundles Postgres for a quick local setup),
Postgres is assumed **external** here — a managed database service, or one you
already run elsewhere in this cluster. That matches how most real K8s deployments
handle a database dependency; these manifests don't try to be a full Postgres
operator/StatefulSet.

## Apply order

```bash
kubectl apply -f configmap.yaml

# Create the secret imperatively (recommended — never touches disk):
kubectl create secret generic shiyld-indexer-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@your-postgres-host:5432/shiyld' \
  --from-literal=REDIS_URL='' \
  --from-literal=INDEXER_API_KEYS=''
# ...or copy secret.yaml.example to secret.yaml, fill in real values, and:
# kubectl apply -f secret.yaml

# Optional — an in-cluster Redis for the cache/Socket.IO adapter. Skip this and
# leave REDIS_URL empty for in-memory/single-instance mode instead.
kubectl apply -f redis.yaml
# If applied, update the secret's REDIS_URL to redis://shiyld-indexer-redis:6379

kubectl apply -f deployment.yaml
kubectl apply -f service.yaml

# Optional — adapt to your cluster's real ingress controller/TLS setup first, see
# the file's own comment.
# kubectl apply -f ingress.yaml
```

## Verifying it came up

```bash
kubectl get pods -l app=shiyld-indexer
kubectl port-forward svc/shiyld-indexer 4001:4001
curl http://localhost:4001/health
```

## Not covered here

- Horizontal scaling / the clustered server+worker split (Shiyld's own
  `indexer.shiyld.com` production setup uses N stateless server replicas + one
  singleton worker, all sharing Redis) — these example manifests deliberately run
  the single-process combined mode instead, matching `docker-compose.yml`. A real
  Helm chart or a clustered example is a natural next step once these manifests are
  proven, not part of this pass.
- A managed/bundled Postgres — bring your own.
- Namespace management — apply these into whatever namespace you want
  (`kubectl apply -n your-namespace -f ...`); they don't hardcode one.
