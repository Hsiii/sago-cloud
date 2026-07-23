# ARM Migration

The migration consolidated the legacy `oracle-platform` and `oracle-obi` hosts onto a fresh OCI
Ampere A1 host. Keep both x86 hosts running until the ARM rehearsal passes, then
keep them stopped and intact during the rollback window.

## 1. Release prerequisites

Merge and publish these application changes before provisioning:

- MiniSago core and worker images for `linux/amd64` and `linux/arm64`.
- Homepage image for `linux/amd64` and `linux/arm64`.
- This Sago Cloud release with the managed worker, Homepage image, and OBI stack.

Recipes is intentionally retired. Export `recipe-site_uploads` once for archival
purposes, but do not restore or start the service on ARM.

## 2. OCI guardrails and instance

Wait until the tenancy shows Pay As You Go. In Limits, Quotas and Usage, verify
that `free-guard` leaves no more than:

```text
A1 cores: 2 OCPUs
A1 memory: 12 GB
Block and boot storage: 200 GB total
Volume backups: 5
```

Only then create an Ubuntu AArch64 `VM.Standard.A1.Flex` instance in the home
region with 2 OCPUs, 4 GB RAM, and a 50 GB boot volume. Use the existing VCN,
restrict temporary SSH to the administrator, install Docker Engine with the
Compose plugin, join Tailscale, and clone this repository to
`/srv/sago-cloud/operations`.

Run `scripts/install-layout`, install the health and PostgreSQL timers, apply
SSH hardening after Tailscale access works, and authenticate Docker for the
private GHCR images.

## 3. Export source state

Create a mode-0700 migration directory outside the repositories. Run the
PostgreSQL backup job and copy its latest verified dump. Export these Sago Cloud
volumes with `scripts/export-volume`:

```text
sago_cloud_caddy-data
sago_cloud_caddy-config
sago_cloud_bot-core-state
source_minisago-codex
source_minisago-github
source_minisago-state
recipe-site_uploads
```

Archive `/srv/sago-cloud/state/minisago-worker/source/workspace` separately for
the new `sago_cloud_minisago-workspace` volume. Copy `/srv/sago-cloud/secrets` over
an encrypted Tailscale/SSH connection without printing its contents. Copy
`/srv/videos` as well when it contains files; the retired Homepage host artifact
does not need to migrate.

On `oracle-obi`, export:

```text
obi-sync_couchdb-data
obi-sync_couchdb-config
```

The standalone OBI Caddy volumes are not needed because the consolidated edge
obtains and stores the replacement certificate.

## 4. Restore and rehearse

Copy the encrypted migration directory to the ARM host. Restore volume archives
with `SAGO_CLOUD_RESTORE_CONFIRMED=yes scripts/import-volume`, using this mapping:

| Source                    | ARM target                    |
| ------------------------- | ----------------------------- |
| `sago_cloud_caddy-data`     | `sago_cloud_caddy-data`         |
| `sago_cloud_caddy-config`   | `sago_cloud_caddy-config`       |
| `sago_cloud_bot-core-state` | `sago_cloud_bot-core-state`     |
| `source_minisago-codex`   | `sago_cloud_minisago-codex`     |
| `source_minisago-github`  | `sago_cloud_minisago-github`    |
| `source_minisago-state`   | `sago_cloud_minisago-state`     |
| worker workspace archive  | `sago_cloud_minisago-workspace` |
| `obi-sync_couchdb-data`   | `sago_cloud_obi-data`           |
| `obi-sync_couchdb-config` | `sago_cloud_obi-config`         |

Restore PostgreSQL from the verified logical dump rather than copying its data
directory:

```bash
SAGO_CLOUD_RESTORE_CONFIRMED=yes scripts/restore-postgres /path/to/postgres.dump
```

Verify `codex login status` and `gh auth status` inside the worker;
reauthenticate interactively if either copied session is rejected.

The worker keeps one dedicated GitHub CLI login in
`sago_cloud_minisago-github`. Chat and owner-only dev routing share that worker;
remote mutation still requires an owner-derived operation scope. Verify
`gh auth status`, keep protected branches non-bypassable, and do not mount
provider credentials.

Start PostgreSQL, bot-core, Homepage, OBI, and the worker before edge. Confirm
container health, the MiniSago worker connection and capacity, Homepage health,
CouchDB `_up`, PostgreSQL restore verification, and the architecture of every
private image. Exercise owner chat, Luna-to-Sol routing, a read-only GitHub
request, and two concurrent worker jobs.

## 5. Cutover

Lower relevant DNS TTLs before the maintenance window. At cutover:

1. Stop writes on the x86 services.
2. Create a final PostgreSQL dump and final state/OBI exports.
3. Run `RETIRE_RECIPES_CONFIRMED=yes scripts/retire-recipes` on the old host
   after its uploads archive is safely off-host.
4. Restore only the changed data on ARM and repeat health checks.
5. Move the reserved public IP or update DNS for Sago Cloud, Homepage, and
   `OBI_DOMAIN`.
6. Change the Obsidian LiveSync endpoint to the new OBI hostname and verify a
   two-way sync before resuming normal use.
7. Stop, but do not terminate, the two x86 VMs.

Keep the old VMs and their boot volumes for at least 72 hours. If the ARM host
fails validation, restore DNS/endpoints and restart the x86 services.

## 6. Retirement and expansion

After the rollback window, retain the Recipes volume archive, remove the old
VMs and their boot volumes, and archive the Recipes GitHub repository. Verify
free storage capacity before expanding the A1 VM to 12 GB RAM and a 100–150 GB
boot volume. OCI boot volumes can grow but cannot shrink, so keep at least 50 GB
of the 200 GB allowance free for recovery.
