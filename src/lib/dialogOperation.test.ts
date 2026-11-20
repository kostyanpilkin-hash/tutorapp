import { describe, expect, it } from "vitest";
import { conflictFor, createGeneration, mayForce, overlapKey, singleFlight, type OverlapPayload } from "./dialogOperation";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const payload: OverlapPayload = { startAt: "2026-11-23T14:40:00.000Z", durationMinutes: 60, scope: null };

describe("singleFlight", () => {
  it("double_submit_sends_one_mutation", async () => {
    let calls = 0;
    const d = deferred<string>();
    const save = singleFlight(async () => {
      calls += 1;
      return d.promise;
    });
    const first = save();
    const second = save(); // click + Enter
    expect(save.isRunning()).toBe(true);
    d.resolve("ok");
    expect(await first).toBe("ok");
    expect(await second).toBeUndefined();
    expect(calls).toBe(1);
  });

  it("retry_after_error_is_possible", async () => {
    let calls = 0;
    const save = singleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error("backend");
      return "saved";
    });
    await expect(save()).rejects.toThrow("backend");
    expect(save.isRunning()).toBe(false);
    expect(await save()).toBe("saved");
    expect(calls).toBe(2);
  });
});

describe("createGeneration", () => {
  it("old_request_cannot_close_new_dialog", async () => {
    const session = createGeneration();
    const closed: string[] = [];
    const d = deferred<void>();
    const a = session.begin(); // dialog opened for lesson A
    const pending = d.promise.then(() => {
      if (session.isCurrent(a)) closed.push("A");
    });
    session.begin(); // user closed A and opened B
    d.resolve();
    await pending;
    expect(closed).toEqual([]);
  });

  it("overlap_for_old_time_is_ignored", async () => {
    const previews = createGeneration();
    const shown: string[] = [];
    const slow = deferred<string>();
    const fast = deferred<string>();
    const g1 = previews.begin(); // 18:00
    const p1 = slow.promise.then((r) => previews.isCurrent(g1) && shown.push(r));
    const g2 = previews.begin(); // user changed to 17:40
    const p2 = fast.promise.then((r) => previews.isCurrent(g2) && shown.push(r));
    fast.resolve("clear 17:40");
    slow.resolve("conflict 18:00");
    await Promise.all([p1, p2]);
    expect(shown).toEqual(["clear 17:40"]);
  });
});

describe("overlap confirmation", () => {
  it("missing_student_error_does_not_authorize_force", () => {
    // A field error is not a conflict: there is nothing to confirm.
    expect(mayForce(null, payload)).toBe(false);
  });

  it("seen_but_unconfirmed_conflict_does_not_force", () => {
    expect(mayForce({ key: overlapKey(payload), names: "Anna", confirmed: false }, payload)).toBe(false);
  });

  it("confirmed_conflict_forces_same_payload", () => {
    expect(mayForce({ key: overlapKey(payload), names: "Anna", confirmed: true }, payload)).toBe(true);
  });

  it("changed_duration_invalidates_confirmation", () => {
    const confirmed = { key: overlapKey(payload), names: "Anna", confirmed: true };
    const longer = { ...payload, durationMinutes: 90 };
    expect(mayForce(confirmed, longer)).toBe(false);
    expect(conflictFor(confirmed, longer)).toBeNull();
    expect(mayForce(confirmed, { ...payload, startAt: "2026-11-23T15:00:00.000Z" })).toBe(false);
    expect(mayForce(confirmed, { ...payload, scope: "thisAndFuture" })).toBe(false);
  });
});
