# Sago Cloud Operations

Runtime wiring for the shared Oracle compute host. Sago Cloud resources are named
by role so applications can be renamed, replaced, or split without changing the
host, edge network, deployment tooling, or backup layout.

## Host Layout

```text
/srv/sago-cloud/
  operations/          # this repository
  edge/                 # symlink to operations/edge
  services/             # symlink to operations/services
  jobs/                 # symlink to operations/jobs
  secrets/              # production env files, never committed
  backups/
  state/
/srv/videos/              # optional static files served by Caddy
```

Run `scripts/install-layout` after cloning this repository to
`/srv/sago-cloud/operations`. It creates the runtime links, the `sago_cloud_edge`
frontend network, the isolated `sago_cloud_data` database network, and external
volumes.

Hosts using the legacy `/srv/platform` namespace can run
`SAGO_CLOUD_MIGRATION_CONFIRMED=yes scripts/migrate-sago-cloud`. The migration
creates a final PostgreSQL backup, stops the old stacks, moves the runtime root,
copies persistent volumes into the Sago Cloud namespace, and starts the renamed
stacks and timers. It retains a `/srv/platform` compatibility symlink and the
old volumes for rollback until the post-cutover cleanup.

After the runtime is healthy, run
`SAGO_CLOUD_HOST_RENAME_CONFIRMED=yes scripts/rename-sago-cloud-host` on the VM
to align its Linux and Tailscale hostnames. Rename the OCI instance display name
separately in Oracle Cloud; changing it does not alter the instance OCID.

## Runtime Stacks

Each workload is an independent Docker Compose project. Public services attach
to the external `sago_cloud_edge` frontend network, while PostgreSQL attaches only
to the external `sago_cloud_data` network:

- `edge`: Caddy routing, with direct public TLS retained only during Tunnel cutover.
- `cloudflared`: optional outbound-only Cloudflare Tunnel ingress. It deploys
  separately so merging its definition cannot cut over live traffic.
- `bot-core`: the current Discord bot runtime, published by MiniSago.
- `minisago-worker`: the always-on Luna/Sol Codex worker.
- `homepage`: the multi-platform Homepage image, attached to both networks after
  its migration job succeeds.
- `obi`: CouchDB for Obsidian LiveSync.
- `postgres`: private PostgreSQL, isolated from the public-service network.

Caddy discovers services through role-based network aliases. `/bot/*` is the
neutral bot route, and `/` routes to `bot-core`.

The co-located worker reaches `bot-core` through its private frontend-network
alias. This avoids relying on public-IP hairpin routing from the A1 VM.

Homepage is the only public service configured to use the local PostgreSQL
alias. Its one-shot migration container attaches only to `sago_cloud_data`; the
application attaches separately to `sago_cloud_data` for PostgreSQL and
`sago_cloud_edge` for Caddy. Other public services remain off the data network.

## Images

Application repositories build Linux AMD64 and ARM64 images in GitHub Actions
and publish both `main` and immutable `sha-<commit>` tags:

```text
ghcr.io/hsiii/minisago
ghcr.io/hsiii/minisago-worker
ghcr.io/hsiii/homepage
```

The VM only pulls images and starts containers; it does not clone or build
application source. Authenticate Docker on the VM with a GitHub token limited to
`read:packages` before the first pull of private images.

## Deployments

From this repository:

```bash
bun run deploy:all
bun run deploy:edge
bun run deploy:cloudflared
bun run deploy:bot-core
bun run deploy:minisago
bun run deploy:minisago-worker
bun run deploy:homepage
bun run deploy:obi
bun run deploy:postgres
bun run status
```

The app repositories wait for their image workflow and then invoke the matching
remote deploy command. Deploying this operations repository never pushes code:
it requires a clean local `main` that matches `origin/main`, fast-forwards the
VM checkout, then runs the selected stack command. A compatibility wrapper
remains for the previous `proxy` command name.

## Scheduled Jobs

One-shot work is separate from service definitions:

```text
/srv/sago-cloud/jobs/postgres/backup
/srv/sago-cloud/jobs/postgres/verify-backup
```

Install or refresh systemd units after changing the operations checkout:

```bash
scripts/install-health-watch-timer
scripts/install-postgres-backup-timers
```

The health-watch installer copies the watcher and its shell dependency into a
content-addressed, root-owned release under
`/usr/local/libexec/sago-cloud-health-watch`, then atomically activates that
release. Updating the operations checkout does not change the code executed by
the root service until this explicit installation step succeeds.

The health watcher finds managed containers using the
`dev.hsichen.sago-cloud.managed=true` label, so it works across independent
Compose projects.

## Host Access

Run `scripts/install-ssh-hardening` to install the versioned sshd policy. It
disables root login and X11 forwarding, allows only the `ubuntu` account, and
limits authentication attempts to three. The installer validates the complete
sshd configuration before reloading the service.

Administrative SSH uses Tailscale. Configure the local `sago-cloud` SSH alias to
the VM's Tailscale MagicDNS name and confirm `ssh sago-cloud` succeeds before
running deployment or maintenance commands. Do not expose TCP 22 in the OCI
security list. During the Cloudflare Tunnel transition, TCP 80 and 443 remain
public for Caddy. Close both ports only after temporary Tunnel hostnames,
production DNS, Clerk callbacks, OBI connections, and public health checks pass.

## Cloudflare ingress

Create `/srv/sago-cloud/secrets/cloudflared.env` from the public example, then
deploy the Tunnel separately. Configure its public hostnames in Cloudflare to
use `http://edge:80`; `cloudflared` and Caddy share the private frontend Docker
network. No Tunnel credential or provider token is stored in this repository.

Cache only immutable Homepage assets such as `/_next/static/*`. Explicitly
bypass `/api/*`, authenticated HTML, session-bearing responses, and private
wallpapers. Preserve the origin's `private` and `no-store` headers. Apply the
single free rate-limit rule to the wallpaper-upload endpoint before considering
broader rules.

Verify the public path with:

```bash
HOMEPAGE_URL=https://homepage.example.com \
OBI_URL=https://obi.example.com \
  scripts/verify-public-ingress
```

After DNS is stable and direct HTTP/S ingress is closed, remove the `ports`
mapping from `edge/compose.yaml` in the cutover PR. Keep Tailscale as the
administrative path.

## Secrets

Create production files from `env/*.env.example` under
`/srv/sago-cloud/secrets`. Expected files are:

```text
proxy.env
cloudflared.env
bot-core.env
homepage.env
minisago-worker.env
obi.env
postgres.env
```

Container logs rotate at 10 MB with three files retained per service. PostgreSQL
backups retain seven daily dumps and four weekly dumps under
`/srv/sago-cloud/backups/postgres`.

## Post-rollback cleanup

Compatibility resources are retained until July 25, 2026 at 20:42
Asia/Taipei. After health and PostgreSQL restore verification, run the
allowlisted cleanup explicitly:

```bash
SAGO_CLOUD_ROLLBACK_CLEANUP_CONFIRMED=yes scripts/cleanup-post-rollback
```

The script removes only named legacy volumes, empty legacy networks, migration
staging paths, retired secret files, and the compatibility symlink. It never
prunes Docker volumes. Successful Compose starts prune dangling images; tagged
images and persistent volumes remain.

## ARM migration

Follow [ARM Migration](ARM-MIGRATION.md) to provision the A1 host, export and
restore persistent state, rehearse Sago Cloud, cut over DNS and Obsidian, and
retain the x86 hosts for rollback before retirement.
