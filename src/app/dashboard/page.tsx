import fs from "node:fs/promises";
import path from "node:path";
import { DashboardClient } from "@/components/DashboardClient";
import { demoNow } from "@/lib/clock";
import { buildDashboardRows } from "@/lib/dashboard-data";
import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function loadLayout(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "src", "lib", "dashboard-layout.json"), "utf8"));
  } catch {
    return undefined;
  }
}

export default async function DashboardPage() {
  const [db, initialState] = await Promise.all([readDb(), loadLayout()]);
  const rows = buildDashboardRows(db.purchases, { policy: db.policy, now: demoNow(db), cases: db.cases });
  return (
    <div className="relative left-1/2 flex w-[min(1180px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 max-w-prose text-muted">
          Maya&apos;s spending statement: everything ShopBot tried to buy, and what Chaperone did about it. Built with AG Studio, so you can ask for a new chart in
          plain words.
        </p>
      </div>
      <div>
        <DashboardClient rows={rows} initialState={initialState} />
      </div>
    </div>
  );
}
