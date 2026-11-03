import { RulesEditor } from "@/components/RulesEditor";
import { readDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const db = await readDb();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Rules</h1>
        <p className="mt-2 max-w-prose text-muted">
          Tell Chaperone how your agent may spend, the way you would tell a person. It turns your words into limits it checks on every purchase.
        </p>
      </div>
      <RulesEditor initialText={db.rulesText} initialPolicy={db.policy} />
    </div>
  );
}
