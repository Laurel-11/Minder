#!/usr/bin/env node
// Check a Minder receipt book or evidence pack offline, with nothing but Node (18 or newer) and this file.
//
//   node scripts/verify-receipts.mjs minder-receipt-book.json
//   node scripts/verify-receipts.mjs minder-evidence-pur_1234abcd.json --key <key id from the site's Receipts page>
//
// It recomputes every receipt's fingerprint (SHA-256 of its canonical JSON), checks Minder's Ed25519 signature on it,
// and, for a whole book, that each receipt points at the one before. For an evidence pack it also recomputes the
// fingerprints of the evidence (the store's page text, the agent's reason, the AI's findings) and compares them with
// the decision receipt. It exits with 1 if anything does not check out.
import crypto from "node:crypto";
import fs from "node:fs";

const FORMAT = "minder-receipt-v1";
const GENESIS = "0".repeat(64);

function canonical(v) {
  if (v === null || v === undefined || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const fingerprint = (r) =>
  sha256(canonical({ format: FORMAT, n: r.n, at: r.at, kind: r.kind, purchaseId: r.purchaseId, caseId: r.caseId, says: r.says, facts: r.facts, prev: r.prev }));

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/verify-receipts.mjs <file.json> [--key <key id>]");
  process.exit(2);
}
const keyArg = rest.indexOf("--key");
const pinned = keyArg >= 0 ? (rest[keyArg + 1] ?? null) : null;
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const receipts = doc.receipts ?? [];
const keys = new Map((doc.keys ?? []).map((k) => [k.id, crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x }, format: "jwk" })]));
const keyId = (x) => crypto.createHash("sha256").update(Buffer.from(x, "base64url")).digest("hex").slice(0, 16);
const problems = [];
const say = (ok, text) => console.log(`${ok ? "OK  " : "FAIL"} ${text}`);

for (const k of doc.keys ?? []) {
  if (keyId(k.x) !== k.id) problems.push(`Key ${k.id} does not match its own id.`);
}
if (pinned && !keys.has(pinned)) problems.push(`The file was not signed with key ${pinned}.`);

let prev = GENESIS;
let expected = receipts[0]?.n ?? 1;
const whole = doc.format === "minder-receipt-book-v1";
for (const r of receipts) {
  if (fingerprint(r) !== r.hash) problems.push(`Receipt #${r.n} was changed after it was written.`);
  const key = keys.get(r.signer);
  if (!key || (pinned && r.signer !== pinned)) problems.push(`Receipt #${r.n} is signed by a key you did not expect (${r.signer}).`);
  else if (!crypto.verify(null, Buffer.from(r.hash, "hex"), key, Buffer.from(r.sig, "base64url"))) problems.push(`Receipt #${r.n} does not carry a valid signature.`);
  if (whole) {
    if (r.n !== expected) problems.push(`Receipt #${expected} is missing or out of order.`);
    if (r.prev !== prev) problems.push(`Receipt #${r.n} does not point at the receipt before it.`);
  }
  prev = r.hash;
  expected = r.n + 1;
}
if (whole && receipts.length && receipts[0].n !== 1) problems.push("The book does not start at receipt #1.");

if (doc.format === "minder-evidence-v1" && doc.purchase) {
  const p = doc.purchase;
  const decision = receipts.find((r) => r.kind === "decision");
  const recorded = decision?.facts?.evidence;
  if (!recorded) problems.push("The pack has no decision receipt with evidence fingerprints.");
  else {
    const now = {
      pageText: sha256(p.request?.pageExcerpt ?? ""),
      agentReason: sha256(p.request?.justification ?? ""),
      aiFindings: sha256(p.ai ? canonical({ instructionMatch: p.ai.instructionMatch, manipulationEvidence: p.ai.manipulationEvidence, summaryForOwner: p.ai.summaryForOwner }) : ""),
      reasons: sha256(canonical(p.reasons ?? [])),
    };
    const LABEL = { pageText: "store's page text", agentReason: "agent's reason", aiFindings: "AI review's findings", reasons: "list of reasons shown to the owner" };
    for (const [k, v] of Object.entries(recorded)) if (now[k] !== v) problems.push(`The ${LABEL[k] ?? k} in this pack is not what receipt #${decision.n} fingerprinted.`);
    say(!problems.some((x) => x.includes("fingerprinted")), `Evidence for ${p.id} matches receipt #${decision.n}`);
  }
  if (p.paypal?.receiptOnOrder) say(p.paypal.receiptOnOrder === decision?.hash, `PayPal order ${p.paypal.orderId} was given receipt #${decision?.n}'s fingerprint as its custom_id`);
}

say(problems.length === 0, `${receipts.length} receipt(s), signed by ${[...new Set(receipts.map((r) => r.signer))].join(", ") || "nobody"}${whole ? ", chained from #1" : ""}`);
for (const p of problems) say(false, p);
if (problems.length === 0) console.log("Everything checks out.");
process.exit(problems.length === 0 ? 0 : 1);
