#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OPERATIONS_ROOT="${OPERATIONS_ROOT:-"$(cd -- "$script_dir/../.." && pwd)"}"
SAGO_CLOUD_ROOT="${SAGO_CLOUD_ROOT:-"$(cd -- "$OPERATIONS_ROOT/.." && pwd)"}"
SECRETS_ROOT="${SECRETS_ROOT:-"$SAGO_CLOUD_ROOT/secrets"}"
BACKUPS_ROOT="${BACKUPS_ROOT:-"$SAGO_CLOUD_ROOT/backups"}"
STATE_ROOT="${STATE_ROOT:-"$SAGO_CLOUD_ROOT/state"}"
EDGE_NETWORK_NAME="${EDGE_NETWORK_NAME:-sago_cloud_edge}"
DATA_NETWORK_NAME="${DATA_NETWORK_NAME:-sago_cloud_data}"
NETWORK_NAMES=("$EDGE_NETWORK_NAME" "$DATA_NETWORK_NAME")
STACKS=(postgres bot-core homepage obi minisago-worker edge)
VOLUME_NAMES=(
  sago_cloud_caddy-data
  sago_cloud_caddy-config
  sago_cloud_bot-core-state
  sago_cloud_postgres-data
  sago_cloud_obi-data
  sago_cloud_obi-config
  sago_cloud_minisago-codex
  sago_cloud_minisago-github
  sago_cloud_minisago-state
  sago_cloud_minisago-workspace
)

export OPERATIONS_ROOT SAGO_CLOUD_ROOT SECRETS_ROOT BACKUPS_ROOT STATE_ROOT
export EDGE_NETWORK_NAME DATA_NETWORK_NAME

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(sudo -n docker)
fi

stack_file() {
  case "$1" in
    edge) printf '%s/edge/compose.yaml\n' "$OPERATIONS_ROOT" ;;
    *) printf '%s/services/%s/compose.yaml\n' "$OPERATIONS_ROOT" "$1" ;;
  esac
}

compose() {
  local stack="$1"
  shift
  "${DOCKER[@]}" compose -f "$(stack_file "$stack")" "$@"
}

ensure_docker_networks() {
  local network_name

  for network_name in "${NETWORK_NAMES[@]}"; do
    if ! "${DOCKER[@]}" network inspect "$network_name" >/dev/null 2>&1; then
      "${DOCKER[@]}" network create "$network_name" >/dev/null
    fi
  done
}

ensure_docker_volumes() {
  local volume_name

  for volume_name in "${VOLUME_NAMES[@]}"; do
    if ! "${DOCKER[@]}" volume inspect "$volume_name" >/dev/null 2>&1; then
      "${DOCKER[@]}" volume create "$volume_name" >/dev/null
    fi
  done
}

compose_pull() {
  compose "$1" pull
}

compose_up() {
  local stack="$1"
  ensure_docker_networks
  ensure_docker_volumes
  compose "$stack" up -d --remove-orphans
}
