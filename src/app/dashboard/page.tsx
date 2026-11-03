import fs from "node:fs/promises";
import path from "node:path";
import { DashboardClient } from "@/components/DashboardClient";
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
  const rows = buildDashboardRows(db.purchases);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 max-w-prose text-muted">
          Everything your agent tried to buy, in one place. Ask the AI on the right for a new chart in plain words.
        </p>
      </div>
      <div className="relative left-1/2 h-[78vh] min-h-[620px] w-[min(1280px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-paper">
        <DashboardClient purchases={rows.purchases} items={rows.items} initialState={initialState} />
      </div>
    </div>
  );
}
