#!/bin/sh
# agent-bus skill setup checker.
# Exits 0 if everything's ready. Non-zero with a clear install hint if not.
# Designed to be safe to run from a skill activation: read-only, no side effects.

set -e

MIN_NODE_MAJOR=20
MIN_AGENT_BUS="0.5.0"

fail() {
  printf "\n[agent-bus skill] setup check failed: %s\n\n" "$1" >&2
  printf "Install hint: npm i -g @agent-bus-connect/cli\n" >&2
  printf "Full install docs: https://github.com/MustaphaSteph/agent-bus#install\n\n" >&2
  exit 1
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
  fail "agent-bus-mcp not on PATH — the agent-bus npm package isn't installed"
fi

# 3. agent-bus CLI on PATH + version satisfies MIN_AGENT_BUS
if ! command -v agent-bus >/dev/null 2>&1; then
  fail "agent-bus CLI not on PATH — the npm package may be partially installed"
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
      fail "agent-bus ${VERSION_RAW} is older than required ${MIN_AGENT_BUS}; upgrade with npm i -g @agent-bus-connect/cli@latest"
    fi
  else
    fail "agent-bus ${VERSION_RAW} is older than required ${MIN_AGENT_BUS}; upgrade with npm i -g @agent-bus-connect/cli@latest"
  fi
else
  fail "agent-bus ${VERSION_RAW} is older than required ${MIN_AGENT_BUS}; upgrade with npm i -g @agent-bus-connect/cli@latest"
fi

printf "agent-bus %s ready (node %s)\n" "${VERSION_RAW}" "${NODE_VERSION_RAW}"
exit 0
