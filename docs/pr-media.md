# Media deployment

Sago Cloud deploys the product published by
[`Hsiii/sago-media`](https://github.com/Hsiii/sago-media). Product behavior, authentication,
the npm client, and native clients belong to that repository.

## Runtime boundary

The `pr-media-api` stack pulls the versioned
`ghcr.io/hsiii/sago-media:v0.2.1` image. Sago Cloud supplies only:

- a dedicated, bounded filesystem at `/srv/pr-media`;
- runtime secrets and GitHub OAuth configuration;
- private container networking and Caddy routes;
- health checks and resource limits;
- systemd schedules that run the image's prune and verify commands.
- daily backups of authentication state retained for 30 days outside the media
  filesystem.

Override `MEDIA_IMAGE` during deployment to select another immutable release.
The VM never builds media application source.

## Provision and deploy

Create the bounded 10 GiB ext4 filesystem once:

```bash
bun run install:pr-media
```

Copy `env/pr-media-api.env.example` to
`/srv/sago-cloud/secrets/pr-media-api.env`, fill in the OAuth and owner values,
then deploy:

```bash
bun run deploy:pr-media-api
bun run deploy:edge
```

The deployment starts the maintenance timers only after the service health
check succeeds. Static content is served directly by Caddy with immutable cache
headers; API, login, activation, and admin routes are proxied without caching.

## Operations

```bash
bun run status
ssh sago-cloud systemctl status sago-cloud-pr-media-prune.timer
ssh sago-cloud systemctl status sago-cloud-pr-media-verify.timer
ssh sago-cloud systemctl status sago-cloud-pr-media-backup.timer
```

The timers execute `pr-media-prune` and `pr-media-verify` inside the running
product container. Their implementation and retention policy therefore remain
versioned with the product image, while Sago Cloud owns when and where they run.
The backup timer serializes and verifies `.service/media.sqlite` into
`/srv/sago-cloud/backups/pr-media`.
