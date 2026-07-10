#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ORACLE_ROOT="${ORACLE_ROOT:-"$(cd -- "$script_dir/../.." && pwd)"}"
APPS_ROOT="${APPS_ROOT:-"$ORACLE_ROOT/../apps"}"
COMPOSE_FILE="${COMPOSE_FILE:-"$ORACLE_ROOT/compose.yaml"}"
NETWORK_NAME="${NETWORK_NAME:-bots_shared}"
VOLUME_NAMES=(
  proxy_caddy-data
  proxy_caddy-config
  wm31bot_wm31bot-state
  morning_morning-dashboard-state
  recipe_recipe-site-uploads
  oracle_postgres-data
)

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
  "${DOCKER[@]}" compose -f "$COMPOSE_FILE" up -d --build "$@"
}

compose_ps() {
  "${DOCKER[@]}" compose -f "$COMPOSE_FILE" ps
}
