// Guard for maintenance endpoints (demo reset, self-test). Open when running locally;
// once deployed they need the ADMIN_TOKEN from the environment, sent as the x-admin-token header.
import crypto from "node:crypto";
import { env } from "./env";

export function adminAllowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const expected = env.adminToken;
  const given = request.headers.get("x-admin-token") ?? "";
  if (expected.length < 12 || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const adminDenied = () => Response.json({ error: "This needs the admin token." }, { status: 403 });
