"use client";

import { DashboardLayout } from "../layout/dashboard-layout";
import { DashboardLoading } from "../layout/dashboard-loading";
import { useDashboardData } from "../use-dashboard-data";

export default function DashboardPage() {
  const data = useDashboardData();
  if (data.loading) return <DashboardLoading />;
  return <DashboardLayout {...data} />;
}
