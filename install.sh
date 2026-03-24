#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[remote-codex install] %s\n' "$*"
}

fail() {
  printf '[remote-codex install] %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_brew_path() {
  if command_exists brew; then
    return
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_homebrew() {
  local brew_install_url="${REMOTE_CODEX_BREW_INSTALL_URL:-https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh}"
  log "Homebrew가 없어 설치를 진행합니다."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL "$brew_install_url")"
  ensure_brew_path
  command_exists brew || fail "Homebrew 설치 후 brew를 찾지 못했습니다."
}

ensure_node() {
  ensure_brew_path
  if ! command_exists node || ! command_exists npm; then
    command_exists brew || install_homebrew
    log "Node.js와 npm을 설치합니다."
    brew install node
    ensure_brew_path
  fi

  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [ "$node_major" -lt 20 ]; then
    command_exists brew || install_homebrew
    log "Node.js 20+가 필요하여 업그레이드합니다."
    brew install node
    ensure_brew_path
    node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
    if [ "$node_major" -lt 20 ]; then
      fail "Node.js 20+를 확보하지 못했습니다."
    fi
  fi
}

resolve_codex_bin() {
  local node_bin="$1"
  local package_root="$2"
  "$node_bin" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const packageRoot = process.argv[1];
    const packageJsonPath = require.resolve("@openai/codex/package.json", { paths: [packageRoot] });
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.codex;
    if (!relativeBin) {
      process.exit(1);
    }
    process.stdout.write(path.join(path.dirname(packageJsonPath), relativeBin));
  ' "$package_root"
}

ensure_codex_login() {
  local node_bin="$1"
  local package_root="$2"
  local codex_bin
  codex_bin="$(resolve_codex_bin "$node_bin" "$package_root")"

  log "Codex 로그인 상태를 확인합니다."
  if ! "$node_bin" "$codex_bin" login status >/dev/null 2>&1; then
    log "Codex 로그인이 필요합니다. 로그인 절차를 시작합니다."
    "$node_bin" "$codex_bin" login
  fi
}

write_command_shim() {
  local node_bin="$1"
  local cli_path="$2"
  local shim_dir="${REMOTE_CODEX_INSTALL_SHIM_DIR:-/usr/local/bin}"
  local shim_path="$shim_dir/remote-codex"

  log "명령어 shim을 ${shim_path} 에 설치합니다."
  sudo mkdir -p "$shim_dir"
  cat <<EOF | sudo tee "$shim_path" >/dev/null
#!/bin/sh
exec "$node_bin" "$cli_path" "\$@"
EOF
  sudo chmod 755 "$shim_path"
}

install_service() {
  local node_bin="$1"
  local cli_path="$2"

  log "launchd 서비스를 설치합니다."
  sudo env \
    REMOTE_CODEX_INSTALL_USER="$TARGET_USER" \
    REMOTE_CODEX_INSTALL_HOME="$TARGET_HOME" \
    REMOTE_CODEX_DATA_DIR="$STATE_DIR" \
    NPM_CONFIG_PREFIX="$NPM_PREFIX" \
    "$node_bin" "$cli_path" install-service
}

wait_for_health() {
  local health_url="${REMOTE_CODEX_INSTALL_HEALTH_URL:-http://127.0.0.1:3000/api/bootstrap}"
  if [ "${REMOTE_CODEX_INSTALL_SKIP_HEALTHCHECK:-0}" = "1" ]; then
    return
  fi

  log "로컬 런타임 헬스체크를 기다립니다."
  for _ in $(seq 1 60); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  fail "로컬 런타임이 제시간에 올라오지 않았습니다. 로그를 확인하세요."
}

if [ "$(uname -s)" != "Darwin" ]; then
  fail "install.sh 는 macOS 전용입니다."
fi

if [ "$(id -u)" -eq 0 ]; then
  fail "install.sh 는 sudo 없이 일반 사용자 계정으로 실행하세요."
fi

TARGET_USER="${USER}"
TARGET_HOME="${HOME}"
STATE_DIR="${REMOTE_CODEX_DATA_DIR:-$TARGET_HOME/.remote-codex}"
NPM_PREFIX="${NPM_CONFIG_PREFIX:-$STATE_DIR/npm-global}"
PACKAGE_NAME="${REMOTE_CODEX_PACKAGE_NAME:-@everyground/remote-codex}"
PACKAGE_ROOT="$NPM_PREFIX/lib/node_modules/$PACKAGE_NAME"
CLI_PATH="$PACKAGE_ROOT/bin/remote-codex.cjs"

mkdir -p "$STATE_DIR"
mkdir -p "$NPM_PREFIX"

ensure_node
ensure_brew_path

NODE_BIN="$(command -v node)"
log "Remote Codex 패키지를 npm으로 설치합니다."
npm install -g --prefix "$NPM_PREFIX" "$PACKAGE_NAME"

[ -f "$CLI_PATH" ] || fail "설치된 Remote Codex CLI를 찾지 못했습니다: $CLI_PATH"

write_command_shim "$NODE_BIN" "$CLI_PATH"
ensure_codex_login "$NODE_BIN" "$PACKAGE_ROOT"
install_service "$NODE_BIN" "$CLI_PATH"
wait_for_health

log "설치가 완료되었습니다."
log "로컬 UI: http://localhost:3000"
log "로그: $STATE_DIR/logs/daemon.out.log, $STATE_DIR/logs/daemon.err.log"
