import type { Lesson, LessonStudentInput, PaymentStatus } from "@/types/lesson";

export interface ParticipantDraft {
  selectedIds: string[];
  customGroupCosts: boolean;
  studentCosts: Record<string, { cost: string; currency: string }>;
  cost: string;
  currency: string;
  paymentStatus: PaymentStatus;
}

/**
 * Participant rows for a full lesson replacement (create/update_lesson).
 *
 * The backend fills `null` cost/currency/paymentStatus from the lesson-level
 * values, so `null` means "follow the lesson". For an existing participant we
 * send back its stored values unless the user explicitly changed the
 * corresponding lesson-level field: editing notes or the subject must not
 * reset individual payments or prices.
 */
export function buildParticipantInputs(draft: ParticipantDraft, original: Lesson | null): LessonStudentInput[] {
  const originalPayment = original?.paymentStatus || "unpaid";
  const paymentChanged = original != null && draft.paymentStatus !== originalPayment;
  const lessonCostChanged =
    original != null &&
    (draft.cost !== (original.cost?.toString() || "") ||
      (draft.cost !== "" && draft.currency !== (original.currency || "USD")));
  const originalCustom =
    original != null && original.students.length > 1 && original.students.some((s) => s.cost != null);
  const customChanged = draft.customGroupCosts !== originalCustom;

  return draft.selectedIds.map((id) => {
    const prev = original?.students.find((s) => s.studentId === id);
    const paymentStatus = paymentChanged ? draft.paymentStatus : (prev?.paymentStatus ?? null);

    const sc = draft.studentCosts[id];
    if (draft.customGroupCosts && sc) {
      return {
        studentId: id,
        cost: sc.cost ? Number(sc.cost) : null,
        currency: sc.cost ? sc.currency : null,
        paymentStatus,
      };
    }
    if (prev && !lessonCostChanged && !customChanged) {
      return { studentId: id, cost: prev.cost, currency: prev.currency, paymentStatus };
    }
    return { studentId: id, cost: null, currency: null, paymentStatus };
  });
}

/**
 * Participants written into a series parent (template). One occurrence's
 * individual payments must not become the payment state of every generated
 * slot, so payment follows the lesson-level status as before.
 */
export function templateParticipants(students: LessonStudentInput[]): LessonStudentInput[] {
  return students.map((s) => ({ ...s, paymentStatus: null }));
}
