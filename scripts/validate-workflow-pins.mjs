import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const ACTION_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ACTION_IMAGE_PATTERN = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/;
const CONTAINER_IMAGE_PATTERN = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SUPPORTED_BUN_VERSION = "1.3.6";
const GATED_WORKFLOWS = new Set(["ci.yml", "pages.yml", "security.yml"]);
const LOCAL_COMMANDS = new Set([
  "depcheck",
  "depcheck --skip-missing",
  "eslint",
  "eslint .",
  "jscpd src",
  "knip",
  "madge --extensions ts,tsx --circular src",
  "next build",
  "semantic-release",
  "tsc --noEmit",
  "tsc -p desktop/tsconfig.json",
]);
const DYNAMIC_EXECUTABLES = new Set(["bunx", "npx", "pnpx"]);
const SHELL_WRAPPERS = new Set(["bash", "command", "env", "eval", "sh"]);
const ALLOWED_ENVIRONMENT = new Map([
  ["GITHUB_TOKEN", "${{ secrets.GITHUB_TOKEN }}"],
]);

const location = (path) => path.join(".");

const containsPath = (root, target) => {
  const nested = relative(root, target);
  return nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested));
};

const localPath = (value, context, path) => {
  if (!context.repositoryRoot) return { errors: [], target: null };
  if (value.includes("@")) {
    return { errors: [`${location(path)} local uses must not include a ref`], target: null };
  }
  const root = resolve(context.repositoryRoot);
  const target = resolve(root, value.slice(2));
  if (!containsPath(root, target)) {
    return { errors: [`${location(path)} resolves outside the repository`], target: null };
  }
  if (!existsSync(target)) {
    return { errors: [`${location(path)} local dependency does not exist`], target: null };
  }
  const physicalRoot = realpathSync(root);
  const physicalTarget = realpathSync(target);
  if (!containsPath(physicalRoot, physicalTarget)) {
    return { errors: [`${location(path)} resolves outside the repository`], target: null };
  }
  if (statSync(target).isFile()) {
    return /\.ya?ml$/.test(target)
      ? { errors: [], target }
      : { errors: [`${location(path)} local workflow must be YAML`], target: null };
  }
  if (!statSync(target).isDirectory()) {
    return { errors: [`${location(path)} local dependency is not a file or directory`], target: null };
  }
  const manifests = [join(target, "action.yml"), join(target, "action.yaml")].filter(existsSync);
  if (manifests.length !== 1) {
    return {
      errors: [`${location(path)} local action must contain exactly one action.yml or action.yaml`],
      target: null,
    };
  }
  return { errors: [], target: manifests[0] };
};

const validateUses = (value, path, context) => {
  if (typeof value !== "string") return [`${location(path)} must be a string`];
  if (value.startsWith("./")) {
    const resolved = localPath(value, context, path);
    if (resolved.errors.length > 0 || !resolved.target || !context.visitLocal) {
      return resolved.errors;
    }
    return context.visitLocal(resolved.target, path);
  }
  if (value.startsWith("docker://")) {
    return ACTION_IMAGE_PATTERN.test(value)
      ? []
      : [`${location(path)} must pin the Docker action by sha256 digest`];
  }
  const separator = value.lastIndexOf("@");
  const action = value.slice(0, separator);
  const reference = value.slice(separator + 1);
  if (separator <= 0 || !action.includes("/") || !ACTION_SHA_PATTERN.test(reference)) {
    return [`${location(path)} must pin a third-party action to a 40-character commit SHA`];
  }
  return [];
};

const normalizedRun = (run) => run.replace(/\\\r?\n[ \t]*/g, " ");

const parseCommands = (source) => {
  const run = normalizedRun(source);
  if (run.includes("${{") || run.includes("`") || run.includes("$(")) {
    return { commands: [], error: "must not use expressions or command substitution" };
  }
  const commands = [];
  let command = [];
  let token = "";
  let quote = null;
  const pushToken = () => {
    if (token.length > 0) command.push(token);
    token = "";
  };
  const pushCommand = () => {
    pushToken();
    if (command.length > 0) commands.push(command);
    command = [];
  };
  for (let index = 0; index < run.length; index += 1) {
    const character = run[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && quote === '"') {
        index += 1;
        if (index >= run.length) return { commands: [], error: "contains an incomplete escape" };
        token += run[index];
      } else {
        if (character === "$" && quote === '"') {
          return { commands: [], error: "must not expand shell variables" };
        }
        token += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      if (index >= run.length) return { commands: [], error: "contains an incomplete escape" };
      token += run[index];
      continue;
    }
    if (character === "$" || "#;|()<>".includes(character)) {
      return { commands: [], error: "contains unsupported shell syntax" };
    }
    if (character === "&") {
      if (run[index + 1] !== "&") {
        return { commands: [], error: "contains unsupported shell syntax" };
      }
      pushCommand();
      index += 1;
      continue;
    }
    if (character === "\n") {
      pushCommand();
      continue;
    }
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    token += character;
  }
  if (quote) return { commands: [], error: "contains an unterminated quote" };
  pushCommand();
  return commands.length > 0
    ? { commands, error: null }
    : { commands: [], error: "must contain an allowlisted command" };
};

const beforeDelimiter = (arguments_) => {
  const delimiter = arguments_.indexOf("--");
  return delimiter === -1 ? arguments_ : arguments_.slice(0, delimiter);
};

const frozenInstallErrors = (manager, arguments_, path) => {
  if (arguments_.includes("--")) {
    return [`${location(path)} install options are not allowlisted`];
  }
  const options = beforeDelimiter(arguments_);
  const required = manager === "yarn" ? ["--immutable", "--frozen-lockfile"] : ["--frozen-lockfile"];
  const allowed = new Set([...required, "--ignore-scripts"]);
  const unsafe = options.some(
    (option) =>
      option.startsWith("--no-frozen-lockfile") ||
      option.startsWith("--frozen-lockfile=") ||
      option.startsWith("--no-immutable") ||
      option.startsWith("--immutable="),
  );
  if (unsafe || !options.some((option) => required.includes(option))) {
    const label = manager === "pnpm" ? "pnpm" : manager === "yarn" ? "Yarn" : "Bun";
    return [`${location(path)} must freeze ${label} installs with an effective lock option`];
  }
  if (options.some((option) => !allowed.has(option))) {
    return [`${location(path)} install options are not allowlisted`];
  }
  return [];
};

const resolveRepositoryPath = (base, target, context, path) => {
  const resolved = resolve(base, target);
  if (context.repositoryRoot && !containsPath(resolve(context.repositoryRoot), resolved)) {
    return { errors: [`${location(path)} resolves outside the repository`], directory: null };
  }
  if (context.repositoryRoot && (!existsSync(resolved) || !statSync(resolved).isDirectory())) {
    return { errors: [`${location(path)} working directory does not exist`], directory: null };
  }
  if (
    context.repositoryRoot &&
    !containsPath(realpathSync(context.repositoryRoot), realpathSync(resolved))
  ) {
    return { errors: [`${location(path)} resolves outside the repository`], directory: null };
  }
  return { errors: [], directory: resolved };
};

const packageConfiguration = (directory, path) => {
  const packagePath = join(directory, "package.json");
  if (!existsSync(packagePath)) {
    return { errors: [`${location(path)} package.json does not exist`], value: null };
  }
  try {
    return { errors: [], value: JSON.parse(readFileSync(packagePath, "utf8")) };
  } catch (error) {
    return { errors: [`${location(path)} package.json is invalid: ${String(error)}`], value: null };
  }
};

const validateConfiguredScript = (directory, name, source, path, context) => {
  const key = `${resolve(directory)}:${name}`;
  if (context.scriptStack?.includes(key)) {
    return [`${location(path)} package script cycle detected at ${name}`];
  }
  return validateRun(source, path, {
    ...context,
    workingDirectory: resolve(directory),
    scriptStack: [...(context.scriptStack ?? []), key],
  });
};

const validatePackageScript = (directory, script, path, context) => {
  const configuration = packageConfiguration(directory, path);
  if (!configuration.value) return configuration.errors;
  const scripts = configuration.value.scripts ?? {};
  if (typeof scripts[script] !== "string") {
    return [`${location(path)} package script ${script} does not exist`];
  }
  return [`pre${script}`, script, `post${script}`]
    .filter((name) => typeof scripts[name] === "string")
    .flatMap((name) => validateConfiguredScript(directory, name, scripts[name], path, context));
};

const validateInstallScripts = (directory, path, context) => {
  const configuration = packageConfiguration(directory, path);
  if (!configuration.value) return configuration.errors;
  const scripts = configuration.value.scripts ?? {};
  return ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"]
    .filter((script) => typeof scripts[script] === "string")
    .flatMap((script) =>
      validateConfiguredScript(directory, script, scripts[script], path, context),
    );
};

const npmContext = (arguments_, path, context) => {
  let directory = context.workingDirectory;
  let index = 0;
  while (arguments_[index]?.startsWith("-")) {
    const option = arguments_[index];
    if (option === "--silent") {
      index += 1;
      continue;
    }
    if (option === "--prefix") {
      const target = arguments_[index + 1];
      if (!target) return { errors: [`${location(path)} npm --prefix requires a path`] };
      const resolved = resolveRepositoryPath(directory, target, context, path);
      if (!resolved.directory) return { errors: resolved.errors };
      directory = resolved.directory;
      index += 2;
      continue;
    }
    if (option.startsWith("--prefix=")) {
      const resolved = resolveRepositoryPath(directory, option.slice(9), context, path);
      if (!resolved.directory) return { errors: resolved.errors };
      directory = resolved.directory;
      index += 1;
      continue;
    }
    return { errors: [`${location(path)} npm global option ${option} is not allowlisted`] };
  }
  return { arguments: arguments_.slice(index), directory, errors: [] };
};

const validateNpm = (arguments_, path, context) => {
  if (arguments_.includes("exec") || arguments_.includes("x")) {
    return [`${location(path)} must not download packages dynamically`];
  }
  const parsed = npmContext(arguments_, path, context);
  if (parsed.errors.length > 0) return parsed.errors;
  const [command, ...tail] = parsed.arguments;
  if (command === "ci") {
    const allowed = new Set(["--ignore-scripts", "--legacy-peer-deps"]);
    if (!tail.every((option) => allowed.has(option))) {
      return [`${location(path)} npm ci options are not allowlisted`];
    }
    return tail.includes("--ignore-scripts")
      ? []
      : validateInstallScripts(parsed.directory, path, context);
  }
  if (command === "run" || command === "run-script" || command === "test") {
    const script = command === "test" ? "test" : tail[0];
    const extra = command === "test" ? tail : tail.slice(1);
    if (!script || extra.length > 0) {
      return [`${location(path)} npm package-script invocation is not allowlisted`];
    }
    return validatePackageScript(parsed.directory, script, path, context);
  }
  if (["i", "in", "ins", "install", "isntall", "add"].includes(command)) {
    return [`${location(path)} must use npm ci`];
  }
  return [`${location(path)} npm command ${String(command)} is not allowlisted`];
};

const validateBun = (arguments_, path, context) => {
  const [command, ...tail] = arguments_;
  if (command === "install" || command === "i") {
    const errors = frozenInstallErrors("bun", tail, path);
    return errors.length > 0 || tail.includes("--ignore-scripts")
      ? errors
      : validateInstallScripts(context.workingDirectory, path, context);
  }
  if (command === "run") {
    const [script, ...extra] = tail;
    return script && extra.length === 0
      ? validatePackageScript(context.workingDirectory, script, path, context)
      : [`${location(path)} Bun package-script invocation is not allowlisted`];
  }
  if (command === "x") return [`${location(path)} must not download packages dynamically`];
  if (command === "test") return [];
  if (command === "build") {
    return tail.join(" ") ===
      "src/server.ts --target=node --external fsevents --outfile=dist/standalone.mjs"
      ? []
      : [`${location(path)} Bun build invocation is not allowlisted`];
  }
  if (command && /\.[cm]?[jt]s$/.test(command)) {
    return tail.length === 0
      ? validateScriptPath(command, path, context)
      : [`${location(path)} Bun script arguments are not allowlisted`];
  }
  return [`${location(path)} Bun command ${String(command)} is not allowlisted`];
};

const validateAlternativeManager = (manager, arguments_, path, context) => {
  const [command, ...tail] = arguments_;
  if (manager === "yarn" && command === undefined) {
    return frozenInstallErrors(manager, [], path);
  }
  if (manager === "yarn" && command?.startsWith("-") && !command.startsWith("--no-")) {
    const errors = frozenInstallErrors(manager, arguments_, path);
    return errors.length > 0 || arguments_.includes("--ignore-scripts")
      ? errors
      : validateInstallScripts(context.workingDirectory, path, context);
  }
  if (command === "install" || command === "i") {
    const errors = frozenInstallErrors(manager, tail, path);
    return errors.length > 0 || tail.includes("--ignore-scripts")
      ? errors
      : validateInstallScripts(context.workingDirectory, path, context);
  }
  if (command === "dlx") return [`${location(path)} must not download packages dynamically`];
  if (command === "run" || command === "test") {
    const script = command === "test" ? "test" : tail[0];
    const extra = command === "test" ? tail : tail.slice(1);
    return script && extra.length === 0
      ? validatePackageScript(context.workingDirectory, script, path, context)
      : [`${location(path)} ${manager} package-script invocation is not allowlisted`];
  }
  return [`${location(path)} ${manager} command ${String(command)} is not allowlisted`];
};

const validateScriptPath = (script, path, context) => {
  if (!context.repositoryRoot) return [];
  const target = resolve(context.workingDirectory, script);
  const root = resolve(context.repositoryRoot);
  if (!containsPath(root, target)) return [`${location(path)} script resolves outside the repository`];
  if (!existsSync(target) || !statSync(target).isFile()) {
    return [`${location(path)} script does not exist`];
  }
  return containsPath(realpathSync(root), realpathSync(target))
    ? []
    : [`${location(path)} script resolves outside the repository`];
};

const validateNode = (arguments_, path, context) => {
  if (arguments_.some((argument) => ["-e", "--eval", "-p", "--print"].includes(argument))) {
    return [`${location(path)} Node.js eval and print modes are not allowed`];
  }
  const scriptIndex = arguments_.findIndex((argument) => !argument.startsWith("-"));
  if (scriptIndex === -1) return [`${location(path)} Node.js must execute a repository script`];
  const allowedOptions = arguments_.slice(0, scriptIndex).every(
    (option) =>
      option === "--experimental-test-coverage" ||
      option === "--test" ||
      /^--test-coverage-(?:branches|functions|lines)=\d+$/.test(option),
  );
  if (!allowedOptions || arguments_.length !== scriptIndex + 1) {
    return [`${location(path)} Node.js options and script arguments are not allowlisted`];
  }
  return validateScriptPath(arguments_[scriptIndex], path, context);
};

const validateGit = (arguments_, path) => {
  const [command, key, value, ...extra] = arguments_;
  if (command === "config" && ["user.email", "user.name"].includes(key) && value && extra.length === 0) {
    return [];
  }
  return [`${location(path)} git command is not allowlisted`];
};

const validateCommand = ([executable, ...arguments_], path, context) => {
  if (DYNAMIC_EXECUTABLES.has(executable)) {
    return [`${location(path)} must not download packages dynamically`];
  }
  if (SHELL_WRAPPERS.has(executable)) {
    return [`${location(path)} shell wrapper ${executable} is not allowed`];
  }
  if (executable.includes("/") || executable.includes("\\")) {
    return [`${location(path)} executable paths are not allowed`];
  }
  if (executable === "npm") return validateNpm(arguments_, path, context);
  if (executable === "bun") return validateBun(arguments_, path, context);
  if (executable === "pnpm" || executable === "yarn") {
    return validateAlternativeManager(executable, arguments_, path, context);
  }
  if (executable === "node") return validateNode(arguments_, path, context);
  if (executable === "git") return validateGit(arguments_, path);
  return LOCAL_COMMANDS.has([executable, ...arguments_].join(" "))
    ? []
    : [`${location(path)} executable ${executable} is not allowlisted`];
};

const validateRun = (source, path, context) => {
  const parsed = parseCommands(source);
  if (parsed.error) return [`${location(path)} ${parsed.error}`];
  return parsed.commands.flatMap((command) => validateCommand(command, path, context));
};

const workflowInputs = (step) =>
  step.with && typeof step.with === "object" && !Array.isArray(step.with) ? step.with : {};

const runtimeAction = (uses) => uses.slice(0, uses.lastIndexOf("@")).toLowerCase();

const validateNodeSetup = (step, path) => {
  const inputs = workflowInputs(step);
  const errors = Object.hasOwn(inputs, "node-version-file")
    ? [`${location([...path, "with", "node-version-file"])} must not use version files`]
    : [];
  if (
    typeof inputs["node-version"] !== "string" ||
    !EXACT_VERSION_PATTERN.test(inputs["node-version"])
  ) {
    errors.push(`${location([...path, "with", "node-version"])} must use an exact Node.js version`);
  }
  return errors;
};

const validateBunSetup = (step, path) => {
  const inputs = workflowInputs(step);
  const errors = [];
  if (Object.hasOwn(inputs, "bun-version-file")) {
    errors.push(`${location([...path, "with", "bun-version-file"])} must not use version files`);
  }
  if (Object.hasOwn(inputs, "bun-download-url")) {
    errors.push(`${location([...path, "with", "bun-download-url"])} must not use download URLs`);
  }
  if (inputs["bun-version"] !== SUPPORTED_BUN_VERSION) {
    errors.push(`${location([...path, "with", "bun-version"])} must use Bun ${SUPPORTED_BUN_VERSION}`);
  }
  return errors;
};

const validateRuntimeStep = (value, path) => {
  if (typeof value.uses !== "string") return [];
  const action = runtimeAction(value.uses);
  if (action === "actions/setup-node") return validateNodeSetup(value, path);
  if (action === "oven-sh/setup-bun") return validateBunSetup(value, path);
  return [];
};

const imageError = (value, path) =>
  typeof value === "string" && CONTAINER_IMAGE_PATTERN.test(value)
    ? []
    : [`${location(path)} must pin the container image by sha256 digest`];

const validateImages = (value, path) => {
  const errors = [];
  if (Object.hasOwn(value, "container")) {
    const container = value.container;
    errors.push(
      ...imageError(
        container && typeof container === "object" ? container.image : container,
        [...path, "container", ...(container && typeof container === "object" ? ["image"] : [])],
      ),
    );
  }
  if (value.services && typeof value.services === "object" && !Array.isArray(value.services)) {
    for (const [name, service] of Object.entries(value.services)) {
      errors.push(...imageError(service?.image, [...path, "services", name, "image"]));
    }
  }
  return errors;
};

const workingContext = (value, path, context) => {
  const configured = value["working-directory"] ?? value.defaults?.run?.["working-directory"];
  if (configured === undefined) return { context, errors: [] };
  if (typeof configured !== "string" || configured.includes("${{") || configured.includes("$")) {
    return { context, errors: [`${location([...path, "working-directory"])} is not allowlisted`] };
  }
  const resolved = resolveRepositoryPath(
    context.repositoryRoot ?? context.workingDirectory,
    configured,
    context,
    path,
  );
  return resolved.directory
    ? { context: { ...context, workingDirectory: resolved.directory }, errors: [] }
    : { context, errors: resolved.errors };
};

const validateEnvironment = (value, path) => {
  if (!Object.hasOwn(value, "env")) return [];
  const environment = value.env;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    return [`${location([...path, "env"])} must be an allowlisted environment map`];
  }
  return Object.entries(environment).flatMap(([name, configured]) =>
    ALLOWED_ENVIRONMENT.get(name) === configured
      ? []
      : [`${location([...path, "env", name])} is not allowlisted`],
  );
};

const validateScalar = (key, value, path, context) => {
  const errors =
    typeof value === "string" && /\blatest\b/i.test(value)
      ? [`${location(path)} must not use latest`]
      : [];
  if (key === "uses") errors.push(...validateUses(value, path, context));
  if (key === "run" && typeof value === "string") errors.push(...validateRun(value, path, context));
  if (key === "shell") errors.push(`${location(path)} explicit shell overrides are not allowed`);
  return errors;
};

const validateValue = (value, path, context) => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => validateValue(entry, [...path, String(index)], context));
  }
  if (!value || typeof value !== "object") return [];
  const scoped = workingContext(value, path, context);
  return [
    ...scoped.errors,
    ...validateEnvironment(value, path),
    ...validateRuntimeStep(value, path),
    ...validateImages(value, path),
    ...Object.entries(value).flatMap(([key, entry]) => {
      const entryPath = [...path, key];
      return [
        ...validateScalar(key, entry, entryPath, scoped.context),
        ...validateValue(entry, entryPath, scoped.context),
      ];
    }),
  ];
};

const jobNeeds = (job) => {
  if (typeof job?.needs === "string") return [job.needs];
  return Array.isArray(job?.needs) ? job.needs.filter((need) => typeof need === "string") : [];
};

const dependsOnGate = (name, jobs, seen = new Set()) => {
  if (name === "gates") return true;
  if (seen.has(name)) return false;
  seen.add(name);
  return jobNeeds(jobs[name]).some((dependency) =>
    dependsOnGate(dependency, jobs, new Set(seen)),
  );
};

const executableJob = (job) =>
  Boolean(job && typeof job === "object" && (job.uses || job.container || job.services || job.steps));

const safeGateStep = (step) =>
  step?.run === "npm run check:workflow-pins" &&
  !Object.hasOwn(step, "continue-on-error") &&
  !Object.hasOwn(step, "if") &&
  !Object.hasOwn(step, "working-directory");

const bypassesDependencySuccess = (job) =>
  typeof job?.if === "string" && /\b(?:always|cancelled|failure)\s*\(/.test(job.if);

const validateGateGraph = (value, file) => {
  if (!GATED_WORKFLOWS.has(basename(file))) return [];
  const jobs = value?.jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return [`${file}: jobs must be an object`];
  const gate = jobs.gates;
  if (!gate || !Array.isArray(gate.steps)) return [`${file}: jobs.gates must be a pin gate`];
  const invokesPolicy = gate.steps.some(safeGateStep);
  const errors = invokesPolicy ? [] : [`${file}: jobs.gates must run npm run check:workflow-pins`];
  if (Object.hasOwn(gate, "continue-on-error") || Object.hasOwn(gate, "if")) {
    errors.push(`${file}: jobs.gates must not weaken failure propagation`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    if (name !== "gates" && executableJob(job) && !dependsOnGate(name, jobs)) {
      errors.push(`${file}: jobs.${name} must depend on jobs.gates`);
    }
    if (name !== "gates" && executableJob(job) && bypassesDependencySuccess(job)) {
      errors.push(`${file}: jobs.${name} must not bypass dependency success`);
    }
  }
  return errors;
};

export const validateWorkflowSource = (source, file = "workflow.yml", context = {}) => {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return document.errors.map((error) => `${file}: ${error.message}`);
  }
  const value = document.toJS();
  const scoped = {
    repositoryRoot: context.repositoryRoot ?? null,
    scriptStack: context.scriptStack ?? [],
    visitLocal: context.visitLocal ?? null,
    workingDirectory: context.workingDirectory ?? context.repositoryRoot ?? process.cwd(),
  };
  return [
    ...validateValue(value, [], scoped).map((error) => `${file}: ${error}`),
    ...validateGateGraph(value, file),
  ];
};

const repositoryValidator = (repositoryRoot, labelRoot) => {
  const completed = new Set();
  const active = [];
  const physicalRoot = realpathSync(repositoryRoot);
  const visit = (file, sourcePath = []) => {
    const canonical = realpathSync(file);
    const label = relative(labelRoot, file);
    if (!containsPath(physicalRoot, canonical)) {
      return [`${label}: ${location(sourcePath)} resolves outside the repository`];
    }
    const cycleIndex = active.indexOf(canonical);
    if (cycleIndex !== -1) {
      const cycle = [...active.slice(cycleIndex), canonical]
        .map((entry) => relative(labelRoot, entry))
        .join(" -> ");
      return [`${label}: ${location(sourcePath)} local dependency cycle detected: ${cycle}`];
    }
    if (completed.has(canonical)) return [];
    active.push(canonical);
    const errors = validateWorkflowSource(readFileSync(file, "utf8"), label, {
      repositoryRoot,
      visitLocal: visit,
      workingDirectory: repositoryRoot,
    });
    active.pop();
    completed.add(canonical);
    return errors;
  };
  return visit;
};

export const validateWorkflowDirectory = (directory) => {
  const files = readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();
  if (files.length === 0) return [`${directory}: no workflow files found`];
  const repositoryDirectory =
    basename(directory) === "workflows" && basename(dirname(directory)) === ".github";
  const repositoryRoot = resolve(directory, "..", "..");
  const visit = repositoryValidator(repositoryRoot, repositoryDirectory ? repositoryRoot : directory);
  return files.flatMap((file) => visit(join(directory, file)));
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repositoryRoot = resolve(dirname(scriptPath), "..");
  const errors = validateWorkflowDirectory(join(repositoryRoot, ".github", "workflows"));
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Workflow pin validation passed\n");
  }
}
