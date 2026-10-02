import { createFileRoute } from "@tanstack/react-router";

import { LocalSettingsPanel } from "../components/local/LocalPage";

export const Route = createFileRoute("/settings/local")({ component: LocalSettingsPanel });
