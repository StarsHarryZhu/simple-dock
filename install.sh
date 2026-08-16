#!/usr/bin/env bash
# Simple Dock bundle installer (macOS / Linux).
# Links this package into the web profile's node_modules and registers the
# bundle row in cordis.patch.yml (idempotent). Restart DSH to activate.
set -euo pipefail

PKG_NAME="@deepseek-ai/dsh-client-ui-simple-dock"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILES_NM="$DSH_HOME/profiles/node_modules"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$DSH_HOME/profiles" ]; then
  echo "error: no DSH profiles at $DSH_HOME/profiles" >&2
  exit 1
fi

# 1) link the package into the profile node_modules
mkdir -p "$PROFILES_NM/@deepseek-ai"
ln -sfn "$SRC_DIR" "$PROFILES_NM/$PKG_NAME"
echo "linked: $PROFILES_NM/$PKG_NAME -> $SRC_DIR"

# 2) register the insert row in the web profile patch (idempotent)
if [ -f "$PATCH" ] && grep -q "$PKG_NAME" "$PATCH"; then
  echo "already registered in $PATCH"
else
  mkdir -p "$(dirname "$PATCH")"
  cat >> "$PATCH" <<EOF

- insert:
    - id: simple-dock
      name: '@deepseek-ai/dsh-client-ui-simple-dock'
EOF
  echo "registered in $PATCH"
fi

echo
echo "Done. Restart DSH to activate Simple Dock (or reload the web UI)."
