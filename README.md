# Oracle

Deployment and runtime wiring for the Oracle VM that hosts personal tools.

This repo owns the VM-level pieces: Caddy, TLS, Docker Compose services,
container resource limits, shared networking, deploy scripts, and server
operations notes. App source code stays in separate repos and is checked out
under `/home/ubuntu/bots/apps`.

The repo is safe to publish publicly. Real production env files live outside
git under `/home/ubuntu/bots/secrets`.

## Layout

```text
/home/ubuntu/bots/
  oracle/              # this repo
  apps/
    wm31/              # WM31Bot app repo
    morning/           # MorningDashboard app repo
    recipe/            # Recipes app repo
  secrets/
    proxy.env
    wm31.env
    morning.env
    recipe.env
    postgres.env
```

## Runtime

`compose.yaml` runs:

- `caddy`, the public HTTPS router.
- `wm31bot`, the Discord bot API and gateway.
- `morning-dashboard`, the private morning dashboard.
- `recipe-site`, the recipe archive.
- `postgres`, a private PostgreSQL server for app containers.

All services attach to the external `bots_shared` Docker network. Named
volumes intentionally keep the existing production volume names so migrating to
this repo does not discard Caddy certificates, bot state, dashboard state, or
recipe uploads.

## Services

- `/` and `/wm31/*` route to `wm31bot:3000`
- `/morning/*` routes to `morning-dashboard:3100`
- `/recipe/*` routes to `recipe-site:3101`
- PostgreSQL is reachable only on the shared Docker network at `postgres:5432`.

## Secrets

Create production env files from the public examples:

```bash
mkdir -p /home/ubuntu/bots/secrets
cp env/proxy.env.example /home/ubuntu/bots/secrets/proxy.env
cp env/wm31.env.example /home/ubuntu/bots/secrets/wm31.env
cp env/morning.env.example /home/ubuntu/bots/secrets/morning.env
cp env/recipe.env.example /home/ubuntu/bots/secrets/recipe.env
cp env/postgres.env.example /home/ubuntu/bots/secrets/postgres.env
```

Fill in secret values on the VM only. Do not commit files from
`/home/ubuntu/bots/secrets`.

Set `POSTGRES_PASSWORD` to a strong generated value before starting PostgreSQL.
Apps on the `bots_shared` network can use the host `postgres`, port `5432`, and
the database/user values from `postgres.env`.

## Deploy Scripts

Run these from the VM:

```bash
scripts/deploy-proxy
scripts/deploy-wm31
scripts/deploy-morning
scripts/deploy-recipe
scripts/deploy-postgres
scripts/deploy-all
scripts/status
```

Each app-specific deploy script pulls that app checkout, rebuilds the matching
service, and leaves the other services alone. `deploy-all` pulls this repo and
all app repos before rebuilding the full stack.

## Manual Deploy

For first bootstrapping or emergency manual runs:

```bash
docker network create bots_shared
docker compose up -d
```
