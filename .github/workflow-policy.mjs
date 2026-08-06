import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const actionSha = /^[0-9a-f]{40}$/i;
const containerDigest = /@sha256:[0-9a-f]{64}$/i;
const exactRuntimeVersion = /^\d+\.\d+\.\d+$/;

const scalarValue = (line, key) => {
  const match = line.match(new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(.*?)\\s*$`));
  if (!match) return undefined;
  const raw = match[1].trim();
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw.replace(/\s+#.*$/, "").trim();
};

const indentation = (line) => line.match(/^\s*/)?.[0].length ?? 0;

const workflowCommands = (lines) => {
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?run:\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2];
    if (!/^[|>][+-]?$/.test(value)) {
      commands.push({ line: index + 1, value });
      continue;
    }
    const baseIndent = match[1].length;
    const body = [];
    let bodyIndex = index + 1;
    while (
      bodyIndex < lines.length &&
      (lines[bodyIndex].trim() === "" || indentation(lines[bodyIndex]) > baseIndent)
    ) {
      if (lines[bodyIndex].trim() !== "") {
        body.push({ line: bodyIndex + 1, value: lines[bodyIndex].trim() });
      }
      bodyIndex += 1;
    }
    if (value.startsWith(">")) {
      commands.push({
        line: body[0]?.line ?? index + 1,
        value: body.map(({ value }) => value).join(" "),
      });
    } else {
      for (let bodyLine = 0; bodyLine < body.length; bodyLine += 1) {
        const start = body[bodyLine].line;
        let command = body[bodyLine].value;
        while (command.endsWith("\\") && bodyLine + 1 < body.length) {
          command = `${command.slice(0, -1)} ${body[++bodyLine].value}`;
        }
        commands.push({ line: start, value: command });
      }
    }
    index = bodyIndex - 1;
  }
  return commands;
};

const policyError = (file, line, message) => ({ file, line, message });

export const validateWorkflowSource = (source, file = "workflow.yml") => {
  const lines = source.split(/\r?\n/);
  const errors = [];

  for (let index = 0; index < lines.length; index += 1) {
    const uses = scalarValue(lines[index], "uses");
    if (uses !== undefined) {
      if (uses.startsWith("./")) continue;
      if (uses.startsWith("docker://")) {
        if (!containerDigest.test(uses)) {
          errors.push(
            policyError(file, index + 1, `container action must use a sha256 digest: ${uses}`),
          );
        }
        continue;
      }
      const separator = uses.lastIndexOf("@");
      const reference = separator === -1 ? "" : uses.slice(separator + 1);
      if (!actionSha.test(reference)) {
        errors.push(
          policyError(
            file,
            index + 1,
            `external action must use a 40-character commit SHA: ${uses}`,
          ),
        );
      }
    }

    for (const key of ["bun-version", "node-version"]) {
      const version = scalarValue(lines[index], key);
      if (version !== undefined && !exactRuntimeVersion.test(version)) {
        errors.push(
          policyError(file, index + 1, `${key} must use an exact x.y.z version: ${version}`),
        );
      }
    }
  }

  for (const command of workflowCommands(lines)) {
    if (/\b(?:npx|bunx|pnpx)\b|\byarn\s+dlx\b|\bnpm\s+exec\b/.test(command.value)) {
      errors.push(
        policyError(file, command.line, `dynamic package execution is forbidden: ${command.value}`),
      );
    }
    if (/\bnpm\s+(?:install|i)\b/.test(command.value)) {
      errors.push(
        policyError(file, command.line, `npm workflows must use npm ci: ${command.value}`),
      );
    }
    if (/\bbun\s+install\b/.test(command.value) && !/--frozen-lockfile\b/.test(command.value)) {
      errors.push(
        policyError(
          file,
          command.line,
          `Bun installs must use --frozen-lockfile: ${command.value}`,
        ),
      );
    }
    if (/\bpnpm\s+install\b/.test(command.value) && !/--frozen-lockfile\b/.test(command.value)) {
      errors.push(
        policyError(
          file,
          command.line,
          `pnpm installs must use --frozen-lockfile: ${command.value}`,
        ),
      );
    }
    if (
      /\byarn\s+install\b/.test(command.value) &&
      !/--(?:immutable|frozen-lockfile)\b/.test(command.value)
    ) {
      errors.push(
        policyError(
          file,
          command.line,
          `Yarn installs must use --immutable or --frozen-lockfile: ${command.value}`,
        ),
      );
    }
  }

  return errors;
};

export const validateRepositoryWorkflows = (root = process.cwd()) => {
  const workflowDirectory = path.join(root, ".github", "workflows");
  const files = readdirSync(workflowDirectory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort();
  const errors = files.flatMap((file) =>
    validateWorkflowSource(readFileSync(path.join(workflowDirectory, file), "utf8"), file),
  );
  return { errors, files };
};

export const assertRepositoryWorkflowPolicy = (root = process.cwd()) => {
  const result = validateRepositoryWorkflows(root);
  if (result.errors.length > 0) {
    throw new Error(
      result.errors.map(({ file, line, message }) => `${file}:${line}: ${message}`).join("\n"),
    );
  }
  return result.files.length;
};

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invoked) {
  try {
    const count = assertRepositoryWorkflowPolicy();
    console.log(`Workflow policy passed: ${count} workflow files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
