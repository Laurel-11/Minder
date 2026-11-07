import fs from "node:fs/promises";
import path from "node:path";
import { adminAllowed, adminDenied } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Save a self-test report to logs/, so results can be read later (and quoted in the README). */
export async function POST(request: Request) {
  if (!adminAllowed(request)) return adminDenied();
  const { kind, markdown, json } = (await request.json().catch(() => ({}))) as { kind?: string; markdown?: string; json?: unknown };
  if ((kind !== "demo" && kind !== "exam") || typeof markdown !== "string") return Response.json({ error: "kind and markdown are required." }, { status: 400 });
  const dir = path.join(/* turbopackIgnore: true */ process.cwd(), "logs");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const text = markdown.slice(0, 200_000);
  await fs.writeFile(path.join(dir, `selftest-${kind}-${stamp}.md`), text);
  await fs.writeFile(path.join(dir, `selftest-${kind}-latest.md`), text);
  // The exam also keeps its results as data, so several runs can be published together.
  if (json !== undefined) await fs.writeFile(path.join(dir, `selftest-${kind}-${stamp}.json`), JSON.stringify(json, null, 2).slice(0, 200_000));
  return Response.json({ saved: `logs/selftest-${kind}-latest.md` });
}
