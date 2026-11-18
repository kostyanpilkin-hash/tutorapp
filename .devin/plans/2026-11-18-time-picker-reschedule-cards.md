# План: свободное время, единый TimePicker, переработка переноса, вкладки в карточках

> **Для исполнителя:** выполнять задачи по порядку, чекбоксы `- [ ]` отмечать. Каждая задача — атомарный коммит. Проект: `E:\Work\tutor-app` (НЕ `C:\Users\***\Projects\tutor-app`). Shell — git-bash. Перед коммитом каждой задачи: `npx tsc --noEmit` + `npm test` (+ `cargo test` при изменениях в `src-tauri`).

**Цель:** свободный ввод времени везде (не только :00/:30), единый компонент выбора времени с циферблатом, видимая кнопка «Перенести», вкладки вместо длинного скролла, и исправление двух подтверждённых багов переноса серий.

**Архитектура:** новый компонент `TimePicker` (deep module — маленький интерфейс `value/onChange`, сложность внутри); объединение двух reschedule-диалогов в один `RescheduleDialog` с выбором скоупа; excludeId-логика вынесена в один helper; бэкенд сам исключает exception-строки слота из overlap-проверки.

**Стек:** React + TS + Tailwind + Radix (dialog/select/tabs/switch — popover НЕТ в deps, не добавлять), zustand, date-fns, Tauri commands (`check_overlaps`, `create_lesson`, `update_lesson`), vitest, cargo test.

## Глобальные ограничения

- i18n обязателен для ВСЕХ новых строк: `src/i18n/locales/ru.ts`, `en.ts`, `be.ts` — три ключа сразу.
- Версия/бамп НЕ нужен — это не релизный план, только код + CHANGELOG.
- `parseLocalDateTime(date, time)` из `src/lib/recurrence.ts` — единственный способ собрать локальную дату-время (не `new Date("YYYY-MM-DD HH:mm")`).
- Идентификаторы занятий: виртуальный экземпляр серии — `lesson.id` вида `parent::<rfc3339>` (содержит `::`), реальная строка (в т.ч. exception) — обычный uuid. `isRecurrenceInstance()` и `parentLessonId()` уже есть в `src/lib/recurrence.ts`.
- Диалоги nested: `StudentPickerDialog`, `RecurrenceScopeDialog`, `PaymentCompleteDialog` открываются поверх формы — `DialogContent` не должен демонтироваться при переключении вкладок.
- CHANGELOG.md пополнять по-русски, сгруппировано по темам, в последнем коммите.

## Review Focus (риски, которые надо прикрыть)

1. Повторный перенос exception-строки на время, пересекающееся с её текущим положением — сейчас молчаливый OVERLAP (главный баг). Тест — Task 2.
2. `pendingScope`/`scopeOpen`/`overlapWarning` протекают между открытиями формы — сброс. Проверка — Task 1.
3. Ввод времени не по шаблону («9:5», «1735», «17:», пусто) — парсер с юнит-тестами, Task 3.
4. Длительность через полночь (23:50 + 30 мин) — end-label и overlap должны считать корректно; проверка в Task 5.
5. Nested-диалоги над формой с вкладками — футер и scope/payment диалоги остаются вне Tabs, Task 5/6.

---

### Task 1: Фикс протекающего состояния и молчаливого OVERLAP в LessonFormDialog

**Files:**
- Modify: `src/components/lesson/LessonFormDialog.tsx`

**Interfaces:**
- Consumes: существующие `api.checkOverlaps`, `api.createLesson`, `api.updateLesson`, `overlapNamesFromError` из `@/lib/api`.
- Produces: корректное состояние формы между открытиями; повторный перенос exception работает.

**Контекст бага:** `pendingScope` ставится в `RecurrenceScopeDialog.onSelect` (строки ~996-1000) и нигде не сбрасывается; кнопка «Сохранить» вызывает `save(pendingScope || undefined)` — после первого выбора «только это» все серии сохраняются молча с этим скоупом. Компонент смонтирован один раз в `App.tsx` — состояние живёт до перезапуска приложения.

- [x] **Шаг 1: сброс транзиентного состояния**

  В `useEffect`, срабатывающем на `open` (тот, что делает `setOverlapWarning(null)` в конце, ~строка 280), добавить:
  ```ts
  setPendingScope(null);
  setScopeOpen(false);
  setPaymentPromptOpen(false);
  setPickerOpen(false);
  ```

- [x] **Шаг 2: кнопка «Сохранить» без протекающего скоупа**

  Кнопка `onClick={() => void save(pendingScope || undefined)}` (~строка 972) → `onClick={() => void save()}`.
  Кнопка «Сохранить всё равно» в overlap-warning (~строка 960) → тоже `save()`.
  `pendingScope` остаётся только мостиком: scope-диалог → payment-prompt → doSave. Убедиться, что `handlePaymentChoice` и `RecurrenceScopeDialog.onSelect` используют `setPendingScope(scope)` + передают scope явно — как сейчас.

- [x] **Шаг 3: правильная ветка записи для scope="this"**

  В `doSave`, ветка `scope === "this"` (~строки 396-402): сейчас всегда `api.createLesson({...input, recurrenceParentId: parentId, recurrenceInstanceDate: instanceDate})`. Разделить:
  ```ts
  if (scope === "this" && (lesson.recurrenceRule || isRecurrenceInstance(lesson))) {
    if (lesson.recurrenceParentId && !lesson.id.includes("::")) {
      // Уже материализованная exception-строка — это обновление, не создание.
      await api.updateLesson(lesson.id, input);
    } else {
      await api.createLesson({
        ...input,
        recurrenceRule: null,
        recurrenceParentId: parentId,
        recurrenceInstanceDate: instanceDate,
      });
    }
  }
  ```

- [x] **Шаг 4: видимость OVERLAP-ошибки**

  `api.call()` глотает OVERLAP-тосты (`api.ts:33`). В `doSave` обернуть весь блок записи (от `if (lesson) {` до конца `await api.createLesson(input)` ветки else) в `try/catch`:
  ```ts
  } catch (e) {
    const names = overlapNamesFromError(e);
    if (names !== null) {
      setOverlapWarning(`${t("lesson.overlap")}: ${names}. ${t("lesson.overlapConfirm")}`);
      return;
    }
    throw e;
  }
  ```
  Импорт `overlapNamesFromError` добавить в существующий импорт `api` (~строка 7).

- [x] **Шаг 5: проверки**

  Run: `npx tsc --noEmit` — чисто. `npm test` — 28/28.

- [x] **Шаг 6: коммит**

  `fix: сброс pendingScope и корректный update exception-строки при "только это занятие"`

---

### Task 2: Бэкенд — исключение exception-строк слота из overlap-проверки create_lesson

**Files:**
- Modify: `src-tauri/src/commands/lessons.rs` (функция `create_lesson`, строки ~146-183)
- Modify: `src-tauri/src/commands/lessons/overlaps.rs` (helper)
- Test: тот же `src-tauri/src/commands/lessons.rs` (модуль `#[cfg(test)]` внизу ***, там уже есть `find_overlaps_*` тесты на ~1042+)

**Interfaces:**
- Produces: в `overlaps.rs` — `pub(crate) fn exception_row_ids(conn: &Connection, parent_id: &str, instance_date: &str, tz: chrono_tz::Tz) -> Result<Vec<String>, String>` — id всех строк `lessons WHERE recurrence_parent_id=?`, у которых `parse_any_date(recurrence_instance_date, tz)` совпадает с локальной датой `instance_date`.

**Контекст бага:** `create_lesson` при `recurrence_parent_id`+`recurrence_instance_date` проверяет overlaps с `exclude = parent::inst` — это исключает виртуальный слот, но НЕ существующую exception-строку того же слота. Повторный перенос на пересекающееся время → OVERLAP-ошибка. Теперь, когда фронт чинен (Task 1), это defence-in-depth для других вызывающих.

- [x] **Шаг 1: падающий тест**

  В модуле тестов `lessons.rs` (по образцу `find_overlaps_excludes_instance_and_slot` ~1097): создать parent-серию `p1` (weekly, старт 18:00), вставить exception-строку `e1` с `recurrence_parent_id='p1'`, `recurrence_instance_date=<inst ISO>`, `start_at=18:00`. Вызвать внутренний путь проверки: `find_overlaps(conn, new_start_17:40, 60, Some("p1::<inst>"))` и отдельно новый helper — убедиться, что тест на исключение `e1` через `exception_row_ids` падает до реализации. Ожидаемый результат после фикса: `[]` (e1 исключена).

- [x] **Шаг 2: helper в overlaps.rs**

  ```rust
  pub(crate) fn exception_row_ids(
      conn: &Connection,
      parent_id: &str,
      instance_date: &str,
      tz: chrono_tz::Tz,
  ) -> Result<Vec<String>, String> {
      let slot_date = crate::occurrences::parse_any_date(instance_date, tz);
      let mut stmt = conn
          .prepare("SELECT id, recurrence_instance_date FROM lessons WHERE recurrence_parent_id = ?1")
          .map_err(|e| e.to_string())?;
      let rows = stmt
          .query_map([parent_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
          .map_err(|e| e.to_string())?;
      Ok(rows
          .filter_map(|r| r.ok())
          .filter(|(_, d)| crate::occurrences::parse_any_date(d, tz) == slot_date)
          .map(|(id, _)| id)
          .collect())
  }
  ```

- [x] **Шаг 3: расширенный find_overlaps**

  В `overlaps.rs` добавить внутренний вариант, принимающий набор row-id для исключения:
  ```rust
  pub(crate) fn find_overlaps_excluding_rows(
      conn: &Connection,
      start: DateTime<Utc>,
      duration_minutes: i64,
      exclude_id: Option<&str>,
      extra_exclude_rows: &[String],
  ) -> Result<Vec<OverlapInfo>, String>
  ```
  Тело — как у `find_overlaps`, плюс `if extra_exclude_rows.iter().any(|x| x == &occ.row_id) { continue; }`. `find_overlaps` становится тонким делегатом: `find_overlaps_excluding_rows(conn, start, dur, exclude_id, &[])`.

- [x] **Шаг 4: вызов в create_lesson**

  В `create_lesson` (~строки 167-182): там где `parent.is_none() || moved` и `(Some(p), Some(inst))` — собрать `let extra = exception_row_ids(conn, p, inst, tz)?;` и вызвать `find_overlaps_excluding_rows(conn, start, dur, exclude.as_deref(), &extra)`. `tz` — `crate::occurrences::timezone(conn)`. Вынести проверку в `with_conn` так, чтобы `conn` был доступен для helper (сейчас `find_overlaps` уже вызывается внутри `with_conn` — helper туда же).

- [x] **Шаг 5: проверки**

  Run: `cd src-tauri && cargo test` — все тесты зелёные (53+), включая новый.

- [x] **Шаг 6: коммит**

  `fix: create_lesson исключает exception-строки слота при проверке пересечений`

---

### Task 3: Компонент `TimePicker` — поле + циферблат

**Files:**
- Create: `src/components/ui/time-picker.tsx`
- Create: `src/lib/timeInput.ts` (чистые функции — тестируемо)
- Test: `src/lib/timeInput.test.ts`
- Modify: `src/i18n/locales/{ru,en,be}.ts` (ключи `timePicker.*`)

**Interfaces:**
- Produces:
  ```ts
  // timeInput.ts
  export function parseTimeInput(raw: string): string | null; // "HH:mm" 24h или null
  // "1735"→"17:35", "9:5"→"09:05", "9"→"09:00", "24:00"→null, "17:"→"17:00"

  // time-picker.tsx
  export interface TimePickerProps {
    value: string;                 // "HH:mm"
    onChange: (v: string) => void;
    id?: string;
    disabled?: boolean;
  }
  export function TimePicker(props: TimePickerProps): JSX.Element;
  ```

**Дизайн (Operate):** поле ввода `HH:mm` (тот же визуал что `Input`), справа внутри кнопка-иконка `Clock` (lucide). Клик → инлайн-панель под полем (absolute, `relative`-обёртка, `z-40`, `bg-card border rounded-lg shadow-lg p-3`); закрытие по outside-click (listener на document в `useEffect`) и `Escape`. Внутри: переключатель «Часы/Минуты» (два маленьких сегмента), круг ~200px:
- Часы: два кольца — внешнее 12–23, внутреннее 00–11 (12 позиций каждое), выбранный час — `bg-primary text-primary-foreground`, hover `bg-muted`.
- Минуты: одно кольцо 00–55 шаг 5.
- Под диском: степперы `−1`/`+1` и `−5`/`+5` мин (произвольные минуты через ввод И степперы) + кнопка «Готово».
- Поведение: выбор часа → авто-переход на минуты; выбор минут → onChange + закрыть? Нет — оставить открытым до «Готово»/outside (чтобы можно было докрутить). При выборе минуты сразу `onChange`.
- Клавиатура: стрелки в input не обязательны — typing покрывает. `Enter` в панели = «Готово».

- [x] **Шаг 1: падающие тесты парсера**

  `src/lib/timeInput.test.ts`: кейсы `"17:35"→"17:35"`, `"1735"→"17:35"`, `"9:5"→"09:05"`, `"9"→"09:00"`, `"07"→"07:00"`, `"24:00"→null`, `"17:60"→null`, `"ab"→null`, `""→null`, `"17:"→"17:00"`, `" 12 : 30 "`→"12:30"`. Витest — стиль по образцу `src/lib/parity.test.ts`.

- [x] **Шаг 2: `parseTimeInput` в `src/lib/timeInput.ts`**

  Trim → если `HH:MM`/`H:M` → нормализовать в `HH:mm`; если 3-4 цифры подряд → разбить; если 1-2 цифры → `HH:00`. Валидация: `0<=h<24`, `0<=m<60`.

- [x] **Шаг 3: тесты зелёные**

  `npm test -- timeInput` — все кейсы pass.

- [x] **Шаг 4: компонент `TimePicker`**

  По спецификации выше. Импорты: `Input` из `@/components/ui/input`, `Button` из `@/components/ui/button`, `Clock`/`ChevronUp`/`ChevronDown` (или `Minus`/`Plus`) из `lucide-react`, `cn` из `@/lib/utils`, `useTranslation` для `timePicker.hours/minutes/done`. Состояние: `open`, `mode: "hours" | "minutes"`, `draft` (сырой текст поля). onBlur поля: `parseTimeInput(draft)` → если валидно `onChange(parsed)`, иначе вернуть `value`.
  Диск: `viewBox` SVG не нужен — div-кружки через абсолютное позиционирование по углу (`transform: rotate/translate`) или простая математика `left/top` по `cos/sin`; 12 кнопок `h-8 w-8 rounded-full` на радиусе.

- [x] **Шаг 5: i18n ключи**

  В `ru.ts`: `timePicker: { hours: "Часы", minutes: "Минуты", done: "Готово" }`; `en.ts`: `"Hours"/"Minutes"/"Done"`; `be.ts`: `"Гадзіны"/"Хвіліны"/"Гатова"`.

- [x] **Шаг 6: проверки + коммит**

  `npx tsc --noEmit`, `npm test`. Коммит: `feat: TimePicker — поле ввода с циферблатом часов/минут`

---

### Task 4: Единый `RescheduleDialog` + кнопки «Перенести»

**Files:**
- Create: `src/components/lesson/RescheduleDialog.tsx` (заменяет `RescheduleLessonDialog` + `RescheduleSeriesDialog` — старые файлы удалить)
- Modify: `src/components/lesson/useLessonContextMenu.tsx`
- Modify: `src/App.tsx` (маунт диалогов ~395-396)
- Modify: `src/components/lesson/LessonFormDialog.tsx` (кнопка «Перенести» в футере)
- Modify: `src/components/calendar/CalendarViews.tsx` (hover-иконка на карточке)
- Modify: `src/lib/lessonActions.ts` (helper excludeId)
- Modify: `src/i18n/locales/{ru,en,be}.ts`

**Interfaces:**
- Produces:
  ```ts
  // zustand-стор в RescheduleDialog.tsx
  export const useRescheduleStore = create<{
    lesson: Lesson | null;
    open: (lesson: Lesson) => void;
    close: () => void;
  }>;
  // lessonActions.ts
  export function overlapExcludeId(lesson: Lesson, scope?: "this" | "thisAndFuture" | "all"): string;
  ```

**Поведение диалога (единое):**
- Блок сверху: имя ученика + длительность (как сейчас).
- Поле даты (`type="date"`, по умолчанию дата экземпляра), поле времени — `TimePicker` из Task 3, рядом вычисляемый конец `→ HH:mm`.
- Если `lesson.recurrenceRule || lesson.recurrenceParentId || lesson.id.includes("::")` — выбор скоупа: две радио-карточки «Только это занятие» / «Это и все следующие» (тексты — существующие `lesson.rescheduleThis`/`rescheduleSeries` ключи). Иначе скрыть.
- Debounce 300мс на смену даты/времени/скоупа → `api.checkOverlaps(startAt, duration, excludeId)` → если overlap: warning-бар у поля времени `lesson.overlap + имена` (amber, как в форме). Сохранять разрешено ВСЕГДА (единая политика «предупредить, но разрешить»): при overlap → `force: true` в записи.
- Сохранение: скоуп `this`/разовое → `persistLessonChange(lesson, { startAt })` — но с force: расширить `persistLessonChange` вторым параметром `opts?: { force?: boolean }`, прокинуть в `LessonInput.force`. Скоуп серии → `rescheduleSeriesFromInstance(lesson, time)` + если дата изменилась — отдельно (см. ниже).

**Важно — семантика серийного переноса:** `rescheduleSeriesFromInstance(lesson, time)` принимает только время и двигает с текущего экземпляра. Если пользователь сменил И дату — для серии это «сдвиг серии»: применить `rescheduleSeriesFromInstance` со временем И заодно `withUntil`/новую серию с новой даты — проще: скоуп «это и далее» с датой D и временем T = обрезать старую серию до D и создать новую серию с теми же bydays, стартом D+T. Расширить `rescheduleSeriesFromInstance(lesson, date: Date)` — внутри уже `hh/mm` берутся из даты; сейчас она принимает `time: string` и использует `instanceDate` — поменять сигнатуру на `(lesson, newStart: Date)` (единственный вызывающий — RescheduleSeriesDialog, который удаляется).

- [x] **Шаг 1: `overlapExcludeId` в lessonActions.ts**

  ```ts
  export function overlapExcludeId(
    lesson: Lesson,
    scope?: "this" | "thisAndFuture" | "all",
  ): string {
    if (scope === "all" || scope === "thisAndFuture") return parentLessonId(lesson);
    return lesson.id;
  }
  ```
  (Для серийного переноса исключаем всю серию — она режется/пересоздаётся.)

- [x] **Шаг 2: `persistLessonChange` + force**

  Сигнатура `(lesson, patch, opts?: { force?: boolean })`; в `LessonInput` проставить `force: opts?.force ?? false`. Все существующие вызовы без изменений.

- [x] **Шаг 3: `rescheduleSeriesFromInstance(lesson, newStart: Date)`**

  Текущая реализация берёт `hh/mm` из строки и `slot` = instanceDate. Новая: `slot` остаётся instanceDate-числом для обрезки старой серии (`until = endOfDay(addDays(slot, -1))` — если дата изменилась, обрезать до новой даты-1? Нет: серия режется «с экземпляра X», а НОВАЯ серия стартует `newStart`. Если `newStart` раньше экземпляра — обрезать до `newStart - 1 день`? Проще и корректно: новая серия начинается с `newStart`; старая обрезается `until = min(instanceDate, newStart) - 1 day` — брать `endOfDay(addDays(min(slot, newStart), -1))`.) Остальная логика (count/remaining/bydays) — без изменений, `newStart.toISOString()` в `createLesson`.

- [x] **Шаг 4: `RescheduleDialog`**

  Стор + разметка по спецификации выше. `save()`:
  ```ts
  const start = parseLocalDateTime(date, time);
  const excludeId = overlapExcludeId(lesson, scope);
  const overlaps = await api.checkOverlaps(start.toISOString(), lesson.durationMinutes, excludeId);
  const force = overlaps.length > 0;
  if (scope === "series") await rescheduleSeriesFromInstance(lesson, start);
  else await persistLessonChange(lesson, { startAt: start.toISOString() }, { force });
  ```
  OVERLAP-ошибку от бэкенда ловить → warning-бар (не молчать). Успех → `useToastStore.getState().success(t("lesson.movedToast"))` + close.

- [x] **Шаг 5: проводка**

  - `useLessonContextMenu`: два пункта «Перенести»/«Перенести серию» заменить одним «Перенести…» → `useRescheduleStore.getState().open(lesson)` (подменю убрать; пункт не submenu, прямой).
  - `App.tsx`: `<RescheduleLessonDialog />` + `<RescheduleSeriesDialog />` → `<RescheduleDialog />` (+ импорт).
  - Удалить `RescheduleLessonDialog.tsx`, `RescheduleSeriesDialog.tsx` и все импорты их сторов (`useRescheduleLessonStore`, `useRescheduleSeriesStore` — grep по проекту, заменить на `useRescheduleStore`).
  - `LessonFormDialog` футер: между «Удалить» и «Отмена/Сохранить» кнопка `variant="outline"` «Перенести» (`CalendarClock` icon) → `onClose()` + `useRescheduleStore.getState().open(lesson)` (только когда `lesson` существует; в new-режиме не показывать).
  - `CalendarViews` `DraggableLessonCard`: при hover — маленькая иконка `CalendarClock` в углу карточки (`opacity-0 group-hover:opacity-100`), `onClick` → `e.stopPropagation()` + `useRescheduleStore.getState().open(lesson)`; `title={t("lesson.rescheduleAction")}`.

- [x] **Шаг 6: i18n**

  Проверить существующие ключи `lesson.reschedule*`, при необходимости добавить `lesson.rescheduleScopeThis`/`rescheduleScopeSeries` подписи и `lesson.rescheduleHint`. Удалить `rescheduleNoSlots`/`rescheduleAvailableTime` если больше не используются — НЕ удалять (могут использоваться телеграм-ботом/phone — проверить grep, если только диалог — удалить).

- [x] **Шаг 7: проверки + коммит**

  `npx tsc --noEmit`, `npm test`. Коммит: `feat: единый диалог переноса — произвольное время, скоуп серии, кнопки в форме и на карточках`

---

### Task 5: Вкладки в LessonFormDialog + TimePicker в форме

**Files:**
- Modify: `src/components/lesson/LessonFormDialog.tsx`
- Modify: `src/components/settings/SettingsPanel.tsx` (input `type="time"` ~строка 691 → `TimePicker`)

**Interfaces:**
- Consumes: `TimePicker` из Task 3, `Tabs` из `@/components/ui/tabs` (проверить наличие *** `src/components/ui/tabs.tsx` — Radix Tabs есть в package.json; если обёртки нет — создать по образцу `select.tsx`).

**Структура вкладок** (`Tabs defaultValue="main"`, `TabsList` из 3 `TabsTrigger`):
- `main` «Основное»: FormSection «Кто и когда» (ученики, предмет, дата, **TimePicker**, длительность+end-label) + FormSection «Повторение» + FormSection «Статус и оплата».
- `links` «Ссылки и заметки»: FormSection ссылок (link, materialsLink, notes, заметки по ученикам, materials).
- `reminders` «Напоминания»: FormSection напоминаний.
- ВНЕ Tabs: timezoneHints (если есть — они про «когда», показывать всегда), overlap-warning, футер (Удалить / Перенести / Отмена / Сохранить).
- `StudentPickerDialog`, `RecurrenceScopeDialog`, `PaymentCompleteDialog` — как сейчас, вне Tabs.

- [ ] **Шаг 1: `ui/tabs.tsx` обёртка (если нет)**

  Стандартная shadcn-обёртка Radix Tabs (List/Trigger/Content, `cn`, токены `bg-muted`, `data-[state=active]:bg-background`) — по образцу `src/components/ui/select.tsx`.

- [ ] **Шаг 2: перегруппировка JSX**

  FormSection-ы разложить по `TabsContent`. DialogContent оставить `max-h-[90vh] overflow-hidden p-0`; Tabs — внутри скролляемой области; футер и warning — закрепить (`sticky bottom-0 bg-card border-t` или просто вне скролл-контейнера: разбить `p-6` контент на `overflow-y-auto` зону + `border-t px-6 py-3` футер).

- [ ] **Шаг 3: TimePicker в форме**

  `<Input type="time" value={time}…>` (~строка 621) → `<TimePicker value={time} onChange={setTime} />`. То же в `SettingsPanel` (~строка 691). `endTimeLabel` уже считается от `time` — работает.

- [ ] **Шаг 4: проверки + коммит**

  `npx tsc --noEmit`, `npm test`. Коммит: `feat: вкладки в карточке занятия, TimePicker в форме и настройках`

---

### Task 6: Вкладки в StudentFormDialog

**Files:**
- Modify: `src/components/students/StudentFormDialog.tsx`

**Структура вкладок:**
- `contacts` «Контакты»: фото+кнопки, имя, телефон, email, мессенджер, блок «Родители», дата рождения.
- `lessons` «Занятия»: таймзона, стоимость/валюта/длительность, оплаченные занятия, ссылка по умолчанию, цвет.
- `notes` «Заметки»: notes (+LinkifiedText).
- Футер (Отмена/Сохранить) и три nested-диалога (валюта/стоимость/ссылка) — вне Tabs.

- [ ] **Шаг 1-3:** та же Tabs-обёртка, разбивка существующих блоков, футер вне вкладок.

- [ ] **Шаг 4: проверки + коммит**

  `feat: вкладки в карточке ученика`

---

### Task 7: CHANGELOG + финальная проверка

- [ ] **CHANGELOG.md** — секция за сегодня: «Перенос и время»: свободное время везде, циферблат, кнопка «Перенести» в форме и на карточках, вкладки в карточках; «Исправления»: залипание скоупа «только это», мёртвая кнопка при повторном переносе, невидимые ошибки пересечений.
- [ ] Полный прогон: `npx tsc --noEmit`, `cd src-tauri && cargo test`, `npm test`.
- [ ] Ручной сценарий (описать в отчёте, пользователь проверит): перенос серийного 18:00→17:40; повторный перенос того же 17:40→18:00; правка ДРУГОГО занятия серии → должен спросить скоуп; создание занятия на 9:15 через циферблат и через ввод; пересечение → warning + «всё равно» сохраняет.
- [ ] Коммит + push `HEAD:main`.
