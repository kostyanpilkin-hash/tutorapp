import { describe, expect, it } from "vitest";
import { buildParticipantInputs, templateParticipants, type ParticipantDraft } from "./lessonMutation";
import type { Lesson, LessonStudent } from "@/types/lesson";

function member(studentId: string, cost: number | null, currency: string | null, paymentStatus: string): LessonStudent {
  return { studentId, name: studentId, cost, currency, paymentStatus, color: null, timezone: null, lessonNote: "" };
}

function lesson(students: LessonStudent[], extra: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1",
    studentName: "",
    subject: "Math",
    startAt: "2026-11-23T14:00:00.000Z",
    durationMinutes: 60,
    cost: null,
    currency: null,
    link: null,
    materialsLink: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    recurrenceInstanceDate: null,
    color: null,
    notes: "",
    materials: "",
    status: "completed",
    paymentStatus: "unpaid",
    students,
    reminders: [],
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

// Draft exactly as LessonFormDialog initializes it from `original`.
function draftFrom(original: Lesson): ParticipantDraft {
  const studentCosts: ParticipantDraft["studentCosts"] = {};
  for (const s of original.students) {
    if (s.cost != null) studentCosts[s.studentId] = { cost: String(s.cost), currency: s.currency || "USD" };
  }
  return {
    selectedIds: original.students.map((s) => s.studentId),
    customGroupCosts: original.students.length > 1 && Object.keys(studentCosts).length > 0,
    studentCosts,
    cost: original.cost?.toString() || "",
    currency: original.currency || "USD",
    paymentStatus: (original.paymentStatus || "unpaid") as ParticipantDraft["paymentStatus"],
  };
}

describe("buildParticipantInputs", () => {
  const group = lesson([member("A", 100, "USD", "paid"), member("B", 80, "USD", "unpaid")]);

  it("editing_notes_preserves_mixed_participant_payments", () => {
    const out = buildParticipantInputs(draftFrom(group), group);
    expect(out).toEqual([
      { studentId: "A", cost: 100, currency: "USD", paymentStatus: "paid" },
      { studentId: "B", cost: 80, currency: "USD", paymentStatus: "unpaid" },
    ]);
  });

  it("explicit_mark_all_paid_updates_both", () => {
    const out = buildParticipantInputs({ ...draftFrom(group), paymentStatus: "paid" }, group);
    expect(out.map((s) => s.paymentStatus)).toEqual(["paid", "paid"]);
  });

  it("adding_participant_does_not_reset_existing", () => {
    const draft = draftFrom(group);
    const out = buildParticipantInputs({ ...draft, selectedIds: [...draft.selectedIds, "C"] }, group);
    expect(out[0].paymentStatus).toBe("paid");
    expect(out[1].paymentStatus).toBe("unpaid");
    expect(out[2]).toEqual({ studentId: "C", cost: null, currency: null, paymentStatus: null });
  });

  it("empty_school_cost_remains_null", () => {
    const school = lesson([member("S", null, null, "unpaid")], { cost: null, currency: null, status: "scheduled" });
    const out = buildParticipantInputs(draftFrom(school), school);
    expect(out).toEqual([{ studentId: "S", cost: null, currency: null, paymentStatus: "unpaid" }]);
  });

  it("single_student_individual_cost_survives_unrelated_edit", () => {
    // ls.cost can diverge from lessons.cost after a bulk student-cost update.
    const single = lesson([member("A", 120, "EUR", "paid")], { cost: 100, currency: "USD", paymentStatus: "paid" });
    const out = buildParticipantInputs(draftFrom(single), single);
    expect(out).toEqual([{ studentId: "A", cost: 120, currency: "EUR", paymentStatus: "paid" }]);
  });

  it("changing_lesson_cost_applies_to_non_custom_participants", () => {
    const single = lesson([member("A", 100, "USD", "unpaid")], { cost: 100, currency: "USD" });
    const out = buildParticipantInputs({ ...draftFrom(single), cost: "150" }, single);
    expect(out).toEqual([{ studentId: "A", cost: null, currency: null, paymentStatus: "unpaid" }]);
  });

  it("series_template_does_not_inherit_one_occurrence_payment", () => {
    const out = templateParticipants(buildParticipantInputs(draftFrom(group), group));
    expect(out.map((s) => s.paymentStatus)).toEqual([null, null]);
    expect(out.map((s) => s.cost)).toEqual([100, 80]);
  });

  it("new_lesson_uses_lesson_defaults", () => {
    const draft: ParticipantDraft = {
      selectedIds: ["A", "B"],
      customGroupCosts: false,
      studentCosts: {},
      cost: "50",
      currency: "USD",
      paymentStatus: "unpaid",
    };
    expect(buildParticipantInputs(draft, null)).toEqual([
      { studentId: "A", cost: null, currency: null, paymentStatus: null },
      { studentId: "B", cost: null, currency: null, paymentStatus: null },
    ]);
  });
});
