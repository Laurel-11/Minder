import { readSharedDb } from "@/lib/db";
import { simulateRules, type RuleChanges } from "@/lib/studio-tools";

export const dynamic = "force-dynamic";

/** For the dashboard's rules agent: replay past purchases under changed rules. Changes nothing. */
export async function POST(request: Request) {
  const changes = (await request.json().catch(() => ({}))) as RuleChanges;
  try {
    return Response.json(simulateRules(await readSharedDb(), changes));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
