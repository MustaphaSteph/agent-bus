#!/bin/sh
# agent-bus skill setup checker.
# Exits 0 if everything's ready. Non-zero with a clear install hint if not.
# Default mode is read-only. Pass --install-cli to install/upgrade the
# npm CLI package when it is missing or too old.

set -e

MIN_NODE_MAJOR=20
MIN_AGENT_BUS="0.6.0"
INSTALL_CLI=0

while [ $# -gt 0 ]; do
  case "$1" in
    --install|--install-cli)
      INSTALL_CLI=1
      shift
      ;;
    -h|--help)
      printf "Usage: %s [--install-cli]\n" "$0"
      exit 0
      ;;
    *)
      printf "ERROR: unknown argument '%s'\n" "$1" >&2
      exit 2
      ;;
  esac
done

fail() {
  printf "\n[agent-bus skill] setup check failed: %s\n\n" "$1" >&2
  printf "Install hint: npm i -g @agent-bus-connect/cli@latest\n" >&2
  printf "Or run this checker with: %s --install-cli\n" "$0" >&2
  printf "Full install docs: https://github.com/MustaphaSteph/agent-bus#install\n\n" >&2
  exit 1
}

install_cli() {
  if ! command -v npm >/dev/null 2>&1; then
    fail "npm is not on PATH, so the agent-bus CLI cannot be installed automatically"
  fi
  printf "Installing/upgrading @agent-bus-connect/cli@latest ...\n" >&2
  npm i -g @agent-bus-connect/cli@latest
  hash -r 2>/dev/null || true
}

# 1. node >= MIN_NODE_MAJOR
if ! command -v node >/dev/null 2>&1; then
  fail "node is not on PATH (need Node.js >= ${MIN_NODE_MAJOR})"
fi

NODE_VERSION_RAW="$(node --version 2>/dev/null | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION_RAW%%.*}"

if [ -z "${NODE_MAJOR}" ] || [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ] 2>/dev/null; then
  fail "node ${NODE_VERSION_RAW:-unknown} is too old (need >= ${MIN_NODE_MAJOR})"
fi

# 2. agent-bus-mcp on PATH (the npm-installed bin)
if ! command -v agent-bus-mcp >/dev/null 2>&1; then
  if [ "$INSTALL_CLI" = "1" ]; then
    install_cli
  fi
  if ! command -v agent-bus-mcp >/dev/null 2>&1; then
    fail "agent-bus-mcp not on PATH — the agent-bus npm package isn't installed"
  fi
fi

# 3. agent-bus CLI on PATH + version satisfies MIN_AGENT_BUS
if ! command -v agent-bus >/dev/null 2>&1; then
  if [ "$INSTALL_CLI" = "1" ]; then
    install_cli
  fi
  if ! command -v agent-bus >/dev/null 2>&1; then
    fail "agent-bus CLI not on PATH — the npm package may be partially installed"
  fi
fi

VERSION_RAW="$(agent-bus --version 2>/dev/null | tr -d '\r\n ')"
if [ -z "${VERSION_RAW}" ]; then
  fail "agent-bus --version printed nothing"
fi

# semver-ish comparison: split major.minor.patch on each side
got_major="${VERSION_RAW%%.*}"
rest_got="${VERSION_RAW#*.}"
got_minor="${rest_got%%.*}"
rest_got="${rest_got#*.}"
got_patch="${rest_got%%[-+]*}"

want_major="${MIN_AGENT_BUS%%.*}"
rest_want="${MIN_AGENT_BUS#*.}"
want_minor="${rest_want%%.*}"
rest_want="${rest_want#*.}"
want_patch="${rest_want%%[-+]*}"

got_major="${got_major:-0}"; got_minor="${got_minor:-0}"; got_patch="${got_patch:-0}"
want_major="${want_major:-0}"; want_minor="${want_minor:-0}"; want_patch="${want_patch:-0}"

if [ "${got_major}" -gt "${want_major}" ] 2>/dev/null; then
  :
elif [ "${got_major}" -eq "${want_major}" ] 2>/dev/null; then
  if [ "${got_minor}" -gt "${want_minor}" ] 2>/dev/null; then
    :
  elif [ "${got_minor}" -eq "${want_minor}" ] 2>/dev/null; then
    if [ "${got_patch}" -lt "${want_patch}" ] 2>/dev/null; then
      if [ "$INSTALL_CLI" = "1" ]; then
        install_cli
        exec "$0"
      fi
      fail "agent-bus ${VERSION_RAW} is older than required ${MIN_AGENT_BUS}; upgrade with npm i -g @agent-bus-connect/cli@latest"
    fi
  else
    if [ "$INSTALL_CLI" = "1" ]; then
      install_cli
      exec "$0"
    fi
    fail "agent-bus ${VERSION_RAW} is older than required ${MIN_AGENT_BUS}; upgrade with npm i -g @agent-bus-connect/cli@latest"
  fi
else
  if [ "$INSTALL_CLI" = "1" ]; then
    install_cli
    exec "$0"
  fi
  fail "agent-bus ${VERSION_RAW} is older than required ${MIN_AGENT_BUS}; upgrade with npm i -g @agent-bus-connect/cli@latest"
fi

printf "agent-bus %s ready (node %s)\n" "${VERSION_RAW}" "${NODE_VERSION_RAW}"
exit 0
