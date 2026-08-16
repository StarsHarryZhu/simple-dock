#!/usr/bin/env bash
# Simple Dock bundle uninstaller (macOS / Linux).
# Removes the profile symlink and the cordis.patch.yml insert row.
set -euo pipefail

PKG_NAME="@deepseek-ai/dsh-client-ui-simple-dock"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
LINK="$DSH_HOME/profiles/node_modules/$PKG_NAME"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"

if [ -L "$LINK" ] || [ -e "$LINK" ]; then
  rm -f "$LINK"
  echo "removed: $LINK"
fi

if [ -f "$PATCH" ] && grep -q "$PKG_NAME" "$PATCH"; then
  # remove the trailing insert block (and the blank line before it)
  python3 - "$PATCH" <<'PY'
import sys
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    text = f.read()
block = "\n- insert:\n    - id: simple-dock\n      name: '@deepseek-ai/dsh-client-ui-simple-dock'\n"
if block in text:
    text = text.replace(block, "\n", 1).rstrip() + "\n"
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print("removed insert row from", path)
else:
    print("warning: patch row not found in", path)
PY
fi

echo "Done. Restart DSH to fully unload Simple Dock."
