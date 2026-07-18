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
    morning/           # Brawl Stars Store Claimer app repo
    recipe/            # Recipes app repo
  artifacts/
    homepage/          # Uploaded Next.js standalone artifact
  secrets/
    proxy.env
    wm31.env
    brawl-stars-claimer.env
    recipe.env
    homepage.env
    postgres.env
```

## Runtime

`compose.yaml` runs:

- `caddy`, the public HTTPS router.
- `wm31bot`, the Discord bot API and gateway.
- `brawl-stars-claimer`, the private Brawl Stars Store reward claimer.
- `recipe-site`, the recipe archive.
- `homepage`, the browser homepage uploaded as a Next.js standalone artifact.
- `postgres`, a private PostgreSQL server for app containers.

All services attach to the external `bots_shared` Docker network. Named
volumes intentionally keep the existing production volume names so migrating to
this repo does not discard Caddy certificates, bot state, claimer state, or
recipe uploads.

## Services

- `/` and `/wm31/*` route to `wm31bot:3000`
- `/brawlstars/*` routes to `brawl-stars-claimer:3100`
- `/morning/*` redirects to `/brawlstars/`
- `/recipe/*` routes to `recipe-site:3101`
- `homepage.hsichen.dev` routes to `homepage:3102`
- PostgreSQL is reachable only on the shared Docker network at `postgres:5432`.

## Scheduled Jobs

`scripts/install-brawlstars-claim-timer --enable` installs a persistent systemd
timer that runs `scripts/claim-brawlstars-reward` once daily at `09:00 UTC`
plus up to ten minutes of randomized delay. Transient failures retry up to two
times, 30 minutes apart. Exit code 2 means profile authentication is required;
that failure remains visible in systemd without retrying.

The claim script runs the one-shot Playwright command inside the
`brawl-stars-claimer` container. It claims every profile configured in
`BRAWL_STARS_CLAIMER_PROFILES`, reusing each profile's saved Playwright auth
state from the mounted state volume. Output is stored in the system journal.
The installer removes the legacy cron entry. Its safe default is `--disable`,
so repair all profile authentication before explicitly enabling the timer.

Run these from the VM:

```bash
scripts/deploy-brawlstars
scripts/install-brawlstars-claim-timer --enable
scripts/claim-brawlstars-reward --profile friend1
journalctl -u oracle-brawlstars-claim.service
```

PostgreSQL is dumped daily at `02:15 UTC` plus up to 15 minutes of randomized
delay. Seven days of custom-format dumps are retained under
`/home/ubuntu/bots/backups/postgres`, plus the latest four Sunday dumps under
its `weekly` directory. Every Sunday, the latest dump is restored into a
disposable database and queried before being dropped.

```bash
scripts/install-postgres-backup-timers
scripts/backup-postgres
scripts/verify-postgres-backup
journalctl -u oracle-postgres-backup.service
```

These local backups protect against database and application mistakes. They do
not protect against losing the VM; configure encrypted replication to an
off-host destination separately.

Container JSON logs rotate at 10 MB with three files retained per service.
Application health probes run every 60 seconds and PostgreSQL's runs every 30
seconds. `scripts/install-health-watch-timer` checks the resulting Docker
health state every five minutes and restarts an unhealthy container at most
once per 30-minute cooldown. Inspect actions with:

```bash
journalctl -u oracle-health-watch.service
```

## Secrets

Create production env files from the public examples:

```bash
mkdir -p /home/ubuntu/bots/secrets
cp env/proxy.env.example /home/ubuntu/bots/secrets/proxy.env
cp env/wm31.env.example /home/ubuntu/bots/secrets/wm31.env
cp env/brawl-stars-claimer.env.example /home/ubuntu/bots/secrets/brawl-stars-claimer.env
cp env/recipe.env.example /home/ubuntu/bots/secrets/recipe.env
cp env/homepage.env.example /home/ubuntu/bots/secrets/homepage.env
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
scripts/deploy-brawlstars
scripts/deploy-recipe
scripts/deploy-homepage
scripts/deploy-postgres
scripts/deploy-all
scripts/status
```

Each source-based app deploy script pulls that app checkout, rebuilds the
matching service, and leaves the other services alone. Homepage is built locally
from its own repo with `bun run deploy:oracle`, uploaded to
`/home/ubuntu/bots/artifacts/homepage`, then restarted by
`scripts/deploy-homepage`. `deploy-all` pulls this repo and source-based app
repos before rebuilding the full stack.

## Manual Deploy

For first bootstrapping or emergency manual runs:

```bash
docker network create bots_shared
docker compose up -d
```
