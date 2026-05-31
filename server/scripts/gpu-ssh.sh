#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_FILE="${GPU_SERVERS_CONF:-$PROJECT_DIR/server/data/gpu-servers.conf}"
JUMP_HOST="${GPU_SSH_JUMP:-}"
SSH_ALIVE_INTERVAL="${GPU_SSH_ALIVE_INTERVAL:-30}"
SSH_ALIVE_COUNT_MAX="${GPU_SSH_ALIVE_COUNT_MAX:-6}"
CONTROL_PATH="${GPU_SSH_CONTROL_PATH:-$HOME/.ssh/gpu-tmux-%C}"
IDENTITY_FILE="${GPU_SSH_IDENTITY:-}"
REMOTE_BASHRC="${GPU_REMOTE_BASHRC:-}"
USE_SSH_TARGET="${GPU_SSH_USE_TARGET:-0}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") list
  $(basename "$0") <machine|short-name|ip> [remote-command...]
  $(basename "$0") --all [remote-command...]

Examples:
  $(basename "$0") worker-3 'hostname; nvidia-smi'
  $(basename "$0") --all 'nvidia-smi --query-gpu=index,utilization.gpu,memory.used --format=csv,noheader,nounits'

Config: $CONFIG_FILE
EOF
}

require_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Config file not found: $CONFIG_FILE" >&2
    echo "Copy server/data/gpu-servers.example.conf to server/data/gpu-servers.conf and edit it." >&2
    exit 1
  fi
}

quote_cmd() {
  local out="" item
  for item in "$@"; do
    printf -v item "%q" "$item"
    out="${out}${out:+ }${item}"
  done
  printf "%s" "$out"
}

ssh_proxy_command() {
  local control_path
  control_path="${CONTROL_PATH//%/%%}"
  printf "ssh -q -o ControlMaster=auto -o ControlPersist=12h -o ControlPath=%s -o ServerAliveInterval=%s -o ServerAliveCountMax=%s -o TCPKeepAlive=yes %s nc %%h %%p" \
    "$control_path" "$SSH_ALIVE_INTERVAL" "$SSH_ALIVE_COUNT_MAX" "$JUMP_HOST"
}

ssh_args_for() {
  local ip="$1" user="$2" port="$3" target="$4"
  local connect_target="$user@$ip"
  SSH_ARGS=(
    -T
    -o BatchMode=yes
    -o ConnectTimeout=8
    -o ConnectionAttempts=1
    -o NumberOfPasswordPrompts=0
    -o ServerAliveInterval="$SSH_ALIVE_INTERVAL"
    -o ServerAliveCountMax="$SSH_ALIVE_COUNT_MAX"
    -o TCPKeepAlive=yes
  )
  if [ "$USE_SSH_TARGET" = "1" ]; then
    connect_target="$target"
  fi
  if [ -n "$JUMP_HOST" ] && [[ "$connect_target" == *@*.* || "$connect_target" == *.*.*.* ]]; then
    SSH_ARGS+=(
      -o StrictHostKeyChecking=no
      -o UserKnownHostsFile=/dev/null
      -o ControlMaster=auto
      -o ControlPersist=12h
      -o ControlPath="$CONTROL_PATH"
      -o ProxyCommand="$(ssh_proxy_command)"
    )
    if [ -n "$IDENTITY_FILE" ]; then
      SSH_ARGS+=(-i "$IDENTITY_FILE" -o IdentitiesOnly=yes)
    fi
    SSH_ARGS+=(-p "$port" "$connect_target")
  else
    SSH_ARGS+=("$connect_target")
  fi
}

server_matches() {
  local query="$1" group="$2" name="$3" ip="$4" target="$5"
  local short="$name"
  if [[ "$name" == "$group-"* ]]; then
    short="${name#"$group-"}"
  fi
  [ "$query" = "$name" ] || [ "$query" = "$short" ] || [ "$query" = "$ip" ] || [ "$query" = "$target" ]
}

list_servers() {
  require_config
  while read -r group role name ip user port target rest; do
    case "${group:-}" in ""|\#*) continue ;; esac
    target="${target:-$user@$ip}"
    printf "%-34s %-10s %-15s %s\n" "$name" "$role" "$ip" "$target"
  done < "$CONFIG_FILE"
}

remote_prefix() {
  if [ -n "$REMOTE_BASHRC" ]; then
    cat <<EOF
if [ -f "$REMOTE_BASHRC" ]; then
  . "$REMOTE_BASHRC" >/dev/null 2>&1 || true
fi
EOF
  fi
}

run_server() {
  local group="$1" role="$2" name="$3" ip="$4" user="$5" port="$6" target="$7"
  shift 7
  ssh_args_for "$ip" "$user" "$port" "$target"
  if [ "$#" -eq 0 ]; then
    ssh -tt "${SSH_ARGS[@]}" "$(remote_prefix) exec bash -i"
    return
  fi
  local remote_body
  if [ "$#" -eq 1 ]; then
    remote_body="$1"
  else
    remote_body="$(quote_cmd "$@")"
  fi
  ssh -n "${SSH_ARGS[@]}" "$(remote_prefix)
${remote_body}"
}

run_matching() {
  local query="$1"
  shift
  local found=0
  require_config
  while read -r group role name ip user port target rest; do
    case "${group:-}" in ""|\#*) continue ;; esac
    target="${target:-$user@$ip}"
    if server_matches "$query" "$group" "$name" "$ip" "$target"; then
      found=1
      run_server "$group" "$role" "$name" "$ip" "$user" "$port" "$target" "$@"
      break
    fi
  done < "$CONFIG_FILE"
  if [ "$found" -eq 0 ]; then
    echo "No matching machine: $query" >&2
    exit 1
  fi
}

run_all() {
  require_config
  while read -r group role name ip user port target rest; do
    case "${group:-}" in ""|\#*) continue ;; esac
    target="${target:-$user@$ip}"
    printf "\n== %s (%s) ==\n" "$name" "$ip"
    if ! run_server "$group" "$role" "$name" "$ip" "$user" "$port" "$target" "$@"; then
      printf "command failed on %s\n" "$name" >&2
    fi
  done < "$CONFIG_FILE"
}

case "${1:-}" in
  -h|--help|help|"")
    usage
    ;;
  list)
    list_servers
    ;;
  --all)
    shift
    run_all "$@"
    ;;
  *)
    machine="$1"
    shift
    run_matching "$machine" "$@"
    ;;
esac
