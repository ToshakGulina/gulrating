# Вклад в ГульРейтинг

Спасибо за интерес к проекту. Перед крупными изменениями откройте issue, чтобы согласовать направление.

## Локальная проверка

1. Для статического просмотра запустите `python3 -m http.server 8000` в корне.
2. Перед pull request запустите:
   ```bash
   node scripts/check-modules.mjs
   ./scripts/build-css.sh
   git diff --check
   ```
3. Если менялись HTML-классы, добавьте обновлённый `assets/tw.css`.
4. APK проверяется GitHub Actions; PR-сборки и ручные сборки без тега unsigned. Подписанные APK публикуются только с тегом релиза `v*`.

## Подпись Android APK (владельцу репозитория)

Keystore нельзя коммитить. В терминале с установленным JDK (например, встроенном терминале Android Studio) создайте новый файл PKCS12 **вне папки репозитория**. Запомните alias и пароли в менеджере паролей:

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore "$HOME\gulrating-release.p12" -alias gulrating-release -keyalg RSA -keysize 2048 -validity 10000
```

Когда keytool запросит пароли, используйте надёжные уникальные значения. Затем в PowerShell закодируйте файл для GitHub Actions:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\gulrating-release.p12")) | Set-Clipboard
```

В репозитории откройте **Settings → Secrets and variables → Actions → New repository secret** и добавьте секреты:

- `ANDROID_KEYSTORE_BASE64` — Base64-файл из буфера обмена;
- `ANDROID_KEYSTORE_PASSWORD` — пароль хранилища;
- `ANDROID_KEY_ALIAS` — alias ключа;
- `ANDROID_KEY_PASSWORD` — пароль ключа.

Не вставляйте значения секретов в issues, pull requests или исходный код. PR-сборки не используют signing secrets; теговый release завершится ошибкой, если секреты не заданы. Смена signing key требует переустановки APK вместо обновления поверх старого.

## Правила изменений

- Не добавляйте service-role ключи, пароли, токены ботов или приватные пользовательские данные.
- Сохраняйте Cloudflare Pages как статический хостинг. Не переносите сайт на Workers.
- Не меняйте формат хранения/миграции базы без обновления соответствующего SQL и инструкции.
- Для изменений интерфейса укажите build stamp и приложите скриншоты до/после, если это уместно.
- Не включайте в PR APK, keystore, кэши, `node_modules` и временные файлы.
