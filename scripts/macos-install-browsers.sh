#!/usr/bin/env bash
# Avast / corporate TLS MITM: dump SystemRoot + System keychains, then install
# Playwright browsers with NODE_EXTRA_CA_CERTS. Same recipe as Step Swap
# docs/AGENT_MAC_PLAYWRIGHT.md.
#
# Vitalii's Mac:
#   /Users/home/maestro/scripts/macos-install-browsers.sh
#   /Users/home/maestro/scripts/macos-install-browsers.sh webkit
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/node_modules/.cache/maestro-sample"
PEM="$CACHE/macos-root-ca-full.pem"
SECURITY="/usr/bin/security"
if [[ ! -x "$SECURITY" ]]; then
  SECURITY="security"
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper is for macOS (dumps Keychain PEMs). On Linux/CI use:" >&2
  echo "  npx playwright install --with-deps chromium webkit" >&2
  exit 1
fi

mkdir -p "$CACHE"

# Dump each keychain on its own so a locked System.keychain still yields public roots.
: > "$PEM"
for KEYCHAIN in \
  /System/Library/Keychains/SystemRootCertificates.keychain \
  /Library/Keychains/System.keychain
do
  if ! "$SECURITY" find-certificate -a -p "$KEYCHAIN" >> "$PEM"; then
    echo "warning: could not dump $KEYCHAIN" >&2
  fi
done

if [[ ! -s "$PEM" ]]; then
  echo "error: empty CA bundle at $PEM" >&2
  exit 1
fi

export NODE_EXTRA_CA_CERTS="$PEM"
echo "Using extra CAs: $NODE_EXTRA_CA_CERTS"

cd "$ROOT"
if [[ $# -eq 0 ]]; then
  set -- chromium chromium-headless-shell webkit
fi

status=0
for browser in "$@"; do
  echo "Installing $browser…"
  if ! npx playwright install "$browser"; then
    echo "Failed to install $browser." >&2
    if [[ "$browser" == "webkit" ]]; then
      echo "Chromium is enough for local npm test (iPhone 14 viewport)." >&2
    fi
    status=1
  fi
done
exit "$status"
