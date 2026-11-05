import fs from "node:fs/promises";
import path from "node:path";
import { DashboardClient } from "@/components/DashboardClient";
import { demoNow } from "@/lib/clock";
import { buildDashboardRows, withAndWithout } from "@/lib/dashboard-data";
import { usd } from "@/lib/money";
import { readSharedDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function loadLayout(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "src", "lib", "dashboard-layout.json"), "utf8"));
  } catch {
    return undefined;
  }
}

export default async function DashboardPage() {
  const [db, initialState] = await Promise.all([readSharedDb(), loadLayout()]);
  const ww = withAndWithout(db.purchases, db.cases);
  const rows = buildDashboardRows(db.purchases, { policy: db.policy, now: demoNow(db), cases: db.cases });
  return (
    <div className="relative left-1/2 flex w-[min(1180px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 max-w-prose text-muted">
          Maya&apos;s spending statement: everything ShopBot tried to buy, and what Minder did about it. Built with AG Studio, so you can ask for a new chart in
          plain words.
        </p>
        {db.purchases.length > 0 && (
          <p className="mt-3 max-w-prose text-[15px]">
            Without Minder: <strong className="tabular-nums">{usd(ww.withoutMinder)}</strong> would have gone out. With Minder:{" "}
            <strong className="tabular-nums">{usd(ww.withMinder)}</strong>
            {ww.tricked > 0 && ww.trickedPaid === 0 ? ", none of it to a store that tricked the agent" : ""}
            {ww.recovered > 0 ? `, and ${usd(ww.recovered)} came back through PayPal` : ""}.
          </p>
        )}
      </div>
      <div>
        <DashboardClient rows={rows} initialState={initialState} />
      </div>
    </div>
  );
}
