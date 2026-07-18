#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT="${INFRA_ROOT:-"$(cd -- "$script_dir/../.." && pwd)"}"
PLATFORM_ROOT="${PLATFORM_ROOT:-"$(cd -- "$INFRA_ROOT/.." && pwd)"}"
APPS_ROOT="${APPS_ROOT:-"$PLATFORM_ROOT/apps"}"
ARTIFACTS_ROOT="${ARTIFACTS_ROOT:-"$PLATFORM_ROOT/artifacts"}"
SECRETS_ROOT="${SECRETS_ROOT:-"$PLATFORM_ROOT/secrets"}"
BACKUPS_ROOT="${BACKUPS_ROOT:-"$PLATFORM_ROOT/backups"}"
STATE_ROOT="${STATE_ROOT:-"$PLATFORM_ROOT/state"}"
COMPOSE_FILE="${COMPOSE_FILE:-"$INFRA_ROOT/compose.yaml"}"
NETWORK_NAME="${NETWORK_NAME:-platform_shared}"
VOLUME_NAMES=(
  platform_caddy-data
  platform_caddy-config
  wm31_state
  brawl-stars-claimer_state
  recipe-site_uploads
  platform_postgres-data
)

export INFRA_ROOT PLATFORM_ROOT APPS_ROOT ARTIFACTS_ROOT SECRETS_ROOT

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(sudo -n docker)
fi

ensure_docker_network() {
  if ! "${DOCKER[@]}" network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    "${DOCKER[@]}" network create "$NETWORK_NAME" >/dev/null
  fi
}

ensure_docker_volumes() {
  local volume_name

  for volume_name in "${VOLUME_NAMES[@]}"; do
    if ! "${DOCKER[@]}" volume inspect "$volume_name" >/dev/null 2>&1; then
      "${DOCKER[@]}" volume create "$volume_name" >/dev/null
    fi
  done
}

pull_repo() {
  local repo_path="$1"

  if [ ! -d "$repo_path/.git" ]; then
    printf 'Expected git checkout at %s\n' "$repo_path" >&2
    return 1
  fi

  git -C "$repo_path" pull --ff-only
}

compose_up() {
  ensure_docker_volumes
  "${DOCKER[@]}" compose -f "$COMPOSE_FILE" up -d --build --remove-orphans "$@"
}

compose_ps() {
  "${DOCKER[@]}" compose -f "$COMPOSE_FILE" ps
}
