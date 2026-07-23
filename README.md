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
/srv/pr-media/             # dedicated, bounded PR-media filesystem
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
- `minisago-worker`: one always-on `chat,dev` Codex worker. It mounts one
  repo-scoped GitHub login, broker secret, state volume, and disposable
  workspace. It can publish bounded PR images and videos through the
  `pr-media-upload` command.
- `homepage`: the ARM64 Homepage image, attached only to the frontend
  network. Authentication, bookmarks, and private wallpaper storage live in
  Supabase.
- `obi`: CouchDB for Obsidian LiveSync.
- `postgres`: offline legacy PostgreSQL, excluded from `deploy:all`. Its private
  volume, verified dump, and explicit recovery commands remain available until
  the Homepage rollback window closes.

Caddy discovers services through role-based network aliases. `/bot/*` is the
neutral bot route, and `/` routes to `bot-core`.

The co-located worker reaches `bot-core` through its private frontend-network
alias. This avoids relying on public-IP hairpin routing from the A1 VM.

The worker uses one dedicated `gh` login. The broker binds its secret to
`oracle`/`chat,dev`, while Codex restricts every job to its selected checkout.
Only owner requests can route to Sol. Remote mutation requires an explicit
owner request, protected branches reject direct and force pushes, and provider
credentials are not mounted.

## PR media

PR screenshots and short demo videos live on a dedicated 10 GiB ext4 filesystem
instead of the host root filesystem. The filesystem is backed by a sparse image
under `/srv/sago-cloud/state`, mounted with `nodev,nosuid,noexec,discard`, and
cannot consume more than its configured capacity. Discard returns blocks from
expired files to the host filesystem, so physical usage follows live media
rather than historical uploads. Caddy mounts it read-only; the MiniSago worker
mounts it read-write. Docker requires the dedicated mount at boot and will not
fall back to writing through the underlying host directory.

Provision the filesystem and its daily capacity-check timer once, before
deploying the edge or worker stacks:

```bash
bun run install:pr-media
```

Set `PR_MEDIA_BASE_URL` in `secrets/minisago-worker.env` to the public media
route, such as `https://bot.example.com/media`. From an agent job, publish a
supported file and paste the returned Markdown into the PR body:

```bash
pr-media-upload /workspace/worktrees/example/screenshot.png
```

Uploads accept PNG, JPEG, GIF, WebP, MP4, and WebM files. Images are limited to
50 MiB and videos to 100 MiB by default. Content-addressed names deduplicate
identical files, and Caddy refuses other extensions. Media does not expire while
the filesystem is below 90% capacity. At 90%, the oldest files are removed until
usage falls to 85%, leaving room for new uploads while preserving recent PR
artifacts.

Homepage is the only public service configured to use the local PostgreSQL
alias. Its one-shot migration container attaches only to `sago_cloud_data`; the
application attaches separately to `sago_cloud_data` for PostgreSQL and
`sago_cloud_edge` for Caddy. Other public services remain off the data network.

## Images

Application repositories build Linux ARM64 images on native ARM64 GitHub
Actions runners and publish both `main` and immutable `sha-<commit>` tags:

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
scripts/install-public-ingress-timer
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
security list. Caddy has no published host ports after the verified Cloudflare
Tunnel cutover; `cloudflared` is its only public ingress path.

## Cloudflare ingress

Create a locally managed Tunnel, then place its private files at
`/srv/sago-cloud/secrets/cloudflared/config.yml` and
`/srv/sago-cloud/secrets/cloudflared/credentials.json`. Start from the public
config example and route each public hostname to `https://edge:443`, setting
`originServerName` to the matching public hostname so Caddy's certificate is
verified;
`cloudflared` and Caddy share the private frontend Docker network. No Tunnel
identifier, credential, or provider token is stored in this repository.

Keep the directory traversable by the host deploy user and the files readable
only by the image's non-root user:

```bash
sudo chown ubuntu:65532 /srv/sago-cloud/secrets/cloudflared
sudo chmod 0710 /srv/sago-cloud/secrets/cloudflared
sudo chown 65532:65532 /srv/sago-cloud/secrets/cloudflared/{config.yml,credentials.json}
sudo chmod 0600 /srv/sago-cloud/secrets/cloudflared/{config.yml,credentials.json}
```

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

For continuous end-to-end verification, copy
`env/public-ingress.env.example` to
`/srv/sago-cloud/secrets/public-ingress.env`, set the two public HTTPS origins,
their expected HTTP statuses, and run `scripts/install-public-ingress-timer`.
The default expectations are `200` for Homepage and OBI's intentional
unauthenticated `401`. The timer checks both public paths through Cloudflare
every five minutes and records failures in the systemd journal. Cloudflare
Tunnel health notifications independently alert when the connector becomes
degraded or unavailable.

The edge trusts forwarding headers only from private-network peers, reads
`CF-Connecting-IP` before `X-Forwarded-For`, uses strict proxy-chain parsing,
and emits structured access logs for every public site. This is safe only while
Caddy remains unexposed and `cloudflared` is its sole public ingress.

Keep Tailscale as the administrative path and remove any now-redundant OCI
ingress rules for TCP 80 and 443 after verifying the tunnel from an external
network.

## Secrets

Create production files from `env/*.env.example` under
`/srv/sago-cloud/secrets`. Expected files are:

```text
proxy.env
cloudflared/config.yml
cloudflared/credentials.json
bot-core.env
homepage.env
minisago-worker.env
obi.env
postgres.env
public-ingress.env
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
