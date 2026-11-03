// Development only: save the current data as the sample story that ships with the code (src/lib/demo-story.json).
import { saveStory } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  return Response.json(await saveStory());
}
