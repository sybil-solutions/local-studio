/**
 * Monorepo, protected `main`: no npm publish, no direct commits to main.
 * semantic-release is the release version source of truth. The prepare step
 * applies the computed version to package metadata in the release workspace
 * before any desktop artifacts are built or attached.
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
        prepareCmd: "node scripts/apply-release-version.mjs ${nextRelease.version}",
      },
    ],
    "@semantic-release/github",
  ],
};
