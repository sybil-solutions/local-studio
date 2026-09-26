module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { breaking: true, release: "major" },
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "build", release: "patch" },
          { type: "ci", release: "patch" },
          { type: "docs", release: "patch" },
          { type: "chore", release: "patch" },
          { type: "style", release: "patch" },
          { type: "revert", release: "patch" },
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
            { type: "revert", section: "Reverts" },
            { type: "docs", section: "Documentation" },
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
        verifyReleaseCmd:
          'printf "%s" "${nextRelease.version}" > .release-version && { [ -z "$RELEASE_VERSION" ] || [ "$RELEASE_VERSION" = "${nextRelease.version}" ]; }',
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [{ path: "release-staging/*" }],
        successComment: false,
        failComment: false,
      },
    ],
  ],
};
