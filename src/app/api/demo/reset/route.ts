import { adminAllowed, adminDenied } from "@/lib/admin";
import { resetDemo } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

/** Back up the data, then go back to the start ({ "to": "start" }) or to the sample story ({ "to": "story" }). */
export async function POST(request: Request) {
  if (!adminAllowed(request)) return adminDenied();
  const { to } = (await request.json().catch(() => ({}))) as { to?: string };
  return Response.json(await resetDemo(to === "story" ? "story" : "start"));
}
