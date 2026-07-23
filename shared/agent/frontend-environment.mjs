export const isReservedFrontendEnvironmentKey = (name) =>
  name.startsWith("LOCAL_STUDIO_FRONTEND_") || name === "LOCAL_STUDIO_DESKTOP";

export const scrubReservedFrontendEnvironment = (environment) => {
  for (const name of Object.keys(environment)) {
    if (isReservedFrontendEnvironmentKey(name)) delete environment[name];
  }
  return environment;
};

export const frontendSafeEnvironment = (environment) =>
  scrubReservedFrontendEnvironment({ ...environment });
