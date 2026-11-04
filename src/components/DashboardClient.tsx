"use client";

import dynamic from "next/dynamic";
import type { DashboardRows } from "@/lib/dashboard-data";

// AG Studio only runs in the browser.
const SpendDashboard = dynamic(() => import("./SpendDashboard"), {
  ssr: false,
  loading: () => <p className="p-6 text-muted">Loading the dashboard…</p>,
});

export function DashboardClient(props: { rows: DashboardRows; initialState?: unknown }) {
  return <SpendDashboard {...props} />;
}
