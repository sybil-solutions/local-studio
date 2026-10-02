import { createFileRoute } from "@tanstack/react-router";
import { LocalPage } from "../components/local/LocalPage";

export const Route = createFileRoute("/local")({ component: LocalPage });
