# PR Media

The PR-media service publishes screenshots and short demo videos without
allowing them to consume the host root filesystem.

## Storage

Media lives on a dedicated 10 GiB ext4 filesystem mounted at `/srv/pr-media`.
It is backed by a sparse image under `/srv/sago-cloud/state` and mounted with
`nodev,nosuid,noexec,discard`. Discard returns expired blocks to the host
filesystem, so physical use follows live media rather than historical uploads.

Caddy mounts the filesystem read-only. The MiniSago worker and upload API mount
it read-write. Docker requires the dedicated mount at boot and will not fall
back to the underlying host directory.

Provision the filesystem and its capacity timer before deploying the edge,
worker, or API:

```bash
bun run install:pr-media
```

Give media its own proxied Cloudflare hostname, separate from the bot origin and
its cookies. Set `MEDIA_DOMAIN` in `secrets/proxy.env` and
`PR_MEDIA_BASE_URL` in `secrets/minisago-worker.env`.

## Uploading from the worker

Publish a supported file from an agent job:

```bash
pr-media-upload \
  --repo Hsiii/example \
  --pr 123 \
  /workspace/worktrees/example/screenshot.png
```

From a branch with an open PR, detect the repository and PR and append the
returned Markdown to a managed section of the existing body:

```bash
pr-media-upload --update-pr-body screenshot.png
```

Repeated uploads are content-deduplicated. Repeated PR-body updates do not
duplicate the media entry, and existing PR content remains untouched.

## Remote uploads and tokens

Remote Codex installations use `POST /api/upload` through the public media
hostname. Each person receives a separately revocable bearer token. Tokens are
stored on Oracle only as SHA-256 hashes and default to 50 uploads and 500 MB per
UTC day. Public API videos are capped at 95 MB to stay below Cloudflare's
100 MB request limit.

Manage tokens on Oracle:

```bash
scripts/pr-media-token create alice
scripts/pr-media-token list
scripts/pr-media-token revoke alice
```

Send the generated configuration through a secure channel. The
`human-out-of-loop` PR skill stores it at `~/.config/pr-media/config`; it never
places the bearer token in a PR, command argument, or repository.

## Validation and optimization

Uploads validate file contents and accept PNG, JPEG, GIF, WebP, MP4, and WebM.
Images are limited to 50 MiB and videos to 100 MiB by default. Location and
other metadata is removed.

PNG optimization is lossless, JPEG quality is capped at 92, WebP and GIF pixels
are preserved, and video is normalized to H.264/AAC MP4 at CRF 20 with
fast-start metadata. Set `PR_MEDIA_OPTIMIZE=0` only for local diagnostics.

Content-addressed names deduplicate identical optimized files. Caddy serves
only exact hashed media paths with byte ranges and validators. One-year browser
and shared-cache directives let Cloudflare cache repeat downloads.

## Retention and integrity

Media does not expire below 90% capacity. At 90%, unreferenced media and media
whose referenced PRs are all closed are removed oldest-first until capacity
falls to 85%. Open PR media and media whose GitHub state cannot be checked are
protected.

At 95%, emergency cleanup removes the oldest unpinned media, including open-PR
media, until capacity falls to 80%. Pin long-lived media to protect it from both
cleanup stages:

```bash
pr-media-pin https://media.example.com/ab/<hash>.png
pr-media-pin --remove https://media.example.com/ab/<hash>.png
```

The cleanup timer checks PR state through the Oracle user's authenticated GitHub
CLI configuration and emits an event for every eviction. A weekly integrity
pass recomputes every object's SHA-256 digest and fails in the systemd journal
when contents no longer match the content-addressed filename.

Check current capacity, object counts, and timer status with:

```bash
bun run status
```
