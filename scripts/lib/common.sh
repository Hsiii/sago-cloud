#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ORACLE_ROOT="${ORACLE_ROOT:-"$(cd -- "$script_dir/../.." && pwd)"}"
APPS_ROOT="${APPS_ROOT:-"$ORACLE_ROOT/../apps"}"
COMPOSE_FILE="${COMPOSE_FILE:-"$ORACLE_ROOT/compose.yaml"}"
NETWORK_NAME="${NETWORK_NAME:-bots_shared}"

ensure_docker_network() {
  if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    docker network create "$NETWORK_NAME" >/dev/null
  fi
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
  docker compose -f "$COMPOSE_FILE" up -d --build "$@"
}

compose_ps() {
  docker compose -f "$COMPOSE_FILE" ps
}
