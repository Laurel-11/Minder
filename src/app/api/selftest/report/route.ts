import fs from "node:fs/promises";
import path from "node:path";
import { adminAllowed, adminDenied } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Save a self-test report to logs/, so results can be read later (and quoted in the README). */
export async function POST(request: Request) {
  if (!adminAllowed(request)) return adminDenied();
  const { kind, markdown } = (await request.json().catch(() => ({}))) as { kind?: string; markdown?: string };
  if ((kind !== "demo" && kind !== "exam") || typeof markdown !== "string") return Response.json({ error: "kind and markdown are required." }, { status: 400 });
  const dir = path.join(process.cwd(), "logs");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const text = markdown.slice(0, 200_000);
  await fs.writeFile(path.join(dir, `selftest-${kind}-${stamp}.md`), text);
  await fs.writeFile(path.join(dir, `selftest-${kind}-latest.md`), text);
  return Response.json({ saved: `logs/selftest-${kind}-latest.md` });
}
