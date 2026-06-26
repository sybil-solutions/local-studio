import type { Metadata } from "next";
import { AgentsPage } from "@/features/marketing/marketing-page";

export const metadata: Metadata = {
  title: "Local Studio Agents",
  description:
    "DLTL setup instructions for agents configuring Local Studio controllers, providers, runtimes, MCP tools, and Pi sessions.",
};

export default function AgentsRoute() {
  return <AgentsPage />;
}
