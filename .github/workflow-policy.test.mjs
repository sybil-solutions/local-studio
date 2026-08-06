import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRepositoryWorkflows, validateWorkflowSource } from "./workflow-policy.mjs";

const immutableAction = "0123456789abcdef0123456789abcdef01234567";

const workflow = (steps) => `
name: Policy fixture
on: push
jobs:
  fixture:
    runs-on: ubuntu-latest
    steps:
${steps}
`;

test("accepts immutable actions, exact runtimes, local actions, and frozen installs", () => {
  const errors = validateWorkflowSource(
    workflow(`      - uses: actions/checkout@${immutableAction}
      - uses: ./.github/actions/local
      - uses: docker://alpine@sha256:${"a".repeat(64)}
      - uses: oven-sh/setup-bun@${immutableAction}
        with:
          bun-version: 1.3.14
      - uses: actions/setup-node@${immutableAction}
        with:
          node-version: 22.19.0
      - run: bun install --frozen-lockfile
      - run: npm ci
      - run: ./node_modules/.bin/semantic-release --dry-run`),
  );

  assert.deepEqual(errors, []);
});

const rejectedFixtures = [
  ["mutable action tag", "      - uses: actions/checkout@v7", "40-character commit SHA"],
  ["action branch", "      - uses: actions/checkout@main", "40-character commit SHA"],
  [
    "malformed action SHA",
    "      - uses: actions/checkout@0123456789abcdef",
    "40-character commit SHA",
  ],
  ["mutable container tag", "      - uses: docker://alpine:3.22", "sha256 digest"],
  [
    "floating Bun version",
    `      - uses: oven-sh/setup-bun@${immutableAction}\n        with:\n          bun-version: latest`,
    "exact x.y.z version",
  ],
  [
    "floating Node version",
    `      - uses: actions/setup-node@${immutableAction}\n        with:\n          node-version: 22`,
    "exact x.y.z version",
  ],
  ["npx acquisition", "      - run: npx --yes semantic-release", "dynamic package execution"],
  ["npm exec acquisition", "      - run: npm exec semantic-release", "dynamic package execution"],
  ["unfrozen npm install", "      - run: npm install", "must use npm ci"],
  ["unfrozen Bun install", "      - run: bun install", "--frozen-lockfile"],
  ["unfrozen pnpm install", "      - run: pnpm install", "--frozen-lockfile"],
  ["unfrozen Yarn install", "      - run: yarn install", "--immutable"],
];

for (const [name, step, expected] of rejectedFixtures) {
  test(`rejects ${name}`, () => {
    const errors = validateWorkflowSource(workflow(step));
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, new RegExp(expected));
  });
}

test("the repository satisfies the workflow policy", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(validateRepositoryWorkflows(root).errors, []);
});
