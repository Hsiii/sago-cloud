# Sago Cloud Operations

Infrastructure and deployment tooling for the shared Oracle ARM64 host.
Applications run as independent Docker Compose stacks behind Caddy and a
Cloudflare Tunnel.

## Services

| Stack | Role |
| --- | --- |
| `bot-core` | MiniSago Discord bot |
| `homepage` | Public Homepage application |
| `obi` | CouchDB for Obsidian LiveSync |
| `minisago-worker` | Always-on `chat,dev` Codex worker |
| `pr-media-api` | Authenticated PR screenshot and video uploads |
| `edge` | Caddy routing and media serving |
| `cloudflared` | Outbound-only public ingress |
| `postgres` | Offline legacy database retained for rollback |

The regular deployment set excludes `cloudflared`, which is cut over
separately, and the offline legacy `postgres` stack.

## Common commands

```bash
bun run status
bun run deploy:all
bun run deploy:bot-core
bun run deploy:homepage
bun run deploy:minisago-worker
```

Deployments must run from a clean local `main` that matches `origin/main`. The
deployment script fast-forwards the VM checkout, pulls the selected ARM64 image,
and restarts only that stack. It never pushes code.

Administrative access uses the `sago-cloud` SSH alias over Tailscale:

```bash
ssh sago-cloud
```

## Documentation

- [Architecture](docs/architecture.md) — host layout, stacks, networks, images,
  and worker boundaries
- [Deployment and operations](docs/operations.md) — deployment targets, setup,
  secrets, scheduled jobs, backups, and host access
- [Cloudflare ingress](docs/ingress.md) — Tunnel configuration, caching,
  verification, and proxy trust
- [PR media](docs/pr-media.md) — storage, uploads, tokens, retention, and
  integrity checks
- [Migration and rollback](docs/migration.md) — legacy namespace migration,
  host rename, and post-rollback cleanup

## Repository layout

```text
edge/       Caddy Compose stack and configuration
services/   Independent application Compose stacks
jobs/       One-shot backup and restore jobs
scripts/    Deployment, installation, verification, and maintenance commands
systemd/    Timers and services installed on the host
env/        Committed production configuration examples
tests/      Deployment and security boundary tests
```

Production secrets and runtime state are stored on the VM and are never
committed.
