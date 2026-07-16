import { Suspense } from "react";
import ConfigurePage from "@/features/configure/configure-page";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center">Loading…</div>}>
      <ConfigurePage />
    </Suspense>
  );
}
