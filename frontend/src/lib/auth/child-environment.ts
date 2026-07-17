import { frontendSafeEnvironment } from "../../../../shared/agent/frontend-environment.mjs";

export function environmentWithoutFrontendCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return frontendSafeEnvironment(environment);
}
