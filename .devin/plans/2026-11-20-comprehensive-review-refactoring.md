# TutorApp: ревью и поэтапная переработка — Implementation Plan

**Статус:** проект плана для согласования; реализация не начата. Не выполнять весь документ одним большим изменением.

**Goal:** устранить риски потери расписания и искажения оплат, затем централизовать изменения занятий и финансов и довести интерфейс до предсказуемого доступного desktop UX.

**Architecture:** сохранить модульный монолит React/Tauri/SQLite. Команды Tauri, Telegram и фоновые задачи должны использовать общие Rust-модули изменения расписания, финансов и доставки уведомлений; React отвечает за черновик, выбор области изменения, preview и отображение результата, но не за последовательность нескольких записей в БД.

**Tech Stack:** существующие React 19, TypeScript, React Query, Zustand, Tailwind 4, Radix, Tauri 2, Rust, rusqlite 0.32, chrono/chrono-tz, Vitest, существующий Python Playwright для исследовательских проверок. Не устанавливать ничего в рамках ревью.

**Spec:** этот документ, разделы «Инварианты» и «Целевой UX». Исходные продуктовые требования — `.devin/plans/2026-11-18-time-picker-reschedule-cards.md`; при конфликте применять согласованные с пользователем инварианты этого документа. Старый план содержит решения, породившие часть перечисленных ниже дефектов; не использовать его как безусловно правильную спецификацию.

## Global Constraints

- Рабочий каталог `E:\Work\tutor-app`. Проверенный HEAD: `e1e1756051c828a0f092d37f92b6ff52b4f5f96c`, версия 0.2.3, дата ревью 2026-11-20.
- Это ревью и план, не разрешение на реализацию, миграции рабочей БД, публикацию или push. *** согласование перед исполнением.
- Не менять данные пользователя, не выводить секреты. Все fault-injection и SQL-тесты — временная или in-memory БД с вымышленными данными.
- Перед любыми будущими SQL/backup/migration изменениями использовать `default:safe-migration`; перед заявлением об успехе — `verification-before-completion`.
- Новые строки сразу ru/en/be. Сохранить Windows и macOS, существующие темы, null-стоимость школьных занятий и исторические индивидуальные цены/оплаты.
- Без микросервисов, без смены стека, без внедрения облачной синхронизации в этот рефакторинг. Возможность облака — ориентир контрактов, не повод переписывать приложение.
- Не ставить пакеты и инструменты без согласования. Если для постоянных UI-тестов понадобится test runner/browser package, выделить согласование в Task 1. Временный Python Playwright уже работает.
- Никакого автоматического удаления «плохих» данных. Миграции сначала делают отчёт, затем архивируют исходные записи и лишь потом преобразуют копию.
- Не ослаблять линтеры, security policies или веточную защиту ради зелёного статуса.

## Review Focus

1. Ошибка между обрезкой серии и созданием продолжения: исходное расписание, оплаты и исключения должны остаться неизменными — Task 6.
2. Редактирование заметки группового занятия не должно снимать индивидуальную оплату участника — Task 3.
3. Слот без стоимости, отменённое занятие и шаблон серии не должны расходовать по одному кредиту как обычная строка — Task 8.
4. Дата-only/невалидный ключ исключения не должен приводить к удалению других дат серии при запуске — Task 2.
5. Выбор времени, предупреждение и повторное сохранение должны оставаться доступны при 900×600, клавиатуре и медленном backend — Tasks 4, 5, 11.

---

## 1. Что действительно проверено

### Метод и ограничения

- Использованы инструкции tauri-review, codebase-design, domain-modeling, improve-codebase-architecture, code-review, ui-ux-pro-max, impeccable, frontend-design, shadcn, writing-plans и verification-before-completion. Grilling применяется к вопросам согласования в конце. Рекомендации маркетингового design-taste-frontend о hero/анимациях не переносятся на рабочее desktop-приложение.
- Graphify: `god-nodes`, история коммитов, навигация по ключевым модулям. Максимальные узлы включают LessonFormDialog, StudentsPanel, StudentFormDialog и SettingsPanel. Большое число связей само по себе не дефект.
- Прочитаны критичные пути lesson create/update/overlaps/archive/materialize, оба пути split серии, форма занятия и ученика, участники/оплаты, student finance и general finance, prepaid bulk, settings/backup, HTTP phone server, scheduler, Telegram delivery/action paths, tauri permissions/CSP, updater store и release workflow.
- Отрисован настоящий React UI через Vite и Python Playwright с вымышленным IPC-адаптером, без рабочей БД. Проверены создание занятия и часы при 1280×800 light, 900×600 light/dark; получены снимки и hit-test.
- Browser mock подтверждает контракт фронта, геометрию и интерактивность, НЕ транзакции Rust, native file dialogs, *** уведомления, установку обновлений или работу WKWebView/macOS.
- Не выполнялись: ручное прохождение каждого экрана на обеих ОС, WCAG-сертификация, нагрузочный профиль рабочей БД, CVE-аудит Rust, анализ истории Git на секреты, live Telegram/phone mutations. Это отдельные пункты приёмки, а не объявленные успешными проверки.
- SonarQube не подключался по решению пользователя. Подагенты не запускались. Секреты и реальные ученики не читались.

### Команды и результат

- `npx tsc --noEmit`: exit 0.
- `npm test`: 28 passed; четыре *** тестов прошли; parity-файл пропущен без подготовленных артефактов. Это НЕ успешная проверка parity.
- `cargo test --quiet`: 53 passed, 3 ignored; среди выполненных есть ts-rs export tests, поэтому 53 нельзя называть 53 независимыми продуктовыми сценариями.
- `npx eslint .`: exit 1, 22 errors / 27 warnings. Ошибки в том числе в `.mjs`: Node globals не объявлены для расширения, есть пустые catch. Предупреждения React hooks — сигналы для анализа, не автоматически дефекты.
- `cargo clippy --workspace --all-targets -- -D warnings`: exit 101. В том числе empty-line-after-doc-comments, dead_code, too_many_arguments, type_complexity, unnecessary_sort_by, if_same_then_else, manual_contains.
- `npm run build`: exit 0, 3321 modules transformed, main JS 743.22 kB minified / 228.09 kB gzip, FinancePanel 390.11 / 113.74 kB, CSS 106.68 / 30.74 kB. Есть warning чанка >500 kB. Для desktop это повод измерять startup/память, не доказательство медленной работы.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities по данным npm в момент проверки. Не покрывает dev-зависимости, Rust и *** уязвимости.
- `git status --short` после проверок: пусто, до добавления этого плана. Продуктовый код не изменён.

### Воспроизводимые browser-доказательства

Временный harness: `%TEMP%/tutor-review-browser.py` (синтетические данные). Команда: `python -X utf8 "%TEMP%/tutor-review-browser.py"` в PowerShell либо эквивалент с абсолютным путём в git-bash. Для запуска нужен Vite `http://127.0.0.1:1420`.

- 900×600: кнопка часов «Готово» имеет rect x=383.66 y=695 width=200 height=32; центр вне viewport, hit-test false.
- 1280×800: rect x=573.66 y=705 width=200 height=32; центр внутри viewport, но перекрыт/обрезан родителем, hit-test false.
- В проверенной основной вкладке пять input имеют `labels.length=0`, нет `aria-label`.
- Снимки: `%TEMP%/tutor-review-1280-800-light.png`, `%TEMP%/tutor-review-900-600-light.png`, `%TEMP%/tutor-review-900-600-dark.png`.
- Вызов настоящего `rescheduleSeriesFromInstance` с mock IPC: исходная серия 02.11, MO, COUNT=8; выбранный слот 23.11, перенос на 09.11 14:40Z. Фронт создаёт новую COUNT=5 и обрезает исходную до 08.11 (20:59:59.999Z в timezone harness Europe/Moscow), хотя выбран был 23.11. Это переносит/убирает также ещё не выбранные исторические слоты 09.11 и 16.11.

## 2. Реестр находок

Серьёзность: P1 — риск целостности расписания/финансов/конфиденциальности, P2 — существенный UX/надёжность/сопровождение, P3 — улучшение после измерений. Это не CVSS. «Подтверждено кодом» означает прослеживаемый путь, но не утверждение, что пользователь уже потерял данные.

### F01 — P1. Split серии неатомарен в обоих путях

`src/components/lesson/LessonFormDialog.tsx:416-428`: update родителя, затем create продолжения; ошибка create оставляет старую серию обрезанной. `src/lib/lessonActions.ts:209-225`: create, затем update, затем best-effort delete при ошибке; crash между командами либо ошибка rollback оставляет двойное расписание. Дополнительно catch захватывает invalidate: сбой перечитывания кэша после успешной обрезки может удалить новую серию, не восстановив старую. Нужна одна серверная транзакция, не перестановка вызовов на фронте.

### F02 — P1. Перенос назад изменяет прошлую часть серии

`lessonActions.ts:220`: граница `min(slot, newStart)-1 day`. Browser-вызов с 23.11→09.11 подтвердил update границы до 08.11. Старые exception-строки при этом остаются привязанными к прежнему родителю; перенос/сохранение их политики не определён. История не должна исчезать из-за новой даты продолжения.

### F03 — P1. Сохранение группы стирает частичную оплату

`LessonFormDialog.tsx:312-324` всегда передаёт участникам `paymentStatus:null`. `commands/lessons/repo.rs:223-232` заменяет null на общий статус занятия. Для A=paid, B=unpaid, lesson=unpaid сохранение одной заметки делает A unpaid. `lessonToInput` в `src/types/lesson.ts:69-74`, напротив, сохраняет статусы — уже существующий хороший образец.

### F04 — P1. Предоплата применяется к неподходящим строкам

`commands/students_bulk.rs:213-290`: выбор всех unpaid без проверки cancelled, cost и recurrence_rule; UPDATE множества строк и списание `paid_lessons` без общей транзакции. Отмена/школьное занятие может съесть кредит. Оплата parent-шаблона серии меняет оплату множества генерируемых экземпляров вместо одного. Отказ между UPDATE и списанием даёт несогласованный баланс.

### F05 — P1. Student finance теряет zero-cost исключения до подавления слота

`commands/students.rs:396-403`: cost<=0 отбрасывается до разбиения на parents/exceptions. При родителе с ценой 100 и исключении этого слота с ценой 0 или null такое исключение исчезает; `:504-559` вместо него классифицирует родительский платный слот. Если exception отменён и его цена нулевая, подавление отмены тоже теряется. Общий finance и student finance отдельно разрешают исключения, что поддерживает расхождение. Нужен resolver до финансовой фильтрации.

### F06 — P1. Очистка на запуске может объединить разные не-RFC3339 даты

`commands/lessons/archive.rs:82-106`: все непарсящиеся RFC3339 ключи превращаются в timestamp=0; записи разных дат одного parent попадают в одну группу и удаляются. При этом `occurrences::parse_any_date:365-369` явно поддерживает YYYY-MM-DD. `db/mod.rs:43-45` вызывает cleanup на каждом запуске, не в единой транзакции. Разные правила identity: timestamp в cleanup, local date в collect/overlap helper. Нужен безопасный нормализатор и запрет деструктивной очистки неоднозначных данных.

### F07 — P1. Backup не гарантирует SQLite snapshot

`db/mod.rs:28-37`: startup копирует только main .db, игнорирует WAL и ошибки. `commands/settings.rs:80-86`: ошибки/checkpoint-status проигнорированы, соединение отпускается, потом fs::copy при работающих других writers. Файл может не включать последние committed записи; согласованность не гарантирована. `lib.rs:24` запускает init до регистрации single-instance plugin — отдельный риск повторного запуска во время работающей базы. Нужен online backup SQLite и проверка восстановления.

### F08 — P1. Излишне широкий доступ к приватным файлам и настройкам

`commands/settings.rs:6-19` отдаёт все settings; `telegram/mod.rs:117` хранит tg_token там же. `tauri.conf.json:29` разрешает asset protocol на весь TutorApp. `students_bulk.rs:294-318` читает любой файл внутри app_data_dir и возвращает bytes как base64, даже не изображение. Canonicalize защищает от выхода наружу, но не от чтения самой БД внутри разрешённого root. Это не доказательство удалённого взлома; это ненужные возможности при компрометации renderer. Разделить DTO публичных настроек и *** хранилище секретов, ограничить фото каталогом students и известными типами/размером.

### F09 — P2. Overlap-warning одновременно строка ошибки и разрешение force

`LessonFormDialog.tsx:369,383-390`: любая truthy warning, включая «выберите ученика», может разрешить force. Warning не сбрасывается при изменении времени/длительности. Пользователь подтверждал не тот интервал/конфликт. В RescheduleDialog force вычисляется автоматически из наличия конфликта; отдельного явного подтверждения нет. Разрешать наложение можно, но подтверждение должно относиться к текущему payload.

### F10 — P2. Нет общего single-flight/lifecycle сохранения

`LessonFormDialog.tsx:367-503,1021`: Save не блокируется на период записи. Повторные клики/Enter могут создать дубли. StudentFormDialog имеет вложенные doSave/save с несколькими setSaving, включая сброс до следующего шага. RescheduleDialog сбрасывает saving при смене lesson, но старый async save позже может вызвать close уже нового диалога. Отсутствует operation/session token.

### F11 — P2. Проверка overlap вне транзакции и только одного старта

`commands/lessons.rs:148-199,275-276,372-407`: check под отдельным lock, затем transaction; Telegram имеет отдельные соединения. Между проверкой и записью возможно изменение. Для weekly проверяется anchor, а не результирующее множество повторений. Дополнительно create новой серии сталкивается со старой до её обрезки, хотя frontend check исключает parent. Пример: 18:00→17:40 без посторонних занятий может отклоняться сервером как self-overlap. Нужен preview результирующего расписания внутри apply transaction.

### F12 — P2. TimePicker обрезается и ограничивает клавиатуру

Browser/hit-test подтверждён. `ui/time-picker.tsx:122-125` absolute внутри overflow-y-auto, внешний `LessonFormDialog:579` overflow-hidden; z-index не отменяет clipping. Clock trigger `tabIndex=-1`; Escape document-handler не останавливает закрытие родительского Radix dialog. Внутренние числовые кнопки не сообщают выбранное состояние; плотные два кольца могут перекрывать hit-targets. Нельзя лечить только увеличением z-index.

### F13 — P2. Поля/действия не имеют полноценных accessible names/states

Browser: пять input основной вкладки без labels/aria-label. `ui/dialog.tsx:49-51` Close — X без доступного имени. `CalendarViews.tsx:184-198`: span role=button внутри button, без tabIndex/keyboard handler; видим только hover. `RescheduleDialog.tsx:187-202`: radio-like choices не передают selected state. Это проверяемые проблемы управления, не эстетическое мнение.

### F14 — P2. Async overlap preview может показать устаревший результат

`RescheduleDialog.tsx:72-101`: cleanup снимает только timer; уже отправленный Promise не отменяется и может записать warning для предыдущей даты/урока. Ошибка проверки трактуется как отсутствие warning, не как «проверить не удалось». Нужны generation id и отдельные states checking/error/conflict/clear.

### F15 — P2. Время редактируется в *** TZ, expansion — в TZ настроек

`recurrence.ts:88-92`, `LessonFormDialog.tsx:219-220`, `lessonActions.ts:189-205`, `CalendarViews.tsx:169` используют локальный JS Date; backend использует `occurrences::timezone`. При отличающихся TZ «17:40» неоднозначно. `countWeeklyOccurrencesFrom` также повторяет expansion на фронте, не учитывает INTERVAL и обрезает расчёт пятью годами (`recurrence.ts:99-133`). Нужен единый контракт local date+time+IANA timezone и серверные расчёты count/split.

### F16 — P2. Telegram может безвозвратно пропустить сообщение и частично изменить оплату

`telegram/jobs.rs:43-46,63-71`: sent_mark до send, send error игнорируется, ключ уже занят и retry не происходит. `handlers.rs:747-784`: materialize/status/две оплаты/лог — отдельные записи, не единая транзакция. `occurrences::materialize:450-467` не копирует reminders; после Telegram-материализации scheduled exception может лишиться desktop-напоминаний. Нужна общая mutation implementation и понятная at-least-once delivery, не обещание exactly-once в Telegram.

### F17 — P2. Локальный HTTP server недостаточно ограничен и наблюдаем

`http_server.rs:207-215` bind на всех интерфейсах, ошибки старта проигнорированы; UI видит enabled setting, а не readiness. Ключ в URL и localStorage, HTTP plaintext; это LAN convenience, не защищённый удалённый доступ. `:243-251` нет ограничения диапазона; synchronous rusqlite/expansion в async handler. `PAGE:300` no_show подписан «Не состоялось», тогда как desktop различает отсутствие ученика и отмену. Не делать вид, что переименование решает транспортную безопасность.

### F18 — P2. Проверки не являются release gate

Единственный workflow — release.yml. В нём npm ci и tauri build, но нет lint/test gate. Manifest `if: always()` проверяет только prepare; при rebuild существующего релиза может собрать manifest из старых assets, даже если текущая Windows-сборка не удалась. workflow_dispatch берёт checkout ref, а release_tag может указывать на другой SHA. Это риск происхождения артефактов. Не перезаписывать опубликованные assets как нормальную стратегию.

### F19 — P2/P3. Query/model и чтение данных излишне связаны

`App.tsx:100-105` rangeQuery активен на всех страницах кроме home, даже settings/history. `queryKeys.ts:56-59` любая мутация перечитывает все активные data prefixes. `lessons/repo.rs:43-50` на каждую строку дополнительно загружает reminders и students (N+1). До рефакторинга нужно измерить число SQL/IPC и latency на 10k занятий, а не вводить новую ORM или переписывать кэш.

### F20 — P2. Ошибки и «нет данных» не разведены на уровне контрактов

API кодирует overlap префиксом строки и глобально подавляет для него toast (`api.ts:24-36`); корректность обратной связи зависит от каждого caller. В ряде путей ошибки повторно throw из `void save()`; компоненты трактуют `data ?? []` как пустоту до разбора query.isError. План требует типизированных ошибок, явных loading/error/empty состояний и retry без потери черновика.

### F21 — P3. Design/performance debt, не основание для полного редизайна

Семантические цветовые токены уже есть и их надо сохранить. Но часть warning использует light amber/white, а custom dark variant ожидает `.dark`, когда темы применяются как `.theme-*`. Множество загруженных шрифтов и основной JS 743 kB требуют замера, а не удаления тем наугад. Подтверждено отсутствие PRODUCT/DESIGN/GLOSSARY, но это пробел документации, не runtime bug. Денежные f64 — риск округлений, без подтверждённого денежного расхождения в этом ревью; отдельная необязательная миграция после решения о точности.

## 3. Целевые инварианты (предложения для утверждения)

1. Occurrence имеет identity исходного слота, отличную от actualStart. Повторный перенос не меняет исходную identity.
2. Parent — шаблон, не оплачиваемое занятие. Любая оплата относится к участнику конкретного occurrence.
3. Меняя заметку/ссылку, нельзя менять оплату, стоимость или остаток кредитов. Полная replacement-запись должна сохранять эти значения, partial mutation изменяет лишь названные поля.
4. `completed` и `no_show` с положительной ценой billable; `cancelled` non-billable, но видим. Past scheduled не создаёт долг. null/0 cost не входит в финансы и не расходует предоплату.
5. Серия «с этого и далее» режется по исходному выбранному слоту, НЕ по новой дате. Исторические finalized exceptions не удаляются. Политика пересечения новой серии с историей — explicit confirmation, не автоперенос истории.
6. Любая compound mutation и её журналирование — одна транзакция. Ошибка = никаких частичных изменений. Cache invalidation не является частью DB-транзакции и не запускает компенсационное удаление сохранённых данных.
7. Overlap интервал полуоткрытый `[start, end)`: окончание в 17:35 разрешает следующий старт в 17:35. Frontend preview — помощь; backend apply повторно проверяет текущий snapshot.
8. Наложение разрешается только явным подтверждением текущего payload. Не превращать warning string в флаг force.
9. UI показывает время в явно выбранной IANA timezone преподавателя. Формат 24h, любые минуты. DST gap/ambiguity не нормализуется молча.
10. Нельзя гарантировать бесконечный preview неограниченной серии. Предлагаемый горизонт 366 дней от первого изменяемого occurrence, проверка известных materialized exceptions за этим горизонтом, явное сообщение о горизонте. Требует продуктового согласования.
11. Секреты недоступны через обычный get_settings, photo command или asset root; отдельная миграция в OS secret storage с проверкой успешного чтения до очистки старого значения.
12. Browser/mock-тесты не заменяют native Windows/macOS smoke tests. Финальная приёмка не объявляется завершённой без этих отметок.

## 4. Целевая архитектура

Сохранить уже удачные решения: backend occurrence collector, generated IPC bindings, React Query query keys, существующий архив/undo, небольшие UI primitives. Не возвращать frontend expansion.

Текущий граф поведения:
`LessonForm / Drag / Reschedule / Telegram → собственные алгоритмы → create/update SQL`.

Целевой граф:
`Desktop forms + Drag → mutation command → schedule mutation module → occurrence resolver + repository + transaction + activity`;
`Telegram actions → тот же Rust mutation module`;
`Finance summary + Student finance + Debts → единый billable-occurrence projection`;
`Phone + Desktop + Jobs → один read model`.

Глубина модуля определяется тем, сколько identity/scope/atomicity деталей скрыто от caller, а не количеством строк. Не вводить pass-through слои ради папок.

### File map: существующие файлы

- `src-tauri/src/commands/lessons.rs`: сохранить IPC handlers; перенести compound mutation в доменный модуль, не дублировать его.
- `src-tauri/src/occurrences.rs`: чистая expansion/resolution; materialize пишет через общий mutation path.
- `src-tauri/src/commands/lessons/{overlaps,archive,repo}.rs`: единый slot matching, безопасный архив, batch hydration.
- `src-tauri/src/commands/{finance,students,students_bulk,settings}.rs`: переиспользовать finance/payment/backup implementation.
- `src-tauri/src/db/{mod,pool,migrations}.rs`: единая конфигурация connection, snapshot, безопасные версионированные миграции.
- `src-tauri/src/{telegram,http_server,scheduler}`: adapters, не независимые владельцы business rules.
- `src/lib/{api,lessonActions,recurrence,queryKeys}.ts`: typed IPC, адаптеры операций, форматирование, адресная инвалидация.
- `src/components/lesson/{LessonFormDialog,RescheduleDialog}.tsx`: session/draft/render, без самостоятельного split серии.
- `src/components/students/{StudentFormDialog,StudentsPanel}.tsx`, calendar/finance/settings/reminders: узкие view-state модули и единый error/retry UI.
- `src/components/ui/{dialog,time-picker}.tsx`, `src/index.css`: семантика, focus/layers, theme tokens.

### File map: новые файлы (создавать только в соответствующей задаче)

- `src-tauri/src/domain/{mod,identity,schedule_mutations,finance_projection,payments,validation}.rs`.
- `src-tauri/src/db/backup.rs`, `src-tauri/src/secrets.rs`, `src-tauri/src/telegram/delivery.rs`.
- `src/lib/{lessonMutation,dialogOperation,ipcErrors}.ts` и соседние тесты.
- `src/components/lesson/{LessonEditorFields,LessonEditorDetails,LessonEditorReminders}.tsx` — только представление, общий draft принадлежит editor.
- `src/components/ui/{AsyncFeedback,FieldError}.tsx` — если минимум два реальных caller, иначе локально.
- `tests/ui/` — fixture IPC и browser regression suite после утверждения runner.
- `.github/workflows/verify.yml` — независимый gate.

## 5. Целевой UX (не ребрендинг)

### Формы

- Заголовок и вкладки не уходят при прокрутке; один scrollable body; footer вне scroll. При 900×600 footer не перекрывает поля/overlay.
- Занятие: «Основное» (ученики, предмет, дата, время, длительность, краткое повторение, статус/оплата), «Материалы и заметки», «Напоминания». Не плодить ещё вкладки ради уменьшения файлов.
- Ученик: «Контакты», «Занятия и оплата», «Заметки». Для нового ученика фото после ввода имени доступно как явное необязательное действие, не обязательный window.confirm после записи.
- Вкладка с ошибкой получает индикатор; Save переводит на первую ошибку и ставит focus в поле. Значения всех вкладок сохраняются в одном draft при переключениях.
- Заголовок read card показывает ученика, дату и длительность. «Перенести…» — видимая secondary CTA. Delete — отделённое destructive действие. Закрытие dirty формы спрашивает о несохранённых изменениях; открытие переноса не теряет их молча.

### Время

- Поле 24h `ЧЧ:ММ`, ручной ввод любых минут, нормализация допустимых сокращений при blur/Enter; невалидный текст остаётся с локальной ошибкой, Save disabled. Не молча возвращать старое время.
- Clock trigger доступен Tab, имеет `aria-expanded`, `aria-controls`, `aria-label`; выбранные часы/минуты озвучиваются.
- Часы можно оставить двухкольцевыми, но геометрия должна исключать пересечения кнопок; min interactive target 24 CSS px с безопасным spacing, цель 32–40 для desktop. Если 24 часа не помещаются без overlap, использовать переключатель диапазона 00–11/12–23, а не уменьшать targets.
- Панель времени живёт в flow с собственным раскрываемым блоком либо в уже проверенном portaled overlay внутри modal focus scope. Предлагаемый первый вариант — in-flow disclosure: не требует новой зависимости и не обрезается overflow. Для больших форм раскрытие прокручивает панель в видимую область, не footer.
- Escape сначала закрывает часы и возвращает фокус в trigger, повторный Escape — форму. Enter на часовом button выбирает значение, а не закрывает/сохраняет родителя.
- Рядом интервал `17:40–18:40` и timezone. При переходе через полночь — `23:50–00:20 (+1 день)`.

### Overlap и сохранение

```
[Дата] [Время] [Длительность]   Europe/Moscow
17:40–18:40
[Проверяем… / Свободно / Конфликт с … / Не удалось проверить · Повторить]
...
[Удалить] [Перенести…]       [Отмена] [Сохранить]
```

- Warning рядом со временем и краткая строка в footer, а не одна строка внизу длинной формы.
- При конфликте основная CTA становится «Сохранить с наложением…», затем отдельное подтверждение списка конфликтов и области изменения. После изменения payload подтверждение сбрасывается.
- Pending: «Сохраняем…» и spinner; повторный click/Enter не вызывает новую mutation. Пользователь может закрыть после завершения либо оставить форму; stale result не закрывает новое занятие.
- Backend success + cache refresh fail: «Сохранено, не удалось обновить список · Повторить». Повторная запись не нужна.

### Визуальная ***

- Сохранить theme tokens bg/fg/card/primary/border/ring и текущий Lucide. Добавить semantic warning/success/error tokens, не светлые amber/bg-white в отдельных формах.
- Типографика и плотность — как incumbent, body 14–16px, подписи 12–14px; tabular nums для времени/денег. Не вводить декоративные hero, градиенты или новые фотографии.
- Информацию об оплате/отмене передавать текстом+иконкой, не только цветом.
- Подписи `label htmlFor=id`, `aria-invalid`, `aria-describedby`; кнопке Close имя в локали. Radio choices — настоящее radiogroup/radio либо aria-pressed toggle с подходящей семантикой.
- Calendar card: контейнер не button с вложенным интерактивным span. Основная кнопка открытия + соседняя настоящая кнопка переноса, видна на focus-within и touch; не hover-only.

---

## 6. Задачи реализации

Во всех задачах цикл: сначала воспроизводящий тест → убедиться в падении на baseline → минимальное изменение → целевой тест → общий gate → отдельный review/commit. Сообщения коммитов ниже — предлагаемые границы, а не разрешение сделать commit/push сейчас. При исполнении дополнить CHANGELOG по-русски вместе с соответствующим изменением.

### Task 1. Восстановить достоверный verification baseline (F18)

**Files:** `eslint.config.js`, `package.json`, `.github/workflows/verify.yml` (новый), тестовые команды существующего проекта. Не менять release/security policies для обхода ошибки.
**Interfaces:** scripts `verify:frontend` (tsc + eslint + vitest), `verify:backend` (cargo check/test/clippy); CI workflow использует те же команды. Постоянный UI runner — отдельное согласование; до него Python Playwright через утверждённый fixture harness.

- [x] Зафиксировать baseline результатов этого ревью; для ESLint добавить Node globals на `scripts/**/*.{js,mjs}` и `promo/scripts/**/*.mjs`, не игнорировать все скрипты.
- [x] Разобрать 22 errors: 18 no-undef — Node globals; 4 пустых catch в `promo/scripts/shoot.mjs` — намеренные best-effort шаги (taskkill/CDP poll/ws.close), `allowEmptyCatch` только для Node-скриптов. 27 React warnings оставлены: 17 set-state-in-effect (сброс форм при open — Task 4), 5 exhaustive-deps (нестабильные `?? []` — Task 14), 3 only-export-components, 2 incompatible-library (tanstack virtual).
- [x] Исправить Clippy failures локально без массовых allow. Структурные предупреждения в ещё не переработанных функциях зарегистрировать с причиной, не повышать их до runtime дефектов.
- [x] Добавить CI на pull_request/push: frontend + backend; release зависит от verify. Windows native build отдельно, macOS smoke перед релизом, не на каждое изменение документации. (CI не запускался — push не разрешён; проверено только локально.)
- [x] Проверка: обе verify команды exit 0; намеренно невалидный TS (tsc exit 2) и падающий unit test (vitest exit 1) делают gate красным. Тестовый fault не коммитить.
**Commit:** `chore: make verification a reliable release gate`.

### Task 2. Безопасная identity и cleanup исключений (F06)

**Files:** новые `domain/{mod,identity}.rs`; `commands/lessons/archive.rs`, `overlaps.rs`, `occurrences.rs`, `db/mod.rs`, `db/migrations.rs`, `lib.rs`.
**Interfaces:** `SlotKey { parent_id: String, local_date: NaiveDate }`; `parse_slot_key(parent_id: &str, raw: &str, tz: Tz) -> Result<SlotKey, DomainError>`; `InvalidSlot` хранит причину без персональных значений. Один slot per local day — текущий инвариант, не расширять до нескольких занятий одного parent в день без изменения модели.

- [x] Rust tests: `date_only_slots_on_different_days_are_not_deduped` (падал на baseline: обычное чтение удаляло 2 из Nстрок); `equivalent_offsets_resolve_same_slot`; `invalid_slot_is_reported_not_guessed` + `scan_groups_only_true_slot_duplicates`; `failed_cleanup_rolls_back_all_rows`; `instance_dedupe_archives_extra_rows_of_that_slot_only`.
- [x] На fixture создать parent + date-only exceptions 2026-11-09 и 2026-11-16; после init/cleanup обе должны остаться. Третий invalid key тоже остаётся, попадает в диагностический результат.
- [x] Убрать fallback timestamp=0. Все callers используют SlotKey; ranking один: completed > no_show > cancelled > scheduled, затем updated/created/id для детерминизма. Не выбирать разные winners в финансах и календаре. (Календарь `pick_exception` и create-путь — `identity::exception_rank`. Финансы/student finance разрешают исключения сами — переводятся в Task 7.)
- [~] Автоочистку перенести в версионированную контролируемую миграцию с архивом исходных строк и общей транзакцией; до готового безопасного snapshot не запускать разрушительные действия. Startup без миграции только диагностирует. — Сделано: глобальная очистка удалена со старта И с трёх read-путей (`get_lessons`, `get_lessons_for_student`, `expanded_lessons_in_range` — находка сверх ревью); старт только логирует scan. Осталось: применение очистки найденных дублей — миграция после Task 9.
- [x] `cargo test identity` и regression init tests pass. Parity на копии реальной БД: 4/4 pass (не skipped). Read-only dry-run на той же копии: Nисключения, все ключи RFC3339, date-only 0, invalid 0 — старый timestamp=0-merge на текущих данных пользователя не срабатывал. Копия удалена.
**Commit:** `fix: preserve distinct exception slots during normalization`.

### Task 3. Не менять индивидуальные оплаты при обычном edit (F03)

**Files:** `LessonFormDialog.tsx`, новый `src/lib/lessonMutation.ts` + `.test.ts`, `commands/lessons/repo.rs` tests.
**Interfaces:** `buildParticipantInputs(draft: LessonDraft, original: Lesson | null): LessonStudentInput[]`. Для существующего участника сохранять его paymentStatus, пока пользователь явно не менял оплату. Новому — выбранное default. Явный bulk «все оплачено/не оплачено» — отдельное действие draft, не побочный эффект.

- [x] Test `editing_notes_preserves_mixed_participant_payments`: A paid/100, B unpaid/80, общий unpaid; изменение notes сохраняет A paid, B unpaid и обе цены. (Падал на baseline: 6/7 красных.)
- [x] Test `explicit_mark_all_paid_updates_both`, `adding_participant_does_not_reset_existing`, `empty_school_cost_remains_null`, плюс `single_student_individual_cost_survives_unrelated_edit` (ls.cost ≠ l.cost после `students_bulk` массовой цены), `series_template_does_not_inherit_one_occurrence_payment`.
- [x] Выделить сборку payload из JSX, заменить безусловный null. Rust replacement semantics оставить документированными; partial mutation из Task 7 не должен терять поля. Для записи в шаблон серии (thisAndFuture/all) статус участников остаётся null → общий статус, как раньше (Task 6 переделает).
- [~] API fixture integration: Rust `replacement_with_explicit_member_payments_keeps_group_debt` (save_lesson_students → debt_lessons = только B=80) + `replacement_with_null_member_payment_follows_lesson_status` (документирует старое поведение). Сквозной UI→IPC→DB тест не выполнен — нет утверждённого UI runner.
- [x] `npm test -- lessonMutation` и backend payment tests; общий gate.
**Commit:** `fix: preserve group payment state on lesson edits`.

### Task 4. Session-scoped lifecycle сохранения (F09, F10, F14, F20)

**Files:** новые `src/lib/dialogOperation.ts`, `ipcErrors.ts` + tests; `api.ts`, LessonFormDialog, RescheduleDialog, StudentFormDialog; `types/generated.ts` через ts-rs при typed error.
**Interfaces:** `OperationState = idle | choosingScope | validating | confirmingOverlap | saving | savedRefreshError | error`; каждая операция несёт `sessionId` и `requestId`. Подтверждение conflict связано с неизменяемым draft snapshot, а не boolean warning. Поздний async result применяется только к своей session.

- [ ] Tests: `double_submit_sends_one_mutation`; `old_request_cannot_close_new_dialog`; `overlap_for_old_time_is_ignored`; `missing_student_error_does_not_authorize_force`; `changed_duration_invalidates_confirmation`; `retry_preserves_draft`.
- [ ] Разделить fieldErrors, conflictPreview, transportError. Проверка required → выбор scope → preview → explicit confirmation → apply. Scope не хранить между независимыми Save.
- [ ] Snapshot draft на submit; на время saving блокировать повторный submit и редактирование применяемых полей либо отменять операцию до отправки. Не делать вид, что UI cancel отменил уже committed backend.
- [ ] Ошибку перечитывания после commit показывать как refresh-error, не rollback. Все event handlers обрабатывают Promise rejection на понятном UI error boundary.
- [ ] Проверка медленным mock IPC: change A→B, ответ A приходит последним; UI B не меняется. `npm test -- dialogOperation` + browser fixture.
**Commit:** `fix: isolate dialog mutations and stale async results`.

### Task 5. Разблокировать time picker и доступность форм (F12, F13)

**Files:** `ui/time-picker.tsx`, `ui/dialog.tsx`, LessonFormDialog, RescheduleDialog, StudentFormDialog, CalendarViews, ru/en/be, UI regression tests.
**Interfaces:** `TimePickerProps` дополнить `invalid?: boolean`, `describedBy?: string`, `onValidityChange?: (valid: boolean) => void`; controlled value остаётся HH:mm, невалидный raw draft не превращается в старое валидное значение без сообщения.

- [ ] На baseline закрепить browser tests `time_picker_done_is_clickable_at_900x600`, `...1280x800`; hit-test должен быть false до исправления и true после.
- [ ] Сделать in-flow disclosure. Панель 24h с доступными targets, selected state; не использовать абсолютный popover внутри обрезаемого scroll body. При потребности в portal сначала протестировать focus scope, новую зависимость отдельно согласовать.
- [ ] Clock reachable by Tab; first Escape закрывает только панель, focus возвращается в trigger. Все inputs с label association, ошибки описаны через aria-describedby; Close локализован.
- [ ] Calendar action вынести из интерактивного родителя; radio scope сделать семантическим. Активная вкладка с ошибкой открывается по Save; required поля не теряются после tab switch.
- [ ] UI tests: enter 17:40, 23:50+30min→+1day; invalid 24:10 сохраняет текст и блокирует save; keyboard-only create/edit; touch emulation; light/dark, 900×600, 1280×800. Не объявлять WCAG AA по одному автоматическому скану.
**Commit:** `fix: make time selection and lesson forms accessible`.

### Task 6. Одна атомарная операция split/move серии (F01, F02, F11, F15)

**Files:** новый `domain/schedule_mutations.rs`; lessons.rs, occurrences.rs, archive.rs, lib.rs; api.ts, lessonActions.ts, LessonFormDialog, RescheduleDialog, CalendarViews.
**Interfaces:** Rust `apply_schedule_mutation(conn: &mut Connection, request: ScheduleMutationRequest) -> Result<MutationReceipt, DomainError>`; DTO генерируются. Request: `operation_id`, `target: LessonTarget`, `scope: This|ThisAndFuture|All`, `patch: LessonPatch`, `expected_updated_at`, `overlap_confirmation: Option<PreviewConfirmation>`. `LessonTarget = Row{id} | Slot{parent_id, original_start}`. Receipt: affected_ids, archive_id(optional), revision. Не прокидывать кодирование id как обязанность каждого caller.

- [ ] Connection/transaction ownership уточнить в DbPool: helper берёт mutable guard и создаёт ровно одну transaction; внутренние helpers не вызывают BEGIN повторно.
- [ ] Tests `split_failure_leaves_original_unchanged` (ошибка вставки children/reminders), `split_move_back_keeps_history_before_original_slot`, `split_keeps_finalized_exceptions`, `split_reparents_future_scheduled_exceptions_without_duplicates`.
- [ ] Tests COUNT=8/MO/02.11, clicked 23.11: old occurrences 02/09/16 сохраняются, new COUNT=5; новая дата раньше clicked не меняет old cutoff. Наложение с историей требует confirmation. Не применять min(old,new).
- [ ] По утверждённой политике перенести только будущие scheduled/cancelled исключения с сохранением identity mapping; finalized записи оставить историческими. Если mapping неоднозначен при смене BYDAY — отклонить без записи и показать список требующих решения исключений, не удалять их.
- [ ] Проверять результирующее состояние с исключением только заменяемых occurrences, в той же transaction. При отсутствии сторонних занятий перенос 18:00→17:40 не конфликтует с собственным старым положением. При 17:35 end граница свободна, 17:34 при end17:35 конфликтует.
- [ ] Tests INTERVAL=2, COUNT и UNTIL, first/last slot, moved exception, date-only legacy id, повтор operation_id, concurrent expected revision conflict.
- [ ] Desktop form, reschedule, drag вызывают единый IPC; удалить frontend create+truncate и компенсационный delete. Кэш обновляется после receipt, отдельно от сохранения.
- [ ] `cargo test schedule_mutations`, frontend mutation tests, parity suite на безопасной копии/fixture. Native smoke до объявления готовности.
**Commit boundary:** сначала Rust operation + tests, затем отдельный commit wiring всех adapters при сохранении старого IPC до завершения перехода.

### Task 7. Единые read projections и строгая валидация (F05, F11, F15, F20)

**Files:** новые `domain/validation.rs`, `finance_projection.rs`; models/mod.rs, occurrences.rs, finance.rs, students.rs, api.ts.
**Interfaces:** `ResolvedOccurrence` с row_id, SlotKey optional, actual_start, participants и winner metadata; `resolve_occurrences(conn, range, tz)` сначала подавляет slots, потом фильтрует суммы. `DomainError { code, field_errors, overlaps, retryable }` сериализуется, UI локализует code.

- [ ] Test zero-price exception suppresses paid parent; cancelled zero-price exception не возвращает родительскую выручку; moved exception учитывается один раз в actual period.
- [ ] Использовать один resolver для календаря и финансов; не копировать rank/local-date логику в student finance. Projection отличает billing horizon от expected horizon, не вводить скрытый годовой cutoff для lifetime debt.
- [ ] Boundary validation: RFC3339 parse независимо от force; duration integer 15..240; cost finite >=0 или null, валюта согласована с cost; nested students validate, duplicate student ids rejected; reminders finite integers >=0 с явной поддерживаемой верхней границей после UI согласования; recurrence COUNT/INTERVAL positive, BYDAY deduped.
- [ ] Tests malformed start with force=true rejected; invalid member payment rejected; unknown student rejected без частичной записи; null school prices accepted. parse_rule не должен молча превращать невалидное правило в другое расписание.
- [ ] Удалить string-prefix policy из callers после перехода всех commands. До полного перехода поддерживать адаптер старого OVERLAP, чтобы старые frontend callers не замолчали.
- [ ] `cargo test finance`, validation tests, equality test: сумма debt по StudentFinance == Debts == summary по валютам на общей fixture.
**Commit:** `refactor: resolve billing occurrences before finance classification` + отдельный `feat: return typed validation and conflict errors`.

### Task 8. Предоплата как атомарная оплата occurrence (F04)

**Files:** новый `domain/payments.rs`; students_bulk.rs, finance.rs, occurrences.rs, migrations.rs; student/payment UI.
**Interfaces:** `apply_prepaid(conn: &mut Connection, student_id: &str, operation_id: &str, limit: u32) -> Result<PrepaidReceipt, DomainError>`; receipt содержит materialized slot ids и remaining credits. Не списывать баланс за parent row.

- [ ] Tests: cancelled earliest, null/0 cost, partially paid group, virtual weekly slot, completed debt и scheduled future; school/cancelled не выбираются, одному виртуальному occurrence соответствует один credit.
- [ ] Согласовать приоритет: рекомендация — сначала старейшие billable completed/no_show долги, потом ближайшие scheduled платные occurrences. Никогда не оплачивать все будущие слоты изменением parent.payment_status.
- [ ] Выбор, materialize с reminders, participant payment, aggregate lesson status, кредитный баланс, activity — одна transaction. Fault после первого UPDATE откатывает всё. Повтор operation_id идемпотентен.
- [ ] Не переносить старый balance в денежный ledger без отдельной миграции. Текущая единица — количество занятий, не сумма денег; UI явно показывает это.
- [ ] `cargo test prepaid` и UI synthetic test остаток 2→1 после одной операции; повтор не списывает второй. Сверить debt/expected/earned по общему projection.
**Commit:** `fix: apply prepaid credits to billable occurrences atomically`.

### Task 9. Надёжные snapshot и миграции (F06, F07)

**Files:** новый `db/backup.rs`; db/mod.rs, pool.rs, migrations.rs, settings.rs, lib.rs, Cargo.toml (feature backup той же версии rusqlite).
**Interfaces:** `create_snapshot(source: &Connection, destination: &Path) -> Result<BackupReceipt, DomainError>` использует SQLite online backup; receipt — путь, schema version, integrity result. `open_connection(path, purpose)` одинаково применяет foreign_keys, busy timeout и journal policy.

- [ ] Добавление feature `backup` не меняет версию rusqlite без причины. Сверить API с документацией закреплённой версии.
- [ ] Tests WAL с committed записью без checkpoint, активный второй writer, locked/busy, недоступный destination, backup-to-source rejection. Snapshot после открытия проходит integrity_check и содержит committed fixture rows.
- [ ] Убрать fs::copy live main db и игнорирование checkpoint errors. Destination создаётся временно рядом, финальное имя появляется после успеха. Ошибка не затирает последнюю хорошую копию.
- [ ] Миграции версионированы, transactional где SQLite позволяет; создание snapshot до первой destructive migration. Rollback — восстановление всей согласованной версии при закрытых writers, не ручной откат отдельных таблиц.
- [ ] Single-instance решение до изменяющего init, проверить повторный запуск не делает cleanup/migrations/backup поверх активного процесса. Native smoke обязателен.
**Commit:** `fix: create consistent SQLite snapshots before migrations`.

### Task 10. Уменьшить renderer-доступ к данным и секретам (F08)

**Files:** settings.rs, telegram/mod.rs, новый secrets.rs, students_bulk.rs photo handler, tauri.conf.json, capabilities/default.json, api.ts, SettingsPanel.
**Interfaces:** `PublicSettings` — whitelist пользовательских настроек; `SecretStore` с OS adapter; `get_student_photo(student_id)` вместо произвольного path. UI получает bool tokenConfigured, не токен.

- [ ] Tests get_settings не возвращает secret values; arbitrary config/db файлы внутри TutorApp отвергаются photo reader; изображения за пределами students root, traversal и symlink-to-outside отвергаются; допустимые PNG/JPEG проходят после проверки сигнатуры/лимита.
- [ ] Ограничить asset scope каталогом фото, если asset protocol ещё необходим; не расширять CSP для удобства. Проверить macOS/Windows пути и canonicalization.
- [ ] OS storage dependency отдельно согласовать (пользователь ранее запретил новые установки в ходе ревью). Если не одобрено — сначала whitelist и photo fix; plaintext-at-rest отметить как остающийся риск, не объявлять исправленным.
- [ ] Миграция секрета: записать→прочитать/сравнить локально→пометить migration success→удалить старое значение внутри контролируемой операции. Ошибка keychain оставляет рабочую конфигурацию, без логирования значений.
- [ ] Проверка на fixture; реальные токены не запрашивать в чат и не печатать. Native keychain verification владелец подтверждает на обеих ОС.
**Commit:** photo/settings минимизация отдельно от secret-storage migration.

### Task 11. Вынести локальное время и recurrence math из UI (F15)

**Files:** domain/schedule_mutations.rs, identity.rs, occurrences.rs, contacts.ts, recurrence.ts, LessonFormDialog, CalendarViews, FinancePanel, RemindersPanel, settingsStore.
**Interfaces:** `LocalScheduleTime { date: YYYY-MM-DD, time: HH:mm, timezone: IANA }`; backend `resolve_local_time(input, ambiguity_choice?) -> Result<DateTime<Utc>, DomainError>`. Для DST fold выбор earlier/later явный, gap — ошибка с предложением допустимого времени, не сдвиг JS Date.

- [ ] Tests system zone UTC, tutor Europe/Moscow: ввод 17:Nзаписывает 14:40Z и везде показывает 17:40. Calendar range/day buckets используют tutor TZ, не *** weekday.
- [ ] Europe/Berlin 2026-03-29 02:30 отклоняется как nonexistent; 2026-10-25 02:30 требует выбора offset; обе версии round-trip предсказуемы.
- [ ] Удалить countWeeklyOccurrencesFrom из mutation пути; count remaining считает backend с INTERVAL/COUNT/UNTIL. Тест интервал=2 и серия старше пяти лет.
- [ ] Настройка timezone: UI предупреждает о влиянии на существующие серии; предложение — сохранить timezone series при создании отдельным полем, мигрировать existing от текущей настройки только с подтверждённой семантикой. Не менять молча все существующие времена.
- [ ] `cargo test` timezone/recurrence, frontend formatting tests, parity: TZ mismatch сценарии отдельно, frozen frontend oracle не объявлять абсолютной истиной там, где он заведомо отличается.
**Commit:** contract/conversion отдельно от потенциальной series-timezone migration.

### Task 12. Telegram и scheduler как adapters (F16)

**Files:** telegram/{handlers,jobs,mod}.rs, новый delivery.rs, scheduler/mod.rs, domain/{schedule_mutations,payments}.rs, occurrences.rs, migrations.rs.
**Interfaces:** `PendingDelivery { key, payload, attempts, next_attempt_at, status }`; `send_pending` переводит в sent только после успешного ответа. Retry backoff bounded, message может повториться при неясном сетевом исходе — это явно at-least-once.

- [ ] Fake sender tests fail→retry→success, restart между prepare/send, duplicate callback, Telegram 429 retry_after и permanent denied chat. Не вызывать настоящий Telegram в unit tests.
- [ ] Убрать mark-before-send и `let _ = send` без диагностики. Развести permanent/retryable errors; secret-free logs.
- [ ] Telegram apply_action вызывает тот же Rust mutation operation, что desktop. Materialize+copy participants+copy reminders+status/payment+activity атомарны. Реальное old status в логе, не hardcoded scheduled.
- [ ] Test Telegram mark unpaid occurrence scheduled exception не теряет reminders; mark paid group consistent и visible в UI после event/invalidation/poll.
- [ ] Scheduler: уточнить контракт catch-up после сна/простоя и early-fire. Рекомендация: не раньше due, bounded catch-up 5 минут; более старое — missed diagnostic. Использовать injectable clock, тест now=due-1s, due, due+30s, due+6min. Не менять политику без согласования.
**Commit:** domain adapters отдельно от delivery retry.

### Task 13. Phone server: ограниченный read-only adapter (F17)

**Files:** http_server.rs; общая read projection; DTO localizations; frontend phone settings.
**Interfaces:** `PhoneServerStatus = disabled|starting|listening|failed`; server readiness содержит actual bound address/port и sanitized error; request date range <=366 дней, from<=to, иначе 400.

- [ ] Tests bind failure отображается как failed, reset token дожидается shutdown и readiness нового listener; старый ключ отвергнут, данные при этом не меняются.
- [ ] Ограничить адреса/доступ выбранным LAN interface там, где это технически надёжно; не обещать, что фильтр сетевых интерфейсов равен firewall. UI явно предупреждает HTTP/LAN-only, удалённый доступ отдельно.
- [ ] Auth token не дублировать в обычных логах; query-key после открытия убрать из address bar через history.replaceState. Более защищённый pairing/token exchange — отдельное продуктовое решение; не выдумывать TLS для произвольного IP без управления сертификатами.
- [ ] Вынести blocking SQLite в spawn_blocking/эквивалент, bounds проверять до expansion; отдавать минимальный phone DTO. Связать cache с endpoint/identity, не показывать старой новой ссылке чужой cached dataset; на 401 очищать view/cache.
- [ ] Исправить no_show→«Не пришёл», cancelled→«Не состоялось» согласно утверждённой лексике; ru/en/be и timezone поведения явно отражены в DTO/page.
- [ ] HTTP tests без открытия реального LAN сервера; mobile browser portrait 390px отдельно от минимального desktop viewport 900px.
**Commit:** `fix: bound and expose phone server lifecycle safely`.

### Task 14. Локальность frontend и performance после исправления correctness (F19, F21)

**Files:** App.tsx, LessonFormDialog, StudentFormDialog, StudentsPanel, SettingsPanel, queryKeys.ts, settingsStore.ts, lessons/repo.rs, main.tsx, index.css.
**Interfaces:** presentation sections получают draft/actions/errors; не выполняют собственные mutations. Адресная invalidation принимает receipt affected lesson/student ids; broad fallback остаётся для *** legacy mutation.

- [ ] До изменений снять synthetic baseline: Nучеников, 10k lessons + 30 recurring parents + 1k exceptions; startup/route latency, SQL query count, IPC count, React profiler. Никаких обещанных процентов ускорения без измерения.
- [ ] RangeQuery enabled только когда данные реально используются (calendar/reminders соответствующих диапазонов). Settings-only edit не перечитывает все lessons.
- [ ] Batch hydrate participants/reminders одним запросом на набор row ids; tests сравнивают полный DTO со старой реализацией. Не вводить ORM и общий repository trait без второго реального adapter.
- [ ] Вынести поля формы по responsibility, а не по количеству строк; один владелец draft/lifecycle из Task 4. Сохранить student picker и nested dialog focus.
- [ ] Исследовать шрифты/subsets и lazy settings/students; сохранить поддержку кириллицы и все пользовательские темы. Build budget установить после измерения; не скрывать warning повышением лимита.
- [ ] Приёмка: no extra calendar IPC при переходе в настройки, ограниченное число hydration queries, regression suite unchanged; приложить before/after цифры.
**Commit:** query/batching отдельно от presentation split и font optimization.

### Task 15. UX состояния всех экранов и дизайн-токены (F13, F20, F21)

**Files:** TodayWidget, FinancePanel, PaymentDetailsPanel, StudentsPanel, HistoryPanel, RemindersPanel, SettingsPanel, UpdateNotifier, updateStore, index.css, ui/dialog, ru/en/be.
**Interfaces:** каждый query view явно различает loading/error/empty/data; mutation phase не сбрасывается фоновым refetch/checkNow. Semantic tokens warning/error/success заданы во всех темах.

- [ ] Synthetic fixtures: empty, slow, rejected, large, long Unicode names, mixed currencies, partial group payment, zero school price, closed/archived student, timezone mismatch. Для каждого экрана проверить error+retry, не «пусто» при отказе.
- [ ] Финансы: раздельные валюты, пояснить earned/expected/debt; долг lifetime не должен выглядеть как сумма выбранного периода без подписи. Не объединять валюты численно.
- [ ] Ученик: summary имя/контакты/ближайшее занятие/долг; правка defaults явно не переписывает историю. Вкладки сохраняют draft и ошибки, cost/currency bulk preview показывает число затрагиваемых records и scope.
- [ ] История: пагинация/limit guard; diff показывает реальное старое/новое; пустая история отдельно от ошибки. Reminders: due/snoozed/missed различимы текстом.
- [ ] Updater: проверка в фоне не переводит downloading/ready обратно в checking; repeated install single-flight; ошибка скачивания retry, не generic silent state. Это улучшение state model, не повторная публикация 0.2.3.
- [ ] *** light/dark/contrast и все остальные темы на token smoke; keyboard, 125/150% UI scaling и минимальное окно. Настоящий contrast считать по rendered colors; этот документ не утверждает текущий ratio.
**Commit:** несколько независимых экранных commits, не один «redesign everything».

### Task 16. Релизная воспроизводимость и финальная приёмка (F18)

**Files:** .github/workflows/release.yml, verify.yml; release skills/AGENTS только после согласования правил, changelog.
**Interfaces:** immutable release tag↔commit SHA↔version↔asset manifest. Manifest допускается только для успешных assets текущего build provenance; legacy mirror использует тот же готовый manifest.

- [ ] Validate manual release_tag разрешается в конкретный commit; checkout именно его. package.json/Cargo.toml/tauri config совпадают с тегом. Публикацию отдельным явным действием после приёмки.
- [ ] Manifest зависит от успешной обязательной Windows job, а не только prepare. Отсутствующий Mac маркируется как incomplete draft, продуктовая политика release gate согласуется; не делать вид, что полноценный cross-platform release готов.
- [ ] Tests/fixture workflow validation: failed Windows + старые .sig не порождают новый latest; missing Mac не удаляет старый опубликованный manifest; повтор run не переписывает published binary, а требует новой версии либо явного отдельного решения.
- [ ] Выполнить все frontend/backend checks и parity на synthetic/copy dataset, затем Windows WebView2 и macOS WKWebView smoke: create/edit/move/split/pay/prepaid/backup/restore/reminders/phone/update. Установщик и update требуют отдельного разрешения пользователя.
- [ ] Отчёт: commits, команды+exit codes, known limitations, migration/rollback evidence, native matrix. Никакого «всё готово» при пропущенных native checks.
**Commit:** workflow hardening отдельно от итогового changelog/версии. Версию/тег не создавать до release approval.

## 7. Порядок и зависимости

- Сначала независимые safety fixes: Tasks 1–5, 9–10. Task 2 destructive migration зависит от snapshot Task 9, но запрет unsafe deletion/нормализатор можно внедрить раньше.
- Core: Task 6 → общий resolver/validation Task 7 → prepaid Task 8. Identity из Task 2 обязательна перед новым split.
- Время Task 11 проектировать до окончательной фиксации DTO Task 6; внедрение timezone migration — отдельно, после решения пользователя.
- Telegram Task 12 и Phone Task 13 используют готовые core/read seams. Нельзя *** писать разные версии identity/payment logic.
- Frontend structure/performance Task 14 и polish Task 15 после correctness и операционных regression tests.
- Task 16 завершается только после всей выбранной волны; workflow verify из Task 1 действует с самого начала.
- Рекомендуемые волны: A safety+critical UX; B schedule+finance correctness; C adapters/timezone; D measured performance+visual polish. Каждая выпускается отдельно после приёмки, без обязательного ожидания полного roadmap.

## 8. Миграции, откат, совместимость

- Сначала добавлять поля/таблицы, dual-read старой identity на переходный период; не удалять legacy fields в той же версии.
- Dry-run отчёт только counts/ids; личные заметки, токены и контакты не экспортировать в аналитический отчёт.
- Snapshot включает схему/данные; фото backup отдельно обозначить как непокрытые, пока не добавлен application bundle backup. OS keychain не копировать в открытый .db backup.
- После миграции проверить foreign_key_check, integrity_check, counts и суммы по валютам, равенство calendar occurrence set с ожидаемой fixture, архив исходных дубликатов.
- Rollback к старому бинарнику допустим только если он читает новую схему без потери данных. Иначе закрыть приложение и восстановить согласованный snapshot; не откатывать один лишь version number.
- Старые IPC wrappers сохранять до перевода всех desktop callers; Telegram находится в том же бинарнике и переводится в одном release.
- Не переписывать уже опубликованные v0.2.3 installers/manifest для доставки этих изменений — новая версия после отдельного согласования.

## 9. ***, которые нужно утвердить перед исполнением соответствующих задач

1. Приоритет: сначала safety и регрессионные баги, потом визуальная переработка? Рекомендация — да, волны A/B раньше D.
2. Для «это и далее» история до исходного выбранного слота неизменна, даже если новая дата раньше? Рекомендация — да. Если новая серия пересекается с историей, явное предупреждение, не обрезка истории.
3. Существующие finalized/paid исключения при split остаются историческими; future scheduled переносятся лишь при однозначном mapping, иначе operation отклоняется с объяснением? Рекомендация — да.
4. Предоплата: oldest billable completed/no_show долги → ближайшие scheduled платные occurrences; school/null/0/cancelled никогда не расходуют кредит? Рекомендация — да.
5. Бесконечные серии: preview 366 дней и явное сообщение о границе, а не обещание проверить бесконечность? Рекомендация — да; horizon утвердить.
6. Timezone закрепляется за серией, а смена default timezone не сдвигает старые серии? Рекомендация — да, но это migration с отдельной спецификацией и preview.
7. «Вся серия» может ретроспективно менять finalized денежную историю? Рекомендация — нет по умолчанию; только отдельная явная историческая коррекция с архивом. Это продуктовая развилка, реализацию Task 6 all-scope не начинать до ответа.
8. Разрешены ли новые dev-зависимости для постоянных UI tests и OS secret-store библиотека? Рекомендация — согласовать минимальные отдельно; текущий запрет на установки в ревью соблюдён.

### Утверждено пользователем 2026-11-20

1. Да — safety/финансы (A/B) раньше визуальной полировки (D).
2. Да — cutoff «это и далее» по исходному выбранному слоту; пересечение с историей — явное предупреждение.
3. Да — finalized/paid исключения исторические; future scheduled переносятся только при однозначном mapping, иначе отказ с объяснением.
4. Да — предоплата: старейшие платные completed/no_show долги → ближайшие scheduled платные; null/0/cancelled кредит не расходуют.
5. Горизонт preview неограниченных серий — 366 дней.
6. Да — timezone закрепляется за серией; миграция отдельной спецификацией, не в волне A.
7. Да — «вся серия» не меняет finalized денежную историю неявно.
8. Локальные коммиты на каждую проверенную задачу разрешены (без push/тегов). Новые зависимости — нет; согласовывать по одной.

## 10. Self-review плана

- Каждая F01–F21 имеет task owner; риск f64 не превращён в несанкционированную глобальную миграцию денег.
- Устранение split/оплат не зависит от косметического JSX split. Новые модули имеют реальные повторные callers, а не гипотетические adapters.
- Сигнатуры в документе — целевые, не заявление, что они уже существуют. DTO генерируются из Rust; не копировать ручные TS unions без проверки контракта.
- Задачи с неоднозначной бизнес-семантикой явно gated разделом 9; не передавать дочерней сессии как утверждённый policy.
- Все пять review-focus рисков покрыты конкретными named tests. Regression на уровне чистой функции не заменяет wiring/browser/native tests.
- Нативная приёмка, полный coverage и Rust CVE остаются непроверенными; отчёт не обещает отсутствия других дефектов.

## 11. Промт исполнителю после согласования

«Работай в E:\Work\tutor-app. Прочитай AGENTS.md и .devin/plans/2026-11-20-comprehensive-review-refactoring.md целиком. Сначала получи ответы на неутверждённые решения раздела 9 и уточни выбранную волну. Не реализуй весь roadmap одним PR. Используй уже доступные skills по соответствующей задаче; не запускай подагентов без разрешения. Сначала воспроизведи named regression на synthetic/in-memory данных, затем исправляй, затем проверяй. Не меняй рабочую БД и не запускай destructive cleanup. SQL/migration/backup — только после safe-migration и snapshot tests. Не устанавливай зависимости, не делай push, тег, публикацию или установку без отдельного разрешения. Каждое завершённое изменение сопровождай русским CHANGELOG и реальными результатами проверок. Не называй mock Chromium тестом настоящего Tauri/macOS. Не выдавай skipped parity за pass. Если обнаружится неверное предположение этого плана, приведи доказательство, скорректируй task и согласуй изменение бизнес-семантики».
