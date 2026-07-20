import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDocument } from "yaml";
import { validateWorkflowDirectory, validateWorkflowSource } from "./validate-workflow-pins.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const workflow = (steps) => `jobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n${steps}`;

const validCases = [
  ["full action SHA", `      - uses: actions/checkout@${SHA}\n`],
  ["local workflow", "      - uses: ./.github/workflows/release.yml\n"],
  [
    "exact runtime actions",
    `      - uses: oven-sh/setup-bun@${SHA}
        with:
          bun-version: 1.3.6
      - uses: actions/setup-node@${SHA}
        with:
          node-version: 22.19.0
`,
  ],
  [
    "frozen package installs",
    `      - run: npm ci
      - run: npm --silent ci
      - run: bun install --frozen-lockfile
      - run: bun i --frozen-lockfile
      - run: bun install --frozen-lockfile --ignore-scripts
      - run: pnpm install --frozen-lockfile
      - run: pnpm i --frozen-lockfile
      - run: yarn install --immutable
      - run: yarn install --frozen-lockfile
      - run: yarn --immutable
`,
  ],
  [
    "continued frozen install",
    `      - run: |
          bun install \\
            --frozen-lockfile
`,
  ],
  ["Docker action digest", `      - uses: docker://alpine@sha256:${"a".repeat(64)}\n`],
];

for (const [name, steps] of validCases) {
  test(`accepts ${name}`, () => {
    assert.deepEqual(validateWorkflowSource(workflow(steps), `${name}.yml`), []);
  });
}

const invalidCases = [
  ["mutable major tag", "      - uses: actions/checkout@v4\n", "40-character"],
  ["branch reference", "      - uses: owner/action@main\n", "40-character"],
  ["malformed SHA", "      - uses: owner/action@0123\n", "40-character"],
  [
    "latest scalar",
    "      - run: echo ready\n        env:\n          runtime: latest\n",
    "must not use latest",
  ],
  [
    "latest Bun runtime",
    `      - uses: oven-sh/setup-bun@${SHA}
        with:
          bun-version: latest
`,
    "must not use latest",
  ],
  ["dynamic npx", "      - run: npx -y semantic-release\n", "dynamically"],
  [
    "quoted dynamic npx",
    `      - run: |
          'npx' -y semantic-release
`,
    "dynamically",
  ],
  [
    "continued dynamic npx",
    `      - run: |
          npx \\
            -y semantic-release
`,
    "dynamically",
  ],
  ["dynamic npm exec", "      - run: npm exec semantic-release\n", "dynamically"],
  ["dynamic npm x", "      - run: npm x semantic-release\n", "dynamically"],
  ["npm options before install", "      - run: npm --silent install\n", "npm ci"],
  [
    "quoted npm install",
    `      - run: |
          "npm" install
`,
    "npm ci",
  ],
  [
    "continued npm options before install",
    `      - run: |
          npm \\
            --silent \\
            install
`,
    "npm ci",
  ],
  ["npm options before exec", "      - run: npm --yes exec semantic-release\n", "dynamically"],
  [
    "continued npm options before exec",
    `      - run: |
          npm \\
            --yes \\
            exec semantic-release
`,
    "dynamically",
  ],
  ["unfrozen Bun install", "      - run: bun install\n", "freeze Bun"],
  [
    "quoted Bun path install",
    `      - run: |
          "/usr/local/bin/bun" install
`,
    "paths are not allowed",
  ],
  ["unfrozen Bun alias", "      - run: bun i\n", "freeze Bun"],
  ["dynamic Bun x", "      - run: bun x semantic-release\n", "dynamically"],
  ["dynamic bunx", "      - run: bunx semantic-release\n", "dynamically"],
  [
    "continued dynamic Bun x",
    `      - run: |
          bun \\
            x semantic-release
`,
    "dynamically",
  ],
  ["unfrozen pnpm install", "      - run: pnpm install\n", "freeze pnpm"],
  ["unfrozen pnpm alias", "      - run: pnpm i\n", "freeze pnpm"],
  ["dynamic pnpm dlx", "      - run: pnpm dlx semantic-release\n", "dynamically"],
  ["dynamic pnpx", "      - run: pnpx semantic-release\n", "dynamically"],
  [
    "continued dynamic pnpm dlx",
    `      - run: |
          pnpm \\
            dlx semantic-release
`,
    "dynamically",
  ],
  ["unfrozen Yarn install", "      - run: yarn install\n", "freeze Yarn"],
  ["bare Yarn install", "      - run: yarn\n", "freeze Yarn"],
  ["option-only Yarn install", "      - run: yarn --silent\n", "freeze Yarn"],
  ["dynamic Yarn dlx", "      - run: yarn dlx semantic-release\n", "dynamically"],
  [
    "continued dynamic Yarn dlx",
    `      - run: |
          yarn \\
            dlx semantic-release
`,
    "dynamically",
  ],
  ["npm install", "      - run: npm install\n", "npm ci"],
  ["non-string action", "      - uses: 42\n", "must be a string"],
  ["mutable Docker action", "      - uses: docker://alpine:3.22\n", "sha256 digest"],
  [
    "setup-node without version",
    `      - uses: actions/setup-node@${SHA}
`,
    "exact Node.js",
  ],
  [
    "setup-node version file",
    `      - uses: actions/setup-node@${SHA}
        with:
          node-version: 22.19.0
          node-version-file: .node-version
`,
    "version files",
  ],
  [
    "setup-node floating version",
    `      - uses: actions/setup-node@${SHA}
        with:
          node-version: 22
`,
    "exact Node.js",
  ],
  [
    "setup-bun without version",
    `      - uses: oven-sh/setup-bun@${SHA}
`,
    "Bun 1.3.6",
  ],
  [
    "setup-bun version file",
    `      - uses: oven-sh/setup-bun@${SHA}
        with:
          bun-version: 1.3.6
          bun-version-file: .bun-version
`,
    "version files",
  ],
  [
    "setup-bun download URL",
    `      - uses: oven-sh/setup-bun@${SHA}
        with:
          bun-version: 1.3.6
          bun-download-url: https://example.com/bun.zip
`,
    "download URLs",
  ],
];

for (const [name, steps, expected] of invalidCases) {
  test(`rejects ${name}`, () => {
    const errors = validateWorkflowSource(workflow(steps), `${name}.yml`);
    assert.match(errors.join("\n"), new RegExp(expected));
  });
}

test("rejects malformed workflow YAML", () => {
  assert.match(validateWorkflowSource("jobs: [", "broken.yml").join("\n"), /broken\.yml/);
});

const runnerArchitectureEnvironment = "LOCAL_STUDIO_DESKTOP_SMOKE_ARCH: ${{ runner.arch }}";

const invalidRunnerArchitecturePlacements = [
  [
    "workflow environment",
    `env:
  ${runnerArchitectureEnvironment}
jobs:
  test:
    runs-on: macos-15
    steps:
      - run: npm ci
`,
  ],
  [
    "job environment",
    `jobs:
  test:
    runs-on: macos-15
    env:
      ${runnerArchitectureEnvironment}
    steps:
      - run: npm ci
`,
  ],
  [
    "workflow defaults",
    `defaults:
  run:
    env:
      ${runnerArchitectureEnvironment}
jobs:
  test:
    runs-on: macos-15
    steps:
      - run: npm ci
`,
  ],
  [
    "job container environment",
    `jobs:
  test:
    runs-on: macos-15
    container:
      image: node@sha256:${"a".repeat(64)}
      env:
        ${runnerArchitectureEnvironment}
    steps:
      - run: npm ci
`,
  ],
  [
    "nested step object environment",
    `jobs:
  test:
    runs-on: macos-15
    steps:
      - run: npm ci
        with:
          env:
            ${runnerArchitectureEnvironment}
`,
  ],
  [
    "nested step list environment",
    `jobs:
  test:
    runs-on: macos-15
    steps:
      - run: npm ci
        nested:
          - env:
              ${runnerArchitectureEnvironment}
`,
  ],
  [
    "object key impersonating a step index",
    `jobs:
  test:
    runs-on: macos-15
    steps:
      "0":
        env:
          ${runnerArchitectureEnvironment}
`,
  ],
];

for (const [name, source] of invalidRunnerArchitecturePlacements) {
  test(`rejects runner architecture in ${name}`, () => {
    assert.match(
      validateWorkflowSource(source, "runner-context.yml").join("\n"),
      /LOCAL_STUDIO_DESKTOP_SMOKE_ARCH.*not allowlisted/,
    );
  });
}

test("accepts runner architecture in step environments", () => {
  assert.deepEqual(
    validateWorkflowSource(`jobs:
  test:
    runs-on: macos-15
    steps:
      - run: npm ci
        env:
          ${runnerArchitectureEnvironment}
      - run: npm ci
        env:
          ${runnerArchitectureEnvironment}
`, "runner-context.yml"),
    [],
  );
});

test("validates every workflow file in a directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "workflow-pins-"));
  try {
    writeFileSync(join(directory, "valid.yml"), workflow(validCases[0][1]));
    writeFileSync(join(directory, "invalid.yaml"), workflow(invalidCases[0][1]));
    writeFileSync(join(directory, "ignored.txt"), "uses: owner/action@main\n");
    const errors = validateWorkflowDirectory(directory);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^invalid\.yaml:/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("rejects a workflow directory without YAML files", () => {
  const directory = mkdtempSync(join(tmpdir(), "workflow-pins-"));
  try {
    assert.deepEqual(validateWorkflowDirectory(directory), [
      `${directory}: no workflow files found`,
    ]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

const withRepository = (files, operation) => {
  const repository = mkdtempSync(join(tmpdir(), "workflow-pins-repository-"));
  try {
    for (const [file, source] of Object.entries(files)) {
      const path = join(repository, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, source);
    }
    return operation(repository);
  } finally {
    rmSync(repository, { recursive: true });
  }
};

test("rejects mutable actions reachable through local composites", () => {
  withRepository(
    {
      ".github/workflows/ci.yml": workflow("      - uses: ./.github/actions/nested\n"),
      ".github/actions/nested/action.yml":
        "name: nested\nruns:\n  using: composite\n  steps:\n    - uses: owner/action@main\n",
    },
    (repository) => {
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows"));
      assert.match(errors.join("\n"), /40-character/);
    },
  );
});

test("rejects missing, escaping, and cyclic local uses", () => {
  withRepository(
    {
      ".github/workflows/ci.yml": workflow(`      - uses: ./.github/actions/first
      - uses: ./.github/actions/missing
      - uses: ./../outside
`),
      ".github/actions/first/action.yml":
        "name: first\nruns:\n  using: composite\n  steps:\n    - uses: ./.github/actions/second\n",
      ".github/actions/second/action.yml":
        "name: second\nruns:\n  using: composite\n  steps:\n    - uses: ./.github/actions/first\n",
    },
    (repository) => {
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows")).join(
        "\n",
      );
      assert.match(errors, /cycle/);
      assert.match(errors, /does not exist/);
      assert.match(errors, /outside the repository/);
    },
  );
});

test("rejects mutable job and service images", () => {
  const errors = validateWorkflowSource(`jobs:
  test:
    runs-on: ubuntu-24.04
    container: node:22
    services:
      database:
        image: postgres:16
`, "images.yml");
  assert.equal(errors.filter((error) => /sha256/.test(error)).length, 2);
});

test("rejects expressions, eval, wrappers, and ineffective lock flags", () => {
  const cases = [
    "echo ${{ github.token }}",
    "eval npm ci",
    "sh -c npm ci",
    "env npm ci",
    "bun install -- --frozen-lockfile",
    "bun install --frozen-lockfile --no-frozen-lockfile",
    "bun install --frozen-lockfile -- --ignore-scripts",
    "npm isntall",
  ];
  for (const command of cases) {
    assert.notEqual(validateWorkflowSource(workflow(`      - run: ${command}\n`)).length, 0);
  }
});

test("rejects shell and environment command-policy bypasses", () => {
  const cases = [
    "        shell: bash -c 'node scripts/evil.mjs; bash {0}'\n        run: npm ci",
    "        env:\n          PATH: ./scripts\n        run: npm ci",
    "        env:\n          NODE_OPTIONS: --require ./scripts/evil.cjs\n        run: node scripts/safe.mjs",
    "        env:\n          BASH_ENV: ./scripts/evil.sh\n        run: npm ci",
    "        env:\n          npm_config_script_shell: ./scripts/evil.sh\n        run: npm ci",
    "        env:\n          GITHUB_TOKEN: attacker-controlled\n        run: semantic-release",
    "        env:\n          TESTED_SHA: attacker-controlled\n        run: node scripts/release-revision.mjs",
  ];
  for (const step of cases) {
    assert.notEqual(
      validateWorkflowSource(`jobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n      - name: bypass\n${step}\n`).length,
      0,
    );
  }
  assert.deepEqual(
    validateWorkflowSource(`jobs:
  release:
    runs-on: ubuntu-24.04
    steps:
      - env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: semantic-release
`),
    [],
  );
  assert.deepEqual(
    validateWorkflowSource(`jobs:
  release:
    runs-on: ubuntu-24.04
    steps:
      - env:
          TESTED_SHA: \${{ github.sha }}
        run: node scripts/release-revision.mjs
`),
    [],
  );
});

test("rejects unsafe transitive package scripts", () => {
  withRepository(
    {
      ".github/workflows/custom.yml": workflow("      - run: npm run unsafe\n"),
      "package.json": JSON.stringify({ scripts: { unsafe: "npm install" } }),
    },
    (repository) => {
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows"));
      assert.match(errors.join("\n"), /npm ci/);
    },
  );
});

test("requires executable jobs to depend on the workflow pin gate", () => {
  withRepository(
    {
      ".github/workflows/ci.yml": `jobs:
  gates:
    runs-on: ubuntu-24.04
    steps:
      - run: npm run check:workflow-pins
  consumer:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@${SHA}
`,
      "package.json": JSON.stringify({
        scripts: { "check:workflow-pins": "node scripts/gate.mjs" },
      }),
      "scripts/gate.mjs": "process.stdout.write(\"ok\\n\");\n",
    },
    (repository) => {
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows"));
      assert.match(errors.join("\n"), /must depend on jobs.gates/);
    },
  );
});

test("validates the complete repository workflow and package-script graph", () => {
  assert.deepEqual(
    validateWorkflowDirectory(join(process.cwd(), ".github", "workflows")),
    [],
  );
});

test("rejects local refs and invalid local action manifests", () => {
  withRepository(
    {
      ".github/workflows/custom.yml": workflow(`      - uses: ./.github/actions/valid@main
      - uses: ./.github/actions/empty
      - uses: ./.github/actions/ambiguous
      - uses: ./.github/actions/file.txt
`),
      ".github/actions/valid/action.yml": "name: valid\nruns:\n  using: composite\n  steps: []\n",
      ".github/actions/empty/placeholder": "empty\n",
      ".github/actions/ambiguous/action.yml": "name: ambiguous\nruns:\n  using: composite\n  steps: []\n",
      ".github/actions/ambiguous/action.yaml": "name: ambiguous\nruns:\n  using: composite\n  steps: []\n",
      ".github/actions/file.txt": "not yaml\n",
    },
    (repository) => {
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows")).join(
        "\n",
      );
      assert.match(errors, /must not include a ref/);
      assert.equal((errors.match(/exactly one action/g) ?? []).length, 2);
      assert.match(errors, /must be YAML/);
    },
  );
});

test("rejects local action and package-prefix symlinks that escape the repository", () => {
  const repository = mkdtempSync(join(tmpdir(), "workflow-pins-symlink-repository-"));
  const outside = mkdtempSync(join(tmpdir(), "workflow-pins-symlink-outside-"));
  try {
    mkdirSync(join(repository, ".github", "workflows"), { recursive: true });
    mkdirSync(join(repository, ".github", "actions"), { recursive: true });
    writeFileSync(join(outside, "action.yml"), "name: outside\nruns:\n  using: composite\n  steps: []\n");
    writeFileSync(join(outside, "package.json"), JSON.stringify({ scripts: { safe: "node safe.mjs" } }));
    writeFileSync(join(outside, "safe.mjs"), "process.stdout.write(\"safe\\n\");\n");
    symlinkSync(outside, join(repository, ".github", "actions", "outside"), "dir");
    mkdirSync(join(repository, ".github", "actions", "manifest"));
    symlinkSync(
      join(outside, "action.yml"),
      join(repository, ".github", "actions", "manifest", "action.yml"),
      "file",
    );
    writeFileSync(
      join(repository, ".github", "workflows", "custom.yml"),
      workflow(`      - uses: ./.github/actions/outside
      - uses: ./.github/actions/manifest
      - run: npm --prefix=.github/actions/outside run safe
`),
    );
    const errors = validateWorkflowDirectory(join(repository, ".github", "workflows"));
    assert.equal(errors.filter((error) => /outside the repository/.test(error)).length, 3);
  } finally {
    rmSync(repository, { recursive: true });
    rmSync(outside, { recursive: true });
  }
});

test("accepts immutable object-form job and service images", () => {
  const digest = "a".repeat(64);
  assert.deepEqual(
    validateWorkflowSource(`jobs:
  test:
    runs-on: ubuntu-24.04
    container:
      image: node@sha256:${digest}
    services:
      database:
        image: postgres@sha256:${digest}
`, "images.yml"),
    [],
  );
});

test("rejects shell parsing and command allowlist bypasses", () => {
  const cases = [
    '"npm$COMMAND" ci',
    "npm ci ; npm ci",
    "npm ci & npm ci",
    "npm ci | npm ci",
    "npm ci \\",
    '"npm ci',
    "unknown-tool",
    "git status",
    "node -e process.exit(0)",
    "node --require scripts/gate.mjs",
    "bun build other.ts",
    "bun unknown",
    "bun scripts/gate.mjs unexpected",
  ];
  for (const command of cases) {
    assert.notEqual(validateWorkflowSource(workflow(`      - run: ${command}\n`)).length, 0);
  }
  assert.deepEqual(validateWorkflowSource(workflow("      - run: np\\m ci\n")), []);
  assert.deepEqual(
    validateWorkflowSource(workflow('      - run: |\n          "np\\m" ci\n')),
    [],
  );
  assert.deepEqual(
    validateWorkflowSource(
      workflow(
        "      - run: bun build src/server.ts --target=node --external fsevents --outfile=dist/standalone.mjs\n",
      ),
    ),
    [],
  );
});

test("validates package prefixes, scripts, and working directories conservatively", () => {
  withRepository(
    {
      ".github/workflows/custom.yml": workflow(`      - run: npm --prefix=tools run safe
      - run: npm --prefix missing run safe
      - run: npm --prefix=../outside run safe
      - run: npm --unknown ci
      - run: npm run missing
      - run: npm run safe -- extra
      - run: npm update
      - run: npm run cycle
      - run: bun run
      - run: pnpm run missing
      - run: yarn test
      - run: node scripts/missing.mjs
`),
      "package.json": JSON.stringify({
        scripts: {
          cycle: "npm run cycle",
          safe: "node scripts/safe.mjs",
        },
      }),
      "scripts/safe.mjs": "process.stdout.write(\"safe\\n\");\n",
      "tools/package.json": JSON.stringify({ scripts: { safe: "node safe.mjs" } }),
      "tools/safe.mjs": "process.stdout.write(\"safe\\n\");\n",
      "without-package/placeholder": "empty\n",
      "invalid-package/package.json": "{",
    },
    (repository) => {
      const context = { repositoryRoot: repository, workingDirectory: repository };
      assert.deepEqual(
        validateWorkflowSource(workflow("      - run: npm --prefix=tools run safe\n"), "safe.yml", context),
        [],
      );
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows")).join(
        "\n",
      );
      assert.match(errors, /working directory does not exist/);
      assert.match(errors, /outside the repository/);
      assert.match(errors, /global option/);
      assert.match(errors, /script missing does not exist/);
      assert.match(errors, /invocation is not allowlisted/);
      assert.match(errors, /npm command update/);
      assert.match(errors, /script cycle/);
      assert.match(errors, /script does not exist/);
      assert.match(
        validateWorkflowSource(
          workflow("      - run: npm run safe\n"),
          "missing-package.yml",
          { ...context, workingDirectory: join(repository, "without-package") },
        ).join("\n"),
        /package.json does not exist/,
      );
      assert.match(
        validateWorkflowSource(
          workflow("      - run: npm run safe\n"),
          "invalid-package.yml",
          { ...context, workingDirectory: join(repository, "invalid-package") },
        ).join("\n"),
        /package.json is invalid/,
      );
    },
  );
});

test("validates package lifecycle scripts reached by installs and run hooks", () => {
  withRepository(
    {
      ".github/workflows/custom.yml": workflow(`      - run: npm run safe
      - run: npm ci
`),
      "package.json": JSON.stringify({
        scripts: {
          safe: "node scripts/safe.mjs",
          presafe: "npm install",
          postinstall: "npx dynamic-package",
        },
      }),
      "scripts/safe.mjs": "process.stdout.write(\"safe\\n\");\n",
    },
    (repository) => {
      const errors = validateWorkflowDirectory(join(repository, ".github", "workflows")).join(
        "\n",
      );
      assert.match(errors, /must use npm ci/);
      assert.match(errors, /must not download packages dynamically/);
      assert.deepEqual(
        validateWorkflowSource(
          workflow("      - run: npm ci --ignore-scripts\n"),
          "ignored.yml",
          { repositoryRoot: repository, workingDirectory: repository },
        ),
        [],
      );
    },
  );
});

test("rejects invalid workflow working-directory boundaries", () => {
  withRepository(
    {
      ".github/workflows/custom.yml": `defaults:
  run:
    working-directory: missing
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - run: npm ci
`,
      "package.json": "{}",
    },
    (repository) => {
      const context = { repositoryRoot: repository, workingDirectory: repository };
      assert.match(
        validateWorkflowSource(
          "jobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n      - working-directory: $DIR\n        run: npm ci\n",
          "expression.yml",
          context,
        ).join("\n"),
        /working-directory.*not allowlisted/,
      );
      assert.match(
        validateWorkflowDirectory(join(repository, ".github", "workflows")).join("\n"),
        /working directory does not exist/,
      );
    },
  );
});

test("rejects malformed pin-gate graphs", () => {
  assert.match(validateWorkflowSource("name: CI\n", "ci.yml").join("\n"), /jobs must be/);
  assert.match(
    validateWorkflowSource("jobs:\n  gates:\n    runs-on: ubuntu-24.04\n", "ci.yml").join("\n"),
    /must be a pin gate/,
  );
  assert.match(
    validateWorkflowSource(
      "jobs:\n  gates:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm ci\n",
      "ci.yml",
    ).join("\n"),
    /must run npm run check:workflow-pins/,
  );
  for (const bypass of [
    "  gates:\n    continue-on-error: true\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run check:workflow-pins",
    "  gates:\n    if: always()\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run check:workflow-pins",
    "  gates:\n    runs-on: ubuntu-24.04\n    steps:\n      - continue-on-error: true\n        run: npm run check:workflow-pins",
    "  gates:\n    runs-on: ubuntu-24.04\n    steps:\n      - if: false\n        run: npm run check:workflow-pins",
    "  gates:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run check:workflow-pins\n  consumer:\n    if: always()\n    needs: gates\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm ci",
  ]) {
    assert.notEqual(validateWorkflowSource(`jobs:\n${bypass}\n`, "ci.yml").length, 0);
  }
});

test("keeps executable workflow graphs and sensitive permissions least-privileged", () => {
  const parsed = (name) =>
    parseDocument(readFileSync(join(process.cwd(), ".github", "workflows", name), "utf8")).toJS();
  const ci = parsed("ci.yml");
  assert.equal(ci.jobs.controller.needs, "gates");
  assert.equal(ci.jobs.frontend.needs, "gates");
  assert.deepEqual(ci.jobs["desktop-smoke"].needs, ["controller", "frontend"]);
  assert.equal(ci.jobs["desktop-smoke"]["runs-on"], "macos-15");
  assert.equal(ci.jobs["desktop-smoke"].env, undefined);
  assert.deepEqual(
    ci.jobs["desktop-smoke"].steps.find(
      (step) => step.name === "Install controller contract dependencies",
    ),
    {
      name: "Install controller contract dependencies",
      "working-directory": "./controller",
      run: "bun install --frozen-lockfile",
    },
  );
  for (const name of ["Build unpacked desktop app", "Smoke-test packaged desktop app"]) {
    assert.deepEqual(ci.jobs["desktop-smoke"].steps.find((step) => step.name === name).env, {
      LOCAL_STUDIO_DESKTOP_SMOKE_ARCH: "${{ runner.arch }}",
    });
  }
  assert.equal(
    ci.jobs["desktop-smoke"].steps.find((step) => step.name === "Install dependencies").run,
    "npm --prefix frontend ci --legacy-peer-deps",
  );
  assert.equal(
    ci.jobs["desktop-smoke"].steps.find(
      (step) => step.name === "Upload bounded failure diagnostics",
    ).uses,
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  );
  const frontendPackage = JSON.parse(readFileSync(join(process.cwd(), "frontend", "package.json")));
  assert.equal(
    frontendPackage.scripts["desktop:pack"],
    "node scripts/desktop-package-smoke-pack.mjs",
  );
  assert.deepEqual(ci.jobs.release.needs, [
    "gates",
    "controller",
    "frontend",
    "agent-runtime",
    "desktop-smoke",
  ]);
  const security = parsed("security.yml");
  assert.deepEqual(security.permissions, { contents: "read" });
  assert.deepEqual(security.jobs.codeql.permissions, {
    actions: "read",
    contents: "read",
    "security-events": "write",
  });
  for (const name of ["trufflehog", "codeql", "dependency-review"]) {
    assert.equal(security.jobs[name].needs, "gates");
  }
  const pages = parsed("pages.yml");
  assert.equal(pages.jobs.build.needs, "gates");
  assert.equal(pages.jobs.deploy.needs, "build");
  const labels = parsed("labels.yml");
  assert.deepEqual(labels.permissions, { contents: "read", issues: "write" });
});
