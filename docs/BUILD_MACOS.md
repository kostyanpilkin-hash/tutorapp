# Сборка TutorApp для macOS

Нативное macOS-приложение можно собрать **только на macOS** (требуются Xcode-инструменты и macOS SDK — кросс-компиляции из Windows нет). Этот гайд — для выполнения на Mac.

## Что уже готово в коде

- Windows-специфика отделена через `#[cfg(windows)]` — на macOS она не компилируется: `windows_toast` (AUMID-тосты), ярлык через PowerShell, `winreg`.
- Уведомления на macOS работают через `notify-rust` / `tauri-plugin-notification` (см. `scheduler/mod.rs` — ветка `#[cfg(not(windows))]`).
- Автозапуск настроен как `MacosLauncher::LaunchAgent` в `lib.rs`.
- Ярлык на рабочем столе на macOS — no-op (stub в `commands/shortcut.rs`).

## Шаг 1. Установить инструменты на Mac

```bash
# 1. Xcode Command Line Tools (обязательно — без них не соберётся Rust)
xcode-select --install

# 2. Homebrew (если нет)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 3. Node.js LTS
brew install node

# 4. Rust через rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Проверка:

```bash
node -v        # >= 20
npm -v
rustc -V       # stable
cargo -V
```

## Шаг 2. Получить код

```bash
git clone <url-репозитория> tutor-app
cd tutor-app
```

Если репозитория нет на хостинге — скопируйте папку проекта на Mac (без `node_modules` и `src-tauri/target` — они пересоздадутся; с Windows-машины проще всего через `git clone` с диска/шары или архив).

## Шаг 3. Исправить идентификатор приложения (важно!)

В `src-tauri/tauri.conf.json` сейчас:

```json
"identifier": "com.tutor.app"
```

Суффикс `.app` конфликтует с расширением бандла macOS — Tauri уже предупреждает об этом при сборке. Перед первой macOS-сборкой поменяйте на:

```json
"identifier": "com.tutor.tutorapp"
```

⚠️ Менять нужно **до первого релиза на Mac** — идентификатор зашивается в бандл, пути данных и права на уведомления. Поздняя смена = «новое» приложение для ***.

Это же изменение стоит внести и в основную ветку — на Windows оно безвредно (данные на существующих Windows-установках привязаны к `com.tutor.app`; если уже есть установленные пользователи на Windows — решите отдельно: либо оставить `com.tutor.app` и мириться с варнингом, либо менять с миграцией пути данных).

## Шаг 4. Проверить иконки

macOS-бандл требует иконку `.icns`. Tauri генерирует её автоматически из PNG, если она есть в `src-tauri/icons/`. Проверьте:

```bash
ls src-tauri/icons
# при необходимости сгенерировать все форматы:
npx tauri icon path/to/source-icon.png
```

## Шаг 5. Установить зависимости и собрать

```bash
npm install
npm run tauri build
```

Результат:

- `src-tauri/target/release/bundle/macos/TutorApp.app` — приложение;
- `src-tauri/target/release/bundle/dmg/TutorApp_0.2.0_aarch64.dmg` (или `x86_64` на Intel-Mac) — установщик.

Сборка идёт под текущую архитектуру Mac (Apple Silicon → `aarch64`, Intel → `x86_64`). Для универсального бинарника:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- -- --target universal-apple-darwin
```

## Шаг 6. Запуск и проверка

```bash
open src-tauri/target/release/bundle/macos/TutorApp.app
```

Что проверить:

- Окно открывается, календарь/ученики/финансы работают — логика одинаковая.
- **Уведомления**: при первом запуске macOS спросит разрешение — ответить «Разрешить». Напоминания приходят через стандартный Notification Center (без брендированного toast как на Windows — это ограничение `notify-rust`).
- **Трей**: иконка в меню-баре появляется; клик — «Открыть»/«Выход». (Для macOS иконку трея желательно сделать template/монохромной — опционально.)
- **Автозапуск**: переключатель в настройках создаёт `~/Library/LaunchAgents/com.tutor.tutorapp.plist`.
- **Данные**: база SQLite лежит в `~/Library/Application Support/com.tutor.tutorapp/` — отдельно от Windows-копии, переносится простым копированием `tutorapp.db` + папки `students/` (фото).

## Шаг 7. Разрешение Gatekeeper

Без платной подписи при первом запуске будет «разработчик не проверен»:

- ПКМ на `TutorApp.app` → «Открыть» → подтвердить. Одноразовое действие, дальше запускается обычно.
- Или: `xattr -dr com.apple.quarantine TutorApp.app` (только на свой Mac).

## Подпись и нотаризация (для раздачи другим)

Нужен Apple Developer аккаунт ($99/год):

```bash
# сертификат Developer ID Application в Keychain, затем:
export APPLE_SIGNING_IDENTITY="Developer ID Application: Имя (TEAMID)"
npm run tauri build
```

Для нотаризации добавить в `tauri.conf.json` → `bundle.macOS` или env:

```bash
export APPLE_ID="..." APPLE_PASSWORD="app-specific-password" APPLE_TEAM_ID="..."
```

Tauri сам вызовет `codesign` и `notarytool` при сборке. Без этого шага приложение на чужих Mac будет блокироваться Gatekeeper.

## Частые проблемы

| Проблема | Причина | *** |
|---|---|---|
| `xcrun: error` при сборке | Нет Xcode CLT | `xcode-select --install` |
| Ошибка `identifier` про `.app` | `com.tutor.app` | Шаг 3 |
| `.dmg` не создаётся | Нет иконки `.icns` | `npx tauri icon ...` |
| Нет уведомлений | Запрет в настройках macOS | Системные настройки → Уведомления → TutorApp |
| Чужой Mac блокирует запуск | Gatekeeper | ПКМ → Открыть, или нотаризация |

## Что сознательно НЕ будет работать на macOS (из коробки)

- Брендированные toast-уведомления с иконкой приложения (Windows AUMID) — заменено на стандартные уведомления macOS.
- Кнопка «Создать ярлык на рабочем столе» — no-op (на macOS это делается через Applications/alias, при желании можно убрать кнопку из UI под macOS).
- Авто-открытие ссылки на мессенджер/звонок — работает через `tauri-plugin-opener`, на macOS откроется в браузере.
