import { fileURLToPath } from "node:url";

const REQUIRED_SECRETS = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

export function missingDesktopReleaseSecrets(env) {
  return REQUIRED_SECRETS.filter((name) => !String(env[name] ?? "").trim());
}

function main() {
  const missing = missingDesktopReleaseSecrets(process.env);
  if (missing.length === 0) {
    console.log("Desktop release signing/notarization environment is configured.");
    return;
  }

  console.error(
    [
      "Desktop release signing/notarization is not configured.",
      `Missing required environment variables: ${missing.join(", ")}`,
      "Configure these values as GitHub Actions secrets before publishing stable macOS assets.",
    ].join("\n"),
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
