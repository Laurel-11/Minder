import { resetDemo } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

// The live demo is shared, so anyone can put it back to the sample story. Once a minute at most.
let lastReset = 0;

/** Public: go back to the sample story. Keeps Maya's saved PayPal; old data is backed up first. */
export async function POST() {
  const wait = lastReset + 60_000 - Date.now();
  if (wait > 0) return Response.json({ error: `The demo was just reset. Try again in ${Math.ceil(wait / 1000)} seconds.` }, { status: 429 });
  lastReset = Date.now();
  const r = await resetDemo("story");
  return Response.json({ to: r.to, cleared: r.cleared });
}
