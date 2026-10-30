# Волна 3: React Query — по компоненту за раз

## Статус: к исполнению (новый тред)

Цель: убрать ручные `refresh`/`reload`-пропсы и `useEffect`+`api`+`setState` — заменить на `useQuery`/`useMutation` с инвалидацией по ключам. Данные обновляются везде автоматически после мутаций.

## Подготовка

1. `npm i @tanstack/react-query` (уже есть `@tanstack/react-virtual` — то же семейство).
2. `QueryClientProvider` в `src/main.tsx`, `staleTime` ~30с, `retry: 1`.
3. Файл `src/lib/queryKeys.ts` — единая фабрика ключей.

## Конвенция ключей (queryKeys.ts)

- `keys.lessons.range(from,to)` → `["lessons","range",fromISO,toISO]` — расписание (`loadExpandedLessons`)
- `keys.lessons.today()` → `["lessons","today"]`
- `keys.lessons.detail(id)` → `["lessons","detail",id]`
- `keys.students.all()` → `["students"]`
- `keys.students.finance(id)` → `["students","finance",id]`
- `keys.finance.report(period,anchor)` → `["finance","report",period,anchorISO]`
- `keys.finance.debts()` → `["finance","debts"]`
- `keys.activityLog(filter)` → `["activity",filter]`
- `keys.settings()` → `["settings"]`

Инвалидация после мутаций занятий: `["lessons"]` (префикс покрывает range+today+detail) + `["finance","debts"]` + `["students","finance"]` при оплате.

## Порядок (по панели за коммит, каждая — свой коммит)

1. **lessonStore → useQuery** — самый связанный узел: `expanded`/`todayLessons` становятся `useQuery(keys.lessons.range)`/`useQuery(keys.lessons.today)`; `refresh` = `invalidateQueries`. App.tsx упрощается. Внимание: `lessonsVersion`/`onMoved` колбэки заменить инвалидацией.
2. **StudentsPanel** — `getStudents`, `getStudentFinance`, `getStudentLessons`, история.
3. **FinancePanel** — `getFinanceReport`, `getDebtLessons`; `markDebtPaid` → `useMutation` + инвалидация `["finance"]`, `["lessons"]`.
4. **RemindersPanel, HistoryPanel** — `getFiredReminders`, `getActivityLog`.
5. **SettingsPanel / settingsStore** — последним: стор хранит локальное состояние; оценить, оставить ли Zustand для настроек (вероятно да — это локальный UI-state, не серверные данные).

## Ловушки

- `loadExpandedLessons` принимает Date — в `queryFn` стабильные параметры (ISO-строки), не объекты.
- Tauri-команды не HTTP: `useQuery` дружественен, но `refetchOnWindowFocus` отключить (десктоп, фокус частый).
- Экшен-флоу в `lessonActions.ts`/контекстном меню — после мутаций заменить `onChanged`/`refresh` на инвалидацию `["lessons"]`.
- Тосты об успехе/ошибке остаются в `onSuccess`/`onError` мутаций.

## Критерий приёмки

- Ни одного ручного `refresh`-пропса/колбэка между панелями; `grep "onMoved|refreshKey"` пуст.
- После действия (оплата/статус/перенос/бот-сайд-эффекты) все видимые виды обновляются сами.
- `/verify` зелёный после каждой панели; визуальная проверка Сегодня/Календарь/Финансы/Ученики/Журнал/Напоминания.
