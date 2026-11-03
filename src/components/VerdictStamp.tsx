import type { PurchaseStatus } from "@/lib/types";

const LOOK: Record<PurchaseStatus, { label: string; tone: string }> = {
  paid: { label: "Approved", tone: "text-approve" },
  approved_by_owner: { label: "Approved by you", tone: "text-approve" },
  awaiting_owner: { label: "Waiting for you", tone: "text-hold" },
  declined_by_owner: { label: "Declined by you", tone: "text-muted" },
  blocked: { label: "Blocked", tone: "text-block" },
  payment_failed: { label: "Payment failed", tone: "text-block" },
};

export function VerdictStamp({ status, animate = false, size = "md" }: { status: PurchaseStatus; animate?: boolean; size?: "md" | "lg" }) {
  const look = LOOK[status];
  return (
    <span className={`stamp ${animate ? "stamp-in" : ""} ${look.tone} ${size === "lg" ? "text-2xl" : "text-base"}`}>{look.label}</span>
  );
}

export const statusLabel = (s: PurchaseStatus) => LOOK[s].label;
