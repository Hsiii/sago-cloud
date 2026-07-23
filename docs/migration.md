# Migration and Rollback

## Legacy namespace migration

Hosts using the legacy `/srv/platform` namespace can migrate with:

```bash
SAGO_CLOUD_MIGRATION_CONFIRMED=yes scripts/migrate-sago-cloud
```

The migration creates a final PostgreSQL backup, stops the old stacks, moves
the runtime root, copies persistent volumes into the Sago Cloud namespace, and
starts the renamed stacks and timers. It retains a `/srv/platform`
compatibility symlink and the old volumes for rollback until cleanup.

## Host rename

After the migrated runtime is healthy, align the Linux and Tailscale hostnames:

```bash
SAGO_CLOUD_HOST_RENAME_CONFIRMED=yes scripts/rename-sago-cloud-host
```

Rename the OCI instance display name separately in Oracle Cloud. Changing the
display name does not alter the instance OCID.

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
