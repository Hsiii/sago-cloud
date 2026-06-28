# Bots Proxy

Shared public router for services on `bot.hsichen.dev`.

This owns Caddy, TLS, and top-level domain routing. Individual bots live in
their own app directories and attach to the shared `bots_shared` Docker network.

## Services

- `/` and `/wm31/*` route to `wm31bot:3000`
- `/morning/*` routes to `morning-dashboard:3100`

## Deploy

```bash
cp .env.example .env.production
docker compose up -d
```
