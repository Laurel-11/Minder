import fs from "node:fs";
import path from "node:path";
import { secretValues } from "./env";

const LOG_FILE = path.join(/* turbopackIgnore: true */ process.cwd(), "logs", "app.log");

export function redact(text: string): string {
  let out = text;
  for (const s of secretValues()) out = out.split(s).join("***");
  return out.replace(/A21AA[\w-]{20,}/g, "A21AA***");
}

/** Append one line to logs/app.log (and the console). Never throws. */
export function log(event: string, data?: Record<string, unknown>) {
  const line = redact(`${new Date().toISOString()} ${event}${data ? " " + JSON.stringify(data) : ""}`);
  console.log(`[minder] ${line}`);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // logging must never break a request
  }
}
