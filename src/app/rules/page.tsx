import { RulesEditor } from "@/components/RulesEditor";
import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const db = await readDb();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">Rules</h1>
        <p className="mt-2 max-w-prose text-muted">
          Tell Minder how your agent may spend, the way you would tell a person. It turns your words into limits it checks on every purchase.
        </p>
      </div>
      <RulesEditor initialText={db.rulesText} initialPolicy={db.policy} />
    </div>
  );
}
