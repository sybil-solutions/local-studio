const value = (environment, name) => {
  const candidate = environment[name];
  return typeof candidate === "string" ? candidate.trim() : "";
};

const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]"]);

export const resolveAccessPostureFromEnvironment = (environment) => {
  if (environment.NODE_ENV !== "production") {
    return { kind: "allow", reason: "development" };
  }
  if (value(environment, "LOCAL_STUDIO_DESKTOP") === "1") {
    if (loopbackHosts.has(value(environment, "HOSTNAME").toLowerCase())) {
      return { kind: "allow", reason: "desktop" };
    }
    return {
      kind: "configuration-error",
      message: "Desktop mode requires HOSTNAME to be an explicit loopback address.",
    };
  }
  const token = value(environment, "LOCAL_STUDIO_FRONTEND_TOKEN");
  if (token) return { kind: "require-token", token };
  if (value(environment, "LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED") === "true") {
    return { kind: "allow", reason: "explicit-unauthenticated" };
  }
  return {
    kind: "configuration-error",
    message:
      "Production frontend access requires LOCAL_STUDIO_FRONTEND_TOKEN or LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED=true.",
  };
};
