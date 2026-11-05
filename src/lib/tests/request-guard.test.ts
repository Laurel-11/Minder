import { describe, expect, it } from "vitest";
import { crossSiteProblem, type GuardInput } from "../request-guard";

const req = (over: Partial<GuardInput>): GuardInput => ({ method: "POST", host: "minder.example", origin: null, secFetchSite: null, contentType: "application/json", ...over });

describe("cross-site request guard", () => {
  it("lets reads through", () => {
    expect(crossSiteProblem(req({ method: "GET", origin: "https://evil.example" }))).toBeNull();
  });
  it("lets Minder's own pages write", () => {
    expect(crossSiteProblem(req({ origin: "https://minder.example", secFetchSite: "same-origin" }))).toBeNull();
  });
  it("lets non-browser clients (an agent, curl) write JSON", () => {
    expect(crossSiteProblem(req({}))).toBeNull();
  });
  it("refuses another website", () => {
    expect(crossSiteProblem(req({ origin: "https://evil.example" }))).not.toBeNull();
    expect(crossSiteProblem(req({ secFetchSite: "cross-site" }))).not.toBeNull();
    expect(crossSiteProblem(req({ origin: "null" }))).not.toBeNull();
  });
  it("refuses form posts, which a page on another site could send without asking", () => {
    expect(crossSiteProblem(req({ contentType: "application/x-www-form-urlencoded" }))).not.toBeNull();
    expect(crossSiteProblem(req({ contentType: "text/plain;charset=UTF-8" }))).not.toBeNull();
  });
});
