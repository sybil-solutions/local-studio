"use client";

import { SetupView } from "@/ui/setup/setup-view";
import { useSetup } from "./hooks/use-setup";

export default function SetupPage() {
  const setup = useSetup();
  return <SetupView {...setup} />;
}
