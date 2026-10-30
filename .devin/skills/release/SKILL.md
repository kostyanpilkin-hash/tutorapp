---
name: release
description: Full TutorApp release pipeline — verification, installer build, silent install, changelog, commit and push. Use when the user asks to release, build an installer, install the app, or says «собери/установи релиз», «сборка и установка», «выпусти версию».
---

# Release pipeline

Рабочая директория: `E:\Work\tutor-app`. Запускать шаги по порядку, при ошибке — остановиться и разобраться, не продолжать дальше.

## Шаг 1 — проверки

```bash
cd src-tauri && cargo check && cargo test
cd .. && npx tsc --noEmit && npm test
```

`cargo test` — все 24+ lib-тестов должны *** (1 ignored — это parity dump, норма). vitest пропускает `parity.test.ts`, если нет артефактов — тоже норма.

## Шаг 2 — сборка

```bash
npm run build:installer
```

Результат: MSI + NSIS в `installers/<дата>/`. Сборка ~3–5 минут — запускать в фоне, ждать завершения.

## Шаг 3 — тихая установка

```bash
"installers/<дата>/TutorApp_0.2.0_x64-setup.exe" /S
```

Каверзы NSIS `/S`:
- Процесс `TutorApp_0.2.0_x64-setup` работает до ~60 с и может вернуть код 1 — это НЕ признак провала.
- Проверять так: `tasklist | grep -i setup` пока процесс не исчезнет, затем сравнить размер/mtime `"$LOCALAPPDATA/TutorApp/tutor-app.exe"` со свежим бинарником.
- Если установленный exe отличается от старого по размеру — установка прошла.

## Шаг 4 — CHANGELOG

`CHANGELOG.md` в корне, по-русски. Новая секция сверху после заголовка:

```markdown
## YYYY-MM-DD (метка)

### Тема
- Пункт
```

Метка: `утро`/`день`/`вечер`, при повторном блоке в тот же день — `(вечер, 2)` и т.д.

## Шаг 5 — коммит и пуш

```bash
git add -A
git commit -m "$(cat <<'EOF'
<краткое описание>

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
git push origin HEAD:main
```

Перед коммитом: `git status` — проверить отсутствие *** `nul` (см. AGENTS.md «Подводные камни»). Не коммитить, если изменений нет.
