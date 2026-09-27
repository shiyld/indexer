# Access Mode Guide

Controls who can call this instance's read API (`/pools`, `/events`,
`/merkle-proof`, etc.) — `/health` is always open regardless of mode, since
monitoring/load-balancer health checks need it reachable unconditionally.

## `public` (the default)

Every read endpoint is open to anyone, no API key required. Fine for a personal
instance, or one you're comfortable serving to anyone (the data it serves is never
more sensitive than what's already public on-chain — see the parent repo's CLAUDE.md
for why an indexer has no privacy surface of its own to protect).

```bash
INDEXER_ACCESS_MODE=public   # the default — this line can be omitted entirely
```

## `restricted`

Every request must carry one of `INDEXER_API_KEYS`. Switch to this if you're
exposing an instance publicly and want to control who can actually use it — e.g. to
keep it for your own product's use only, or to hand out keys selectively.

```bash
INDEXER_ACCESS_MODE=restricted
INDEXER_API_KEYS=key-one,key-two,key-three
```

Generate real random values for each key — don't reuse `.env.example`'s placeholder
format. A request without a valid key is rejected before it does any real work.

**Applies to REST and the Socket.IO `/subscribe` feed both** — in restricted mode, a
socket connection must present a valid key in its handshake `auth` payload, the same
way a REST request presents one in a header.

## Rate limiting (applies regardless of access mode)

```bash
INDEXER_RATE_LIMIT_PER_MINUTE=300   # the default
```

A per-IP cap in `public` mode; per-IP *and* per-API-key in `restricted` mode. This is
abuse prevention, not an access-control mechanism on its own — it applies on top of
whichever access mode you've chosen, not instead of it.

## Which one should you pick?

| Situation | Recommended mode |
|---|---|
| Personal use, low traffic, don't mind others using it too | `public` |
| Serving your own product's wallet/frontend, don't want randoms hammering it | `restricted` |
| Genuinely public infrastructure (like Shiyld's own `indexer.shiyld.com`) | `public`, with rate limiting doing the abuse-prevention work |

There's no wrong default to start with — this is safe to change later; it takes
effect on the next restart, no data migration involved.
