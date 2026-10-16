#!/bin/sh
set -eu

TAG="${1:?Usage: scripts/release-notes.sh v1.0.0}"
VERSION="${TAG#v}"
NOTES=$(mktemp)
trap 'rm -f "$NOTES"' EXIT

if ! awk -v version="$VERSION" '
  $0 ~ "^## \\[" version "\\]" { print; found = 1; active = 1; next }
  active && /^## / { exit }
  active { print }
  END { if (!found) exit 1 }
' CHANGELOG.md > "$NOTES"; then
  printf '## ГульРейтинг %s\n\n' "$TAG" > "$NOTES"
  printf 'Подробности выпуска: https://github.com/ToshakGulina/gulrating/compare/%s...%s\n' "$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || echo main)" "$TAG" >> "$NOTES"
fi

while [ -s "$NOTES" ] && [ -z "$(tail -n 1 "$NOTES")" ]; do
  sed -i '$d' "$NOTES"
done
cat "$NOTES"
printf '\n---\n\n'
cat <<'INSTALL'
### Установка
- **Android:** скачайте APK из раздела Assets и откройте файл на телефоне. Google Play не используется.
- **Обновление:** устанавливайте поверх предыдущего APK; релизы подписаны ключом проекта.
- **Проблемы со входом или синхронизацией:** см. инструкции в [README](https://github.com/ToshakGulina/gulrating#для-пользователей).
INSTALL
