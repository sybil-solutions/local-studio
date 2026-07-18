import { ManagedRuntime } from "effect";
import { AppContextLive, type AppContextService } from "../app-context";

export type ControllerRuntime = ManagedRuntime.ManagedRuntime<AppContextService, never>;

export const createControllerRuntime = (): ControllerRuntime => ManagedRuntime.make(AppContextLive);
