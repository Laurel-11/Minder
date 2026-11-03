// Demo maintenance: reset to a known starting point, and record the sample story from the current data.
import fs from "node:fs/promises";
import path from "node:path";
import { readDb, updateDb } from "./db";
import { log } from "./log";
import { freshDb } from "./seed";

export { DEMO_POLICY, DEMO_RULES_TEXT } from "./seed";

const BACKUP_DIR = path.join(process.cwd(), "data", "backups");
const STORY_FILE = path.join(process.cwd(), "src", "lib", "demo-story.json");

/**
 * Back up the current data, then go back to a starting point. Keeps Maya's saved PayPal.
 * "start": nothing bought yet (for recording the video). "story": the sample story (what a fresh cloud copy shows).
 */
export async function resetDemo(to: "start" | "story" = "start"): Promise<{ backup: string; to: string; cleared: { purchases: number; cases: number } }> {
  return updateDb(async (db) => {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const backup = `db-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await fs.writeFile(path.join(BACKUP_DIR, backup), JSON.stringify(db, null, 2));
    const old = (await fs.readdir(BACKUP_DIR)).filter((f) => f.startsWith("db-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 20))) await fs.unlink(path.join(BACKUP_DIR, f));

    const cleared = { purchases: db.purchases.length, cases: db.cases.length };
    Object.assign(db, freshDb({ story: to === "story", vault: db.vault }));
    log("demo.reset", { backup, to, ...cleared });
    return { backup, to, cleared };
  });
}

/**
 * Development only: save the current purchases and cases as the sample story that ships with the code.
 * Leaves out orders stopped by a blocked store, so the story keeps "block this store" for visitors to try.
 */
export async function saveStory(): Promise<{ purchases: number; cases: number }> {
  const db = await readDb();
  const purchases = db.purchases.filter((p) => !p.rules.checks.some((c) => c.rule === "Blocked merchants" && c.outcome === "block"));
  const story = { recordedAt: new Date().toISOString(), demoClockDays: db.demoClockDays ?? 0, purchases, cases: db.cases };
  await fs.writeFile(STORY_FILE, JSON.stringify(story, null, 2) + "\n");
  log("demo.story_saved", { purchases: purchases.length, cases: db.cases.length });
  return { purchases: purchases.length, cases: db.cases.length };
}
