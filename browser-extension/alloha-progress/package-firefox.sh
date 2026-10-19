#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
OUTPUT=${1:-"$REPO_ROOT/dist/gulrating-alloha-firefox.xpi"}

if ! command -v zip >/dev/null 2>&1; then
  echo "Нужна команда zip для упаковки XPI." >&2
  exit 1
fi
mkdir -p "$(dirname -- "$OUTPUT")"
OUTPUT=$(CDPATH= cd -- "$(dirname -- "$OUTPUT")" && pwd)/$(basename -- "$OUTPUT")

cd "$SCRIPT_DIR"
zip -X -q -j "$OUTPUT" manifest.json content.js icon-16.png icon-48.png icon-128.png
printf 'Firefox XPI собран: %s\n' "$OUTPUT"
