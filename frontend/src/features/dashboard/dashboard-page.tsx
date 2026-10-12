"use client";

import { DashboardLayout } from "./layout/dashboard-layout";
import { useDashboardData } from "./use-dashboard-data";

export default function DashboardPage() {
  const data = useDashboardData();
  return <DashboardLayout {...data} />;
}
