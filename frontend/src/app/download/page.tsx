import type { Metadata } from "next";
import { MarketingLandingPage } from "@/features/marketing/marketing-page";

export const metadata: Metadata = {
  title: "Download Local Studio",
  description:
    "Download Local Studio and connect local or remote controllers for self-hosted inference.",
};

export default function DownloadPage() {
  return <MarketingLandingPage />;
}
