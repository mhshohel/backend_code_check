export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

/** A clock that tests move forward explicitly instead of sleeping. */
export type ManualClock = Clock & { set(date: Date): void; advanceMs(ms: number): void };

export function createManualClock(start: Date = new Date()): ManualClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (date) => {
      current = date.getTime();
    },
    advanceMs: (ms) => {
      current += ms;
    },
  };
}

/**
 * Real time plus an adjustable offset. Rows stamped by PostgreSQL's now()
 * stay consistent with it, while tests can still jump past a lease or a hold.
 */
export function createOffsetClock(): ManualClock {
  let offsetMs = 0;
  return {
    now: () => new Date(Date.now() + offsetMs),
    set: (date) => {
      offsetMs = date.getTime() - Date.now();
    },
    advanceMs: (ms) => {
      offsetMs += ms;
    },
  };
}
