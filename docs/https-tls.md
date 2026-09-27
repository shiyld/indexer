# HTTPS / TLS Guide

**The indexer itself only ever speaks plain HTTP.** TLS termination is deliberately
left to whatever sits in front of it — a load balancer, an existing reverse proxy, or
the optional nginx+certbot setup bundled in this repo's `docker-compose.yml`. This
matches how every other Shiyld service is deployed (Traefik/Cloudflare Tunnel
terminates TLS in front, plain HTTP behind).

**This matters for real usage, not just hardening**: a browser blocks mixed content,
so a self-hosted instance serving plain HTTP over the public internet cannot actually
be used by an HTTPS-served wallet page. If you're exposing this indexer beyond
`localhost`, put TLS in front of it before anyone tries to use it from a real app.

## Option A: you already have TLS somewhere (recommended if applicable)

If you're running behind an existing load balancer, ingress controller, or reverse
proxy that already terminates TLS for you (common on most cloud platforms and every
Kubernetes setup — see [`kubernetes.md`](kubernetes.md)), just point it at the
indexer's plain HTTP port (`4001` by default) and you're done. No further setup in
this repo is needed.

One thing to carry through regardless of which proxy you use: `/subscribe`
(Socket.IO) needs `Upgrade`/`Connection` headers forwarded explicitly, or a WebSocket
upgrade silently falls back to (or fails on) long-polling. See the config below for
the exact headers.

## Option B: the bundled nginx + Let's Encrypt setup

For anyone who wants a working HTTPS setup without writing one from scratch. Off by
default — it never starts on a plain `docker compose up`.

1. **Point your domain's DNS A record at this host** before continuing (Let's
   Encrypt's HTTP-01 challenge needs to actually reach this machine on port 80).

2. **Copy the nginx config template and fill in your domain:**
   ```bash
   cp nginx/nginx.conf.example nginx/nginx.conf
   # Replace every occurrence of your-domain.example.com in nginx/nginx.conf
   ```

3. **Start nginx (HTTP-only for now — no certificate exists yet):**
   ```bash
   DOMAIN=indexer.example.com CERTBOT_EMAIL=you@example.com \
     docker compose --profile https up -d
   ```

4. **Request your first certificate:**
   ```bash
   docker compose --profile https run --rm certbot certonly --webroot \
     -w /var/www/certbot -d "$DOMAIN" --email "$CERTBOT_EMAIL" \
     --agree-tos --non-interactive
   ```

5. **Enable HTTPS**: uncomment the `server { listen 443 ssl; ... }` block at the
   bottom of `nginx/nginx.conf`, then reload:
   ```bash
   docker compose --profile https restart nginx
   ```

6. **Confirm it worked:**
   ```bash
   curl https://indexer.example.com/health
   ```

### Renewing the certificate

Not automated by this repo — set up your own periodic job (e.g. a host cron) running:

```bash
docker compose --profile https run --rm certbot renew
docker compose --profile https restart nginx
```

Let's Encrypt certificates are valid for 90 days; a daily or weekly cron is the
standard cadence (certbot's own `renew` command is a no-op until the certificate is
actually close to expiring, so running it more often than necessary is harmless).
