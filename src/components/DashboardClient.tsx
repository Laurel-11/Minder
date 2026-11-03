"use client";

import dynamic from "next/dynamic";
import type { ItemRow, PurchaseRow } from "@/lib/dashboard-data";

// AG Studio only runs in the browser.
const SpendDashboard = dynamic(() => import("./SpendDashboard"), {
  ssr: false,
  loading: () => <p className="p-6 text-muted">Loading the dashboard…</p>,
});

export function DashboardClient(props: { purchases: PurchaseRow[]; items: ItemRow[]; initialState?: unknown }) {
  return <SpendDashboard {...props} />;
}
