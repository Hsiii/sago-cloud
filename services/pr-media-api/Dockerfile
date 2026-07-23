FROM oven/bun:1.3.9-debian

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    file \
    jpegoptim \
    libimage-exiftool-perl \
    optipng \
    util-linux \
    webp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chmod=755 scripts/pr-media-optimize /usr/local/bin/pr-media-optimize
COPY --chmod=755 scripts/pr-media-prune /usr/local/bin/pr-media-prune
COPY --chmod=755 scripts/pr-media-upload /usr/local/bin/pr-media-upload
COPY services/pr-media-api/server.ts /app/server.ts

ENV PR_MEDIA_ROOT=/srv/pr-media
ENV PR_MEDIA_MAX_VIDEO_BYTES=95000000

EXPOSE 3000

CMD ["bun", "/app/server.ts"]
