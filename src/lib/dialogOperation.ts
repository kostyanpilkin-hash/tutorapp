/**
 * Lifecycle helpers for dialog mutations: one save at a time, late results
 * never touch a newer dialog session, overlap confirmation is bound to the
 * exact payload that was confirmed, and only the newest preview is shown.
 */

/** Wraps an async action so repeated calls while it runs are ignored. */
export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  let running = false;
  const run = async (...args: A): Promise<R | undefined> => {
    if (running) return undefined;
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
  return Object.assign(run, { isRunning: () => running });
}

/**
 * Monotonic token. `begin()` starts a new session (dialog opened for another
 * lesson, closed, or a newer preview request) and returns its id; anything
 * holding an older id is stale.
 */
export function createGeneration() {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (id: number) => id === current,
  };
}

/** Fields whose change invalidates a previously confirmed overlap. */
export interface OverlapPayload {
  startAt: string;
  durationMinutes: number;
  scope: string | null;
}

export function overlapKey(p: OverlapPayload): string {
  return `${p.startAt}|${p.durationMinutes}|${p.scope ?? ""}`;
}

/** A conflict the user saw for one specific payload. */
export interface OverlapConflict {
  key: string;
  names: string;
  confirmed: boolean;
}

/** Force is allowed only for an explicitly confirmed conflict of this payload. */
export function mayForce(conflict: OverlapConflict | null, payload: OverlapPayload): boolean {
  return !!conflict && conflict.confirmed && conflict.key === overlapKey(payload);
}

/** Drops a conflict that belongs to a different payload than the current one. */
export function conflictFor(conflict: OverlapConflict | null, payload: OverlapPayload): OverlapConflict | null {
  return conflict && conflict.key === overlapKey(payload) ? conflict : null;
}

export type PreviewState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "clear" }
  | { kind: "conflict"; names: string }
  | { kind: "error" };
