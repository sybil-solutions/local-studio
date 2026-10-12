import { ManagedRuntime } from "effect";
import {
  AppContextLive,
  type AppContextInitializationError,
  type AppContextService,
} from "../app-context";

export type ControllerRuntime = ManagedRuntime.ManagedRuntime<
  AppContextService,
  AppContextInitializationError
>;

export const createControllerRuntime = (): ControllerRuntime => ManagedRuntime.make(AppContextLive);
