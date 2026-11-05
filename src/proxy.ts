import { NextResponse, type NextRequest } from "next/server";
import { crossSiteProblem } from "@/lib/request-guard";

/** Every API write must come from Minder's own pages or from a non-browser client. */
export function proxy(request: NextRequest) {
  const h = request.headers;
  const problem = crossSiteProblem({
    method: request.method,
    host: h.get("x-forwarded-host") ?? h.get("host"),
    origin: h.get("origin"),
    secFetchSite: h.get("sec-fetch-site"),
    contentType: h.get("content-type"),
  });
  if (problem) return NextResponse.json({ error: problem }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
