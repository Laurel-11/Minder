// Stops other websites from making a visitor's browser call Minder's API (cross-site request forgery).
// Browsers always say where a request comes from (Origin, Sec-Fetch-Site), so a request from another
// site is refused. Non-browser clients (an agent, curl) send neither header and are let through.
// Bodies must be JSON: a plain HTML form on another site cannot send that without asking first.

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FORM_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

export type GuardInput = {
  method: string;
  /** The host this request was sent to, as the browser saw it (x-forwarded-host or host). */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
};

/** Why a request must be refused, or null when it is fine. */
export function crossSiteProblem(r: GuardInput): string | null {
  if (!WRITE_METHODS.has(r.method.toUpperCase())) return null;
  if (r.secFetchSite === "cross-site") return "Requests from other websites are not accepted.";
  if (r.origin && r.origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(r.origin).host;
    } catch {
      return "The request's origin is not a valid address.";
    }
    if (!r.host || originHost.toLowerCase() !== r.host.toLowerCase()) return "Requests from other websites are not accepted.";
  } else if (r.origin === "null") {
    return "Requests from other websites are not accepted.";
  }
  const type = (r.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (FORM_TYPES.includes(type)) return "Send JSON (Content-Type: application/json).";
  return null;
}
