#!/bin/sh
# Пересборка статического Tailwind CSS (чтобы сайту не нужен был CDN).
# Требует node+npx: ставит tailwindcss@3 во временную папку и компилирует.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
cd "$TMP" && npm init -y >/dev/null 2>&1 && npm i tailwindcss@3.4.14 >/dev/null 2>&1
cd - >/dev/null
"$TMP/node_modules/.bin/tailwindcss" -c tailwind.config.js -i src/styles/tw-input.css -o assets/tw.css --minify
rm -rf "$TMP"
echo "assets/tw.css обновлён: $(wc -c < assets/tw.css) байт"
