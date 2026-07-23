/**
 * Monorepo, protected `main`: no npm publish, no direct commits to main.
 * Creates Git tag + GitHub Release only (release notes from commits).
 * @type {import("semantic-release").GlobalConfig}
 */
module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "micro", release: "patch" },
          { type: "release", release: "patch" },
          { type: "test", release: "patch" },
          { type: "build", release: "patch" },
          { type: "ci", release: "patch" },
          { type: "docs", release: "patch" },
          { type: "chore", release: "patch" },
          { type: "style", release: "patch" },
          { breaking: true, release: "major" },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: [
            { type: "feat", section: "Features" },
            { type: "fix", section: "Fixes" },
            { type: "perf", section: "Performance" },
            { type: "refactor", section: "Refactors" },
            { type: "micro", section: "Polish" },
            { type: "release", section: "Release" },
            { type: "docs", section: "Documentation" },
            { type: "test", section: "Tests" },
            { type: "build", section: "Build System" },
            { type: "ci", section: "CI" },
            { type: "chore", section: "Chores", hidden: true },
            { type: "style", section: "Styles", hidden: true },
          ],
        },
      },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          "node scripts/build-desktop-release.mjs --version ${nextRelease.version} --commit ${env.RELEASE_SHA}",
        publishCmd:
          "node scripts/assert-release-main.mjs --commit ${env.RELEASE_SHA}",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [{ path: "release-staging/*" }],
      },
    ],
  ],
};
