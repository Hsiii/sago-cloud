# Platform Operations

Runtime wiring for the shared Oracle compute host. Platform resources are named
by role so applications can be renamed, replaced, or split without changing the
host, edge network, deployment tooling, or backup layout.

## Host Layout

```text
/srv/platform/
  operations/          # this repository
  edge/                 # symlink to operations/edge
  services/             # symlink to operations/services
  jobs/                 # symlink to operations/jobs
  artifacts/            # uploaded runtime artifacts
  secrets/              # production env files, never committed
  backups/
  state/
```

Run `scripts/install-layout` after cloning this repository to
`/srv/platform/operations`. It creates the runtime links, the `platform_edge`
frontend network, the isolated `platform_data` database network, and external
volumes.

## Runtime Stacks

Each workload is an independent Docker Compose project. Public services attach
to the external `platform_edge` frontend network, while PostgreSQL attaches only
to the external `platform_data` network:

- `edge`: Caddy and public TLS routing.
- `bot-core`: the current Discord bot runtime, published by MiniSago.
- `recipes`: the recipe archive.
- `homepage`: the uploaded homepage artifact.
- `postgres`: private PostgreSQL, isolated from the public-service network.

Caddy discovers services through role-based network aliases. `/bot/*` is the
neutral bot route, and `/` routes to `bot-core`.

No current service is configured to use the local PostgreSQL alias. A future
database client must be explicitly attached to `platform_data`; it should keep
its separate `platform_edge` attachment only when Caddy also needs to reach it.

## Images

Application repositories build Linux AMD64 images in GitHub Actions and publish
both `main` and immutable `sha-<commit>` tags:

```text
ghcr.io/hsiii/minisago
ghcr.io/hsiii/recipes
```

The VM only pulls images and starts containers; it does not clone or build
application source. Authenticate Docker on the VM with a GitHub token limited to
`read:packages` before the first pull of private images.

## Deployments

From this repository:

```bash
bun run deploy:all
bun run deploy:edge
bun run deploy:bot-core
bun run deploy:recipes
bun run deploy:homepage
bun run deploy:postgres
bun run status
```

The app repositories wait for their image workflow and then invoke the matching
remote deploy command. Deploying this operations repository first fast-forwards
the VM checkout, then runs the selected stack command. Compatibility shell
wrappers remain for the previous `proxy` and `recipe` command names.

## Scheduled Jobs

One-shot work is separate from service definitions:

```text
/srv/platform/jobs/postgres/backup
/srv/platform/jobs/postgres/verify-backup
```

Install or refresh systemd units after changing the operations checkout:

```bash
scripts/install-health-watch-timer
scripts/install-postgres-backup-timers
```

The health-watch installer copies the watcher and its shell dependency into a
content-addressed, root-owned release under
`/usr/local/libexec/platform-health-watch`, then atomically activates that
release. Updating the operations checkout does not change the code executed by
the root service until this explicit installation step succeeds.

The health watcher finds managed containers using the
`dev.hsichen.platform.managed=true` label, so it works across independent
Compose projects.

## Host Access

Run `scripts/install-ssh-hardening` to install the versioned sshd policy. It
disables root login and X11 forwarding, allows only the `ubuntu` account, and
limits authentication attempts to three. The installer validates the complete
sshd configuration before reloading the service.

Administrative SSH uses Tailscale. Configure the local `platform` SSH alias to
the VM's Tailscale MagicDNS name and confirm `ssh platform` succeeds before
running deployment or maintenance commands. Do not expose TCP 22 in the OCI
security list; TCP 80 and 443 remain public for Caddy.

## Secrets

Create production files from `env/*.env.example` under
`/srv/platform/secrets`. Expected files are:

```text
proxy.env
bot-core.env
recipe.env
homepage.env
postgres.env
```

Container logs rotate at 10 MB with three files retained per service. PostgreSQL
backups retain seven daily dumps and four weekly dumps under
`/srv/platform/backups/postgres`.
