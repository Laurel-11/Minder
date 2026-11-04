// Tiny JSON-file store (data/minder-db.json). Good enough for a single-user demo.
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { freshDb } from "./seed";
import type { Db, VaultInfo } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "minder-db.json");
// Written by the feasibility scripts in /scripts; lets us reuse Maya's saved PayPal approval.
const LEGACY_STATE = path.join(DATA_DIR, "sandbox-state.json");

function emptyDb(): Db {
  return { version: 1, owner: { name: "Maya" }, purchases: [], cases: [], pendingSetupTokens: [] };
}

const envVault = (): VaultInfo | undefined =>
  env.paypalVaultId ? { vaultId: env.paypalVaultId, customerId: env.paypalVaultCustomerId || undefined, savedAt: new Date().toISOString() } : undefined;

async function load(): Promise<Db> {
  try {
    const db = { ...emptyDb(), ...(JSON.parse(await fs.readFile(DB_FILE, "utf8")) as Db) };
    db.vault ??= envVault();
    return db;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  // First start, or a fresh cloud instance (Render's free disk is wiped on every restart):
  // Maya's rules, the sample story, and her saved PayPal from the environment (or the setup scripts).
  let vault = envVault();
  if (!vault) {
    try {
      const legacy = JSON.parse(await fs.readFile(LEGACY_STATE, "utf8"));
      if (legacy.vaultId) vault = { vaultId: legacy.vaultId, customerId: legacy.customerId, savedAt: legacy.vaultSavedAt ?? new Date().toISOString() };
    } catch {
      // no legacy state: fine
    }
  }
  const db = freshDb({ story: true, vault });
  await persist(db);
  return db;
}

async function persist(db: Db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

// Serialize all access so concurrent requests never interleave read-modify-write.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

export function readDb(): Promise<Db> {
  return enqueue(load);
}

export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const db = await load();
    const result = await fn(db);
    await persist(db);
    return result;
  });
}
