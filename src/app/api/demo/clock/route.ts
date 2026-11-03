import { updateDb } from "@/lib/db";
import { checkDeliveries } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Demo time travel: jump ahead so late deliveries show up, then let Chaperone's watchdog run. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { addDays?: number; reset?: boolean };
  const days = await updateDb((db) => {
    db.demoClockDays = body.reset ? 0 : Math.min(60, (db.demoClockDays ?? 0) + Math.max(0, Math.min(30, Number(body.addDays) || 0)));
    return db.demoClockDays;
  });
  const opened = await checkDeliveries();
  return Response.json({ demoClockDays: days, casesOpened: opened });
}
