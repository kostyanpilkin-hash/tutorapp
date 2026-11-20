import { invoke } from "@tauri-apps/api/core";
import type { Lesson, LessonInput, OverlapInfo, FinanceReport } from "@/types/lesson";
import type { Student, StudentFinance, StudentInput, StudentSettingsLog, DebtEntry, ActivityLogEntry } from "@/types/student";
import type { FiredReminderEntry, TgStatus, TgConnectResult } from "@/types/generated";
import { useToastStore } from "@/stores/toastStore";
import { queryClient } from "@/lib/queryClient";
import { keys } from "@/lib/queryKeys";

export type { FiredReminderEntry };

function errMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const msg = String((e as { message: unknown }).message);
    // If it's a validation error from Rust, it will be in format "Ошибка валидации: {...}"
    if (msg.includes("Ошибка валидации")) {
      return msg;
    }
    return msg;
  }
  return "Неизвестная ошибка";
}

export function overlapNamesFromError(e: unknown): string | null {
  const msg = errMessage(e);
  return msg.startsWith("OVERLAP:") ? msg.slice("OVERLAP:".length) : null;
}

async function call<T>(fn: () => Promise<T>, opts?: { silent?: boolean }): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!opts?.silent && overlapNamesFromError(e) === null) {
      useToastStore.getState().error(errMessage(e));
    }
    throw e;
  }
}

export const api = {
  getLessons: (from: string, to: string) =>
    call(() => invoke<Lesson[]>("get_lessons", { from, to })),

  getExpandedLessons: (from: string, to: string) =>
    call(() => invoke<Lesson[]>("get_expanded_lessons", { from, to })),

  getLesson: (id: string) => call(() => invoke<Lesson>("get_lesson", { id })),

  createLesson: (input: LessonInput) =>
    call(() => invoke<Lesson>("create_lesson", { input })),

  updateLesson: (id: string, input: LessonInput) =>
    call(() => invoke<Lesson>("update_lesson", { id, input })),

  /** "This and following": one backend transaction; returns the new series. */
  splitLessonSeries: (parentId: string, instanceDate: string, input: LessonInput, ruleOverride: string | null) =>
    call(() => invoke<Lesson>("split_lesson_series", { parentId, instanceDate, input, ruleOverride })),

  deleteLesson: (id: string) => call(() => invoke<void>("delete_lesson", { id })),

  deleteLessonSeries: (id: string) => call(() => invoke<void>("delete_lesson_series", { id })),

  deleteLessonSeriesFromInstance: (id: string, instanceDate: string) =>
    call(() => invoke<string>("delete_lesson_series_from_instance", { id, instanceDate })),

  restoreLessonArchive: (archiveId: string) =>
    call(() => invoke<void>("restore_lesson_archive", { archiveId })),

  updateLessonStatus: (id: string, status: string, paymentStatus?: string) =>
    call(() =>
      invoke<Lesson>("update_lesson_status", {
        id,
        status,
        paymentStatus: paymentStatus ?? null,
      }),
    ),

  checkOverlaps: (startAt: string, durationMinutes: number, excludeId?: string) =>
    call(() =>
      invoke<OverlapInfo[]>("check_overlaps", {
        startAt,
        durationMinutes,
        excludeId: excludeId ?? null,
      }),
    ),

  getTodayLessons: () => call(() => invoke<Lesson[]>("get_today_lessons")),

  getFiredReminders: (limit?: number) =>
    call(() => invoke<FiredReminderEntry[]>("get_fired_reminders", { limit: limit ?? null })),

  getSettings: () => call(() => invoke<Record<string, string>>("get_settings")),

  setSetting: async (key: string, value: string) => {
    await call(() => invoke<void>("set_setting", { key, value }));
    await queryClient.invalidateQueries({ queryKey: keys.settings() });
  },

  snoozeReminder: (
    lessonId: string,
    instanceStart: string,
    minutesBefore: number,
    snoozeMinutes: number,
  ) =>
    call(() =>
      invoke<void>("snooze_reminder", {
        lessonId,
        instanceStart,
        minutesBefore,
        snoozeMinutes,
      }),
    ),

  appInfo: () => call(() => invoke<{ version: string; platform: string }>("app_info")),

  getDbPath: () => call(() => invoke<string>("get_db_path")),

  backupDatabase: () => call(() => invoke<string | null>("backup_database")),

  createDesktopShortcut: () => call(() => invoke<void>("create_desktop_shortcut")),

  getFinanceReport: (period: string, anchor: string, customFrom?: string, customTo?: string) =>
    call(() =>
      invoke<FinanceReport>("get_finance_report", {
        period,
        anchor,
        customFrom: customFrom ?? null,
        customTo: customTo ?? null,
      }),
    ),

  getStudents: (includeArchived = false) =>
    call(() => invoke<Student[]>("get_students", { includeArchived })),

  getStudent: (id: string) => call(() => invoke<Student>("get_student", { id })),

  createStudent: (input: StudentInput) =>
    call(() => invoke<Student>("create_student", { input })),

  updateStudent: (id: string, input: StudentInput) =>
    call(() => invoke<Student>("update_student", { id, input })),

  archiveStudent: (id: string, archived: boolean) =>
    call(() => invoke<Student>("archive_student", { id, archived })),

  pickStudentPhoto: (studentId: string) =>
    call(() => invoke<string | null>("pick_student_photo", { studentId })),

  removeStudentPhoto: (studentId: string) =>
    call(() => invoke<Student>("remove_student_photo", { studentId })),

  getStudentLessons: (studentId: string) =>
    call(() => invoke<Lesson[]>("get_student_lessons", { studentId })),

  getStudentFinance: (studentId: string) =>
    call(() => invoke<StudentFinance>("get_student_finance", { studentId })),

  applyPrepaidLessons: (studentId: string) =>
    call(() => invoke<void>("apply_prepaid_lessons", { studentId })),

  updateStudentLessonsCurrency: (studentId: string, currency: string, cost: number) =>
    call(() => invoke<void>("update_student_lessons_currency", { studentId, currency, cost })),

  countStudentLessonsForLinkUpdate: (studentId: string, link: string | null) =>
    call(() => invoke<number>("count_student_lessons_for_link_update", { studentId, link })),

  updateStudentLessonsLink: (studentId: string, link: string | null) =>
    call(() => invoke<number>("update_student_lessons_link", { studentId, link })),

  getStudentSettingsLog: (studentId?: string) =>
    call(() => invoke<StudentSettingsLog[]>("get_student_settings_log", { studentId })),

  getActivityLog: (category?: string, limit?: number, offset?: number) =>
    call(() => invoke<ActivityLogEntry[]>("get_activity_log", { category, limit, offset })),

  getPhoneLink: () => call(() => invoke<string | null>("get_phone_link")),
  getPhoneLinks: () => call(() => invoke<string[]>("get_phone_links")),

  tgStatus: () => call(() => invoke<TgStatus>("tg_status")),
  tgConnect: (token: string) =>
    call(() => invoke<TgConnectResult>("tg_connect", { token })),
  tgDisconnect: () => call(() => invoke<void>("tg_disconnect")),
  tgPreferences: () =>
    call(() =>
      invoke<{ offsets: number[]; fields: string[]; digest_time: string; quiet_from: string; quiet_to: string }>(
        "tg_preferences",
      ),
    ),
  tgTest: () => call(() => invoke<void>("tg_test")),
  resetPhoneKey: () => call(() => invoke<void>("reset_phone_key")),
  setPhoneServer: (enabled: boolean) =>
    call(() => invoke<void>("set_phone_server", { enabled })),

  getDebtLessons: () =>
    call(() => invoke<DebtEntry[]>("get_debt_lessons")),

  markDebtPaid: (lessonId: string, studentId: string) =>
    call(() => invoke<void>("mark_debt_paid", { lessonId, studentId })),

  getStudentPhotoDataUrl: (path: string) =>
    call(() => invoke<string>("get_student_photo_data_url", { path }), { silent: true }),
};
