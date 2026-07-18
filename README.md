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
network, and external volumes. During migration it copies `minisago.env` to
`bot-core.env` when the neutral file does not exist.

## Runtime Stacks

Each workload is an independent Docker Compose project attached to the external
`platform_edge` network:

- `edge`: Caddy and public TLS routing.
- `bot-core`: the current Discord bot runtime, published by MiniSago.
- `brawl-claimer`: the Brawl Stars Store dashboard and claim runtime.
- `recipes`: the recipe archive.
- `homepage`: the uploaded homepage artifact.
- `postgres`: private PostgreSQL for services that need it.

Caddy discovers services through role-based network aliases. `/bot/*` is the
neutral bot route, and `/` routes to `bot-core`.

## Images

Application repositories build Linux AMD64 images in GitHub Actions and publish
both `main` and immutable `sha-<commit>` tags:

```text
ghcr.io/hsiii/minisago
ghcr.io/hsiii/brawl-stars-store-claimer
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
bun run deploy:brawl-claimer
bun run deploy:recipes
bun run deploy:homepage
bun run deploy:postgres
bun run status
```

The app repositories wait for their image workflow and then invoke the matching
remote deploy command. Deploying this operations repository first fast-forwards
the VM checkout, then runs the selected stack command. Compatibility shell
wrappers remain for the previous `proxy`, `minisago`, `brawlstars`, `morning`,
and `recipe` command names.

## Scheduled Jobs

One-shot work is separate from service definitions:

```text
/srv/platform/jobs/brawl-claimer/claim
/srv/platform/jobs/postgres/backup
/srv/platform/jobs/postgres/verify-backup
```

Install or refresh systemd units after changing the operations checkout:

```bash
scripts/install-health-watch-timer
scripts/install-brawlstars-claim-timer --disable
scripts/install-postgres-backup-timers
```

The health watcher finds managed containers using the
`dev.hsichen.platform.managed=true` label, so it works across independent
Compose projects.

## Host Access

Run `scripts/install-ssh-hardening` to install the versioned sshd policy. It
disables root login and X11 forwarding, allows only the `ubuntu` account, and
limits authentication attempts to three. The installer validates the complete
sshd configuration before reloading the service.

Keep TCP 22 restricted in the OCI security list to trusted source addresses or
a private access network. TCP 80 and 443 remain public for Caddy.

## Secrets

Create production files from `env/*.env.example` under
`/srv/platform/secrets`. Expected files are:

```text
proxy.env
bot-core.env
brawl-claimer.env
recipe.env
homepage.env
postgres.env
```

Container logs rotate at 10 MB with three files retained per service. PostgreSQL
backups retain seven daily dumps and four weekly dumps under
`/srv/platform/backups/postgres`.
