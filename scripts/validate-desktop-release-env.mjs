import { appendFile } from "node:fs/promises";
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

export async function reportDesktopReleaseEnvironment({ env, outputPath }) {
  const missing = missingDesktopReleaseSecrets(env);
  if (outputPath) {
    await appendFile(outputPath, `configured=${missing.length === 0}\n`);
  }

  return missing;
}

async function main() {
  const missing = await reportDesktopReleaseEnvironment({
    env: process.env,
    outputPath: process.env.GITHUB_OUTPUT,
  });

  if (missing.length === 0) {
    console.log("Desktop release signing/notarization environment is configured.");
    return;
  }

  console.log(
    `::notice title=Desktop assets skipped::Missing signing secrets: ${missing.join(", ")}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
