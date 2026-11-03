import type { Db } from "./types";

const DAY = 86_400_000;

/** "Now" as the demo sees it: the real clock plus any demo time travel. */
export function demoNow(db: Pick<Db, "demoClockDays">): Date {
  return new Date(Date.now() + (db.demoClockDays ?? 0) * DAY);
}

export const addDays = (iso: string | Date, days: number) => new Date(new Date(iso).getTime() + days * DAY).toISOString();
