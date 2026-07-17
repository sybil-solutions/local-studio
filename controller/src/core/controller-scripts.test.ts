import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const INSTALLER = join(REPOSITORY_ROOT, "scripts", "install-controller.sh");
const DAEMON = join(REPOSITORY_ROOT, "scripts", "daemon.sh");
const DEPLOY = join(REPOSITORY_ROOT, "scripts", "deploy-remote.sh");
const PROCESS_OWNERSHIP = join(REPOSITORY_ROOT, "scripts", "controller-process-ownership.sh");

let fixture: string;
let home: string;
let install: string;
let bin: string;
let units: string;
let systemctlLog: string;
let dockerLog: string;

const writeExecutable = (path: string, body: string): void => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

const seedInstall = (root: string): void => {
  mkdirSync(join(root, "controller", "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "controller", "package.json"), '{"name":"synthetic"}\n');
  writeFileSync(join(root, "controller", "bun.lock"), "synthetic-lock\n");
  writeFileSync(join(root, "controller", "src", "bootstrap.ts"), 'import "./imported";\n');
  writeFileSync(join(root, "controller", "src", "imported.ts"), "export {};\n");
  copyFileSync(PROCESS_OWNERSHIP, join(root, "scripts", "controller-process-ownership.sh"));
};

const installerEnvironment = (
  root = install,
  systemd = false,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  HOME: home,
  USER: "synthetic-user",
  PATH: `${bin}:/usr/bin:/bin`,
  LOCAL_STUDIO_DIR: root,
  LOCAL_STUDIO_PORT: "18081",
  LOCAL_STUDIO_REPO: "https://invalid.test/synthetic",
  SYNTHETIC_SYSTEMD_UNIT_DIR: units,
  SYNTHETIC_SYSTEMCTL_LOG: systemctlLog,
  SYNTHETIC_DOCKER_LOG: dockerLog,
  LOCAL_STUDIO_PROCESS_PROC_ROOT: join(fixture, "proc"),
  LOCAL_STUDIO_PROCESS_KILL_BIN: join(bin, "process-kill"),
  LOCAL_STUDIO_PROCESS_LSOF_BIN: join(bin, "process-lsof"),
  LOCAL_STUDIO_PROCESS_PGREP_BIN: join(bin, "process-pgrep"),
  SYNTHETIC_LISTENER_PID_FILE: join(fixture, "listener.pid"),
  SYNTHETIC_SIGNAL_LOG: join(fixture, "signals.log"),
  ...(systemd ? { LOCAL_STUDIO_SYSTEMD_RUNTIME_DIR: fixture } : {}),
  ...extra,
});

const runInstaller = (
  root = install,
  systemd = false,
  extra: NodeJS.ProcessEnv = {},
): ReturnType<typeof Bun.spawnSync> =>
  Bun.spawnSync({
    cmd: ["bash", "-c", 'umask 000; exec bash "$1"', "synthetic-installer", INSTALLER],
    cwd: REPOSITORY_ROOT,
    env: installerEnvironment(root, systemd, extra),
    stdout: "pipe",
    stderr: "pipe",
  });

const runDaemon = (
  script: string,
  action = "start",
  extra: NodeJS.ProcessEnv = {},
): ReturnType<typeof Bun.spawnSync> =>
  Bun.spawnSync({
    cmd: ["bash", script, action],
    cwd: resolve(script, "../.."),
    env: {
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      LOCAL_STUDIO_BUN_BIN: join(bin, "daemon-bun"),
      LOCAL_STUDIO_PID_FILE: join(fixture, "daemon.pid"),
      LOCAL_STUDIO_LOG_FILE: join(fixture, "daemon.log"),
      SYNTHETIC_DAEMON_MARKER: join(fixture, "daemon-invoked"),
      LOCAL_STUDIO_PROCESS_PROC_ROOT: join(fixture, "proc"),
      LOCAL_STUDIO_PROCESS_KILL_BIN: join(bin, "process-kill"),
      LOCAL_STUDIO_PROCESS_LSOF_BIN: join(bin, "process-lsof"),
      LOCAL_STUDIO_PROCESS_PGREP_BIN: join(bin, "process-pgrep"),
      SYNTHETIC_LISTENER_PID_FILE: join(fixture, "listener.pid"),
      SYNTHETIC_SIGNAL_LOG: join(fixture, "signals.log"),
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

const runDeploy = (extra: NodeJS.ProcessEnv = {}): ReturnType<typeof Bun.spawnSync> =>
  Bun.spawnSync({
    cmd: ["bash", DEPLOY, "controller"],
    cwd: REPOSITORY_ROOT,
    env: {
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      REMOTE_HOST: "synthetic.invalid",
      REMOTE_USER: "synthetic-user",
      REMOTE_PATH: install,
      REMOTE_SSH_KEY: join(fixture, "synthetic-key"),
      SYNTHETIC_DEPLOY_MARKER: join(fixture, "deploy-invoked"),
      SYNTHETIC_SYSTEMD_UNIT_DIR: units,
      SYNTHETIC_SYSTEMCTL_LOG: systemctlLog,
      SYNTHETIC_DOCKER_LOG: dockerLog,
      LOCAL_STUDIO_PROCESS_PROC_ROOT: join(fixture, "proc"),
      SYNTHETIC_LISTENER_PID_FILE: join(fixture, "listener.pid"),
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

const writeUnit = (service: string, root: string, active = false): void => {
  writeFileSync(
    join(units, service),
    `[Service]\nWorkingDirectory=${root}\nEnvironmentFile=${root}/.env\nExecStart=${home}/.bun/bin/bun ${root}/controller/src/main.ts\n`,
  );
  if (active) writeFileSync(join(units, `${service}.active`), "active\n");
};

const writeEffectiveUnit = (
  service: string,
  values: {
    workingDirectory: string;
    environmentFile: string;
    executable: string;
    entrypoint: string;
    active?: boolean;
    unloaded?: boolean;
  },
): void => {
  writeFileSync(
    join(units, service),
    [
      "[Service]",
      `WorkingDirectory=${values.workingDirectory}`,
      `EnvironmentFile=${values.environmentFile}`,
      `ExecStart=${values.executable} ${values.entrypoint}`,
      "",
    ].join("\n"),
  );
  if (values.active) writeFileSync(join(units, `${service}.active`), "active\n");
  if (values.unloaded) writeFileSync(join(units, `${service}.unloaded`), "unloaded\n");
};

const mutationLog = (): string =>
  `${existsSync(systemctlLog) ? readFileSync(systemctlLog, "utf8") : ""}\n${
    existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : ""
  }`;

const expectNoControllerMutation = (launchMarker: string): void => {
  const mutations = mutationLog();
  expect(mutations).not.toContain("daemon-reload");
  expect(mutations).not.toContain("restart ");
  expect(mutations).not.toContain("compose stop controller");
  expect(existsSync(launchMarker)).toBe(false);
};

const processIsAlive = (pid: number): boolean =>
  Bun.spawnSync({
    cmd: ["/bin/kill", "-0", String(pid)],
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0;

const syntheticProcessStat = (pid: number, startIdentity: string): string =>
  `${pid} (bun) ${["S", ...Array.from({ length: 18 }, () => "0"), startIdentity].join(" ")}\n`;

const seedSyntheticProcess = (
  pid: number,
  values: {
    executable: string;
    cwd: string;
    arguments: readonly string[];
    startIdentity?: string;
  },
): void => {
  const processRoot = join(fixture, "proc", String(pid));
  mkdirSync(processRoot, { recursive: true });
  symlinkSync(values.executable, join(processRoot, "exe"));
  symlinkSync(values.cwd, join(processRoot, "cwd"));
  writeFileSync(join(processRoot, "comm"), "bun\n");
  writeFileSync(join(processRoot, "cmdline"), Buffer.from(`${values.arguments.join("\0")}\0`));
  writeFileSync(
    join(processRoot, "stat"),
    syntheticProcessStat(pid, values.startIdentity ?? "424242"),
  );
  writeFileSync(join(processRoot, "alive"), "alive\n");
};

const syntheticProcessEnvironment = (
  pids: readonly number[],
  listeners: readonly number[] = [],
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  LOCAL_STUDIO_PROCESS_PROC_ROOT: join(fixture, "proc"),
  LOCAL_STUDIO_PROCESS_KILL_BIN: join(bin, "process-kill"),
  LOCAL_STUDIO_PROCESS_LSOF_BIN: join(bin, "process-lsof"),
  LOCAL_STUDIO_PROCESS_PGREP_BIN: join(bin, "process-pgrep"),
  SYNTHETIC_PROCESS_PIDS: pids.join(" "),
  SYNTHETIC_LISTENER_PIDS: listeners.join(" "),
  SYNTHETIC_LISTENER_PID_FILE: join(fixture, "listener.pid"),
  SYNTHETIC_SIGNAL_LOG: join(fixture, "signals.log"),
  ...extra,
});

const syntheticProcessAlive = (pid: number): boolean =>
  existsSync(join(fixture, "proc", String(pid), "alive"));

const syntheticSignals = (): string => {
  const path = join(fixture, "signals.log");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

const writeSyntheticDaemonLauncher = (listenerCommand: string): void => {
  writeExecutable(
    join(bin, "daemon-bun"),
    `root=$LOCAL_STUDIO_PROCESS_PROC_ROOT; pid=$$; process="$root/$pid"; mkdir -p "$process"; ln -s "$0" "$process/exe"; ln -s "$PWD" "$process/cwd"; printf "%s\\0%s\\0" "$0" "$1" > "$process/cmdline"; printf "%s (bun) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 424242\\n" "$pid" > "$process/stat"; printf alive > "$process/alive"; ${listenerCommand}; printf invoked > "$SYNTHETIC_DAEMON_MARKER"`,
  );
};

const darwinProcessEnvironment = (
  pid: number,
  listeners: readonly number[],
): { alive: string; environment: NodeJS.ProcessEnv } => {
  const bun = join(bin, "daemon-bun");
  const alive = join(fixture, "darwin-alive");
  const startIdentity = "Sat Jul 18 12:34:56 2026";
  writeFileSync(alive, "alive\n");
  writeFileSync(join(fixture, "daemon.pid"), `${pid}|${startIdentity}\n`);
  writeExecutable(
    join(bin, "darwin-kill"),
    'case "${1:-}" in -0) [ -f "$SYNTHETIC_DARWIN_ALIVE" ] ;; -TERM|-KILL) printf "%s %s\\n" "$1" "$2" >> "$SYNTHETIC_SIGNAL_LOG"; rm -f "$SYNTHETIC_DARWIN_ALIVE" ;; *) exit 1 ;; esac',
  );
  writeExecutable(
    join(bin, "darwin-pgrep"),
    '[ ! -f "$SYNTHETIC_DARWIN_ALIVE" ] || printf "%s\\n" "$SYNTHETIC_DARWIN_PID"',
  );
  writeExecutable(
    join(bin, "darwin-lsof"),
    '[ -f "$SYNTHETIC_DARWIN_ALIVE" ] || exit 0\ncase "$*" in *"-d cwd"*) printf "n%s\\n" "$SYNTHETIC_DARWIN_CWD" ;; *"-d txt"*) printf "n%s\\n" "$SYNTHETIC_DARWIN_BUN" ;; *) for pid in $SYNTHETIC_DARWIN_LISTENERS; do printf "%s\\n" "$pid"; done ;; esac',
  );
  writeExecutable(
    join(bin, "darwin-ps"),
    'case "$*" in *"uid="*) id -u ;; *"command="*) printf "%s src/bootstrap.ts\\n" "$SYNTHETIC_DARWIN_BUN" ;; *"lstart="*) printf "%s\\n" "$SYNTHETIC_DARWIN_START" ;; *) exit 1 ;; esac',
  );
  return {
    alive,
    environment: syntheticProcessEnvironment([], [], {
      LOCAL_STUDIO_PROCESS_PROC_ROOT: join(fixture, "missing-proc"),
      LOCAL_STUDIO_PROCESS_KILL_BIN: join(bin, "darwin-kill"),
      LOCAL_STUDIO_PROCESS_LSOF_BIN: join(bin, "darwin-lsof"),
      LOCAL_STUDIO_PROCESS_PGREP_BIN: join(bin, "darwin-pgrep"),
      LOCAL_STUDIO_PROCESS_PS_BIN: join(bin, "darwin-ps"),
      SYNTHETIC_DARWIN_ALIVE: alive,
      SYNTHETIC_DARWIN_PID: String(pid),
      SYNTHETIC_DARWIN_CWD: join(REPOSITORY_ROOT, "controller"),
      SYNTHETIC_DARWIN_BUN: bun,
      SYNTHETIC_DARWIN_START: startIdentity,
      SYNTHETIC_DARWIN_LISTENERS: listeners.join(" "),
    }),
  };
};

const withForeignListener = async (
  assertion: (pid: number, launchMarker: string) => void | Promise<void>,
  visibleToSocketScan = true,
): Promise<void> => {
  const victim = Bun.spawn({
    cmd: ["/bin/sleep", "60"],
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    writeExecutable(
      join(bin, "fuser"),
      'if [ -n "${SYNTHETIC_FOREIGN_PID:-}" ] && kill -0 "$SYNTHETIC_FOREIGN_PID" 2>/dev/null; then printf "%s\\n" "$SYNTHETIC_FOREIGN_PID"; fi',
    );
    writeExecutable(
      join(bin, "ss"),
      visibleToSocketScan
        ? 'if [ -n "${SYNTHETIC_FOREIGN_PID:-}" ] && kill -0 "$SYNTHETIC_FOREIGN_PID" 2>/dev/null; then printf "LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* pid=%s\\n" "$SYNTHETIC_FOREIGN_PID"; fi'
        : "exit 0",
    );
    await assertion(victim.pid, join(fixture, "deploy-launched"));
  } finally {
    victim.kill();
    await victim.exited;
  }
};

const withOwnedControllerProcess = async (
  assertion: (
    pid: number,
    launchMarker: string,
    driftMarker: string,
    processMarker: string,
  ) => void | Promise<void>,
): Promise<void> => {
  const processMarker = join(fixture, "owned-process-running");
  const process = Bun.spawn({
    cmd: [
      "bash",
      "-c",
      'marker=$1; proc_root=$2; trap \'rm -f "$marker" "$proc_root/$$/alive"; exit 0\' TERM INT; : > "$marker"; while :; do sleep 1; done',
      "synthetic-owned-controller",
      processMarker,
      join(fixture, "proc"),
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
  const launchMarker = join(fixture, "owned-process-launch");
  const driftMarker = join(fixture, "owned-process-drift");
  const processEnvironment = 'pid="${SYNTHETIC_OWNED_PID:-}"';
  const processAlive = '[ -f "$SYNTHETIC_PROCESS_MARKER" ] || exit 0';
  try {
    writeExecutable(
      join(bin, "pgrep"),
      `${processEnvironment}\n${processAlive}\nprintf "%s\\n" "$pid"`,
    );
    writeExecutable(
      join(bin, "fuser"),
      `${processEnvironment}\nif [ -f "$SYNTHETIC_PROCESS_MARKER" ]; then printf "%s\\n" "$pid"; elif [ -f "$SYNTHETIC_LISTENER_PID_FILE" ]; then listener=$(cat "$SYNTHETIC_LISTENER_PID_FILE"); [ ! -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$listener/alive" ] || printf "%s\\n" "$listener"; fi`,
    );
    writeExecutable(
      join(bin, "ss"),
      `${processEnvironment}\nif [ -f "$SYNTHETIC_PROCESS_MARKER" ]; then printf "LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* pid=%s\\n" "$pid"; elif [ -f "$SYNTHETIC_LISTENER_PID_FILE" ]; then listener=$(cat "$SYNTHETIC_LISTENER_PID_FILE"); [ ! -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$listener/alive" ] || printf "LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* pid=%s\\n" "$listener"; fi`,
    );
    for (let attempt = 0; attempt < 100 && !existsSync(processMarker); attempt += 1) {
      await Bun.sleep(10);
    }
    if (!existsSync(processMarker)) throw new Error("Synthetic owned controller did not start");
    seedSyntheticProcess(process.pid, {
      executable: join(home, ".bun", "bin", "bun"),
      cwd: join(install, "controller"),
      arguments: [join(home, ".bun", "bin", "bun"), "src/bootstrap.ts"],
    });
    await assertion(process.pid, launchMarker, driftMarker, processMarker);
  } finally {
    if (existsSync(processMarker)) process.kill();
    await process.exited;
  }
};

beforeEach(() => {
  fixture = realpathSync(mkdtempSync(join(tmpdir(), "local-studio-script-security-")));
  home = join(fixture, "home");
  install = join(fixture, "install");
  bin = join(fixture, "bin");
  units = join(fixture, "units");
  systemctlLog = join(fixture, "systemctl.log");
  dockerLog = join(fixture, "docker.log");
  mkdirSync(join(home, ".bun", "bin"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(units);
  seedInstall(install);
  writeExecutable(
    join(home, ".bun", "bin", "bun"),
    '[ "${1:-}" != "--version" ] || printf "synthetic-bun\\n"\nif [ "${1:-}" = "install" ] && [ -n "${SYNTHETIC_MUTATE_SOURCE:-}" ]; then chmod 666 "$SYNTHETIC_MUTATE_SOURCE"; fi\n[ -z "${SYNTHETIC_DEPLOY_MARKER:-}" ] || printf invoked > "$SYNTHETIC_DEPLOY_MARKER"\nif { [ "${1:-}" = "run" ] && [ "${2:-}" = "controller/src/bootstrap.ts" ]; } || [ "${1:-}" = "src/bootstrap.ts" ]; then\n  [ -z "${SYNTHETIC_DEPLOY_LAUNCH_MARKER:-}" ] || printf launched > "$SYNTHETIC_DEPLOY_LAUNCH_MARKER"\n  if [ -n "${LOCAL_STUDIO_PROCESS_PROC_ROOT:-}" ]; then\n    process="$LOCAL_STUDIO_PROCESS_PROC_ROOT/$$"\n    mkdir -p "$process"\n    if [ -n "${SYNTHETIC_PUBLISH_LISTENER_EARLY:-}" ]; then printf alive > "$process/alive"; printf "%s\\n" "$$" > "$SYNTHETIC_LISTENER_PID_FILE"; sleep 0.2; fi\n    ln -sf "$0" "$process/exe"\n    ln -sf "$PWD" "$process/cwd"\n    printf "%s\\0%s\\0" "$0" "${1:-}" > "$process/cmdline"\n    printf "bun\\n" > "$process/comm"\n    printf "%s (bun) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 424242\\n" "$$" > "$process/stat"\n    printf alive > "$process/alive"\n    if [ -z "${SYNTHETIC_SKIP_LISTENER:-}" ] && [ -z "${SYNTHETIC_PUBLISH_LISTENER_EARLY:-}" ] && [ -n "${SYNTHETIC_LISTENER_PID_FILE:-}" ]; then printf "%s\\n" "$$" > "$SYNTHETIC_LISTENER_PID_FILE"; fi\n  fi\nfi\nexit 0',
  );
  writeExecutable(join(bin, "curl"), "exit 0");
  writeExecutable(
    join(bin, "fuser"),
    'listeners=""; if [ -n "${SYNTHETIC_DEPLOY_LAUNCH_MARKER:-}" ] && [ -f "$SYNTHETIC_DEPLOY_LAUNCH_MARKER" ] && [ -n "${SYNTHETIC_STARTED_LISTENER_PIDS:-}" ]; then listeners="$SYNTHETIC_STARTED_LISTENER_PIDS"; elif [ -n "${SYNTHETIC_LISTENER_PID_FILE:-}" ] && [ -f "$SYNTHETIC_LISTENER_PID_FILE" ]; then listeners=$(cat "$SYNTHETIC_LISTENER_PID_FILE"); fi; for pid in $listeners; do [ ! -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$pid/alive" ] || printf "%s\\n" "$pid"; done',
  );
  writeExecutable(
    join(bin, "ss"),
    'listeners=""; if [ -n "${SYNTHETIC_DEPLOY_LAUNCH_MARKER:-}" ] && [ -f "$SYNTHETIC_DEPLOY_LAUNCH_MARKER" ] && [ -n "${SYNTHETIC_STARTED_LISTENER_PIDS:-}" ]; then listeners="$SYNTHETIC_STARTED_LISTENER_PIDS"; elif [ -n "${SYNTHETIC_LISTENER_PID_FILE:-}" ] && [ -f "$SYNTHETIC_LISTENER_PID_FILE" ]; then listeners=$(cat "$SYNTHETIC_LISTENER_PID_FILE"); fi; for pid in $listeners; do [ ! -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$pid/alive" ] || printf "LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* pid=%s\\n" "$pid"; done',
  );
  writeExecutable(
    join(bin, "pkill"),
    'printf "pkill %s\\n" "$*" >> "$SYNTHETIC_SIGNAL_LOG"',
  );
  writeExecutable(
    join(bin, "process-pgrep"),
    'for pid in ${SYNTHETIC_PROCESS_PIDS:-}; do [ ! -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$pid/alive" ] || printf "%s\\n" "$pid"; done',
  );
  writeExecutable(
    join(bin, "process-lsof"),
    'listeners=${SYNTHETIC_LISTENER_PIDS:-}; if [ -n "${SYNTHETIC_LISTENER_PID_FILE:-}" ] && [ -f "$SYNTHETIC_LISTENER_PID_FILE" ]; then listeners="$listeners $(cat "$SYNTHETIC_LISTENER_PID_FILE")"; fi; for pid in $listeners; do [ ! -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$pid/alive" ] || printf "%s\\n" "$pid"; done | sort -n -u',
  );
  writeExecutable(
    join(bin, "process-kill"),
    'signal=${1:-}; pid=${2:-}; root=$LOCAL_STUDIO_PROCESS_PROC_ROOT; case "$signal" in -0) checks="$root/$pid/checks"; count=0; [ ! -f "$checks" ] || count=$(cat "$checks"); count=$((count + 1)); mkdir -p "$root/$pid"; printf "%s\\n" "$count" > "$checks"; if [ "${SYNTHETIC_DRIFT_PID:-}" = "$pid" ] && [ "$count" -ge "${SYNTHETIC_DRIFT_CHECK:-999}" ]; then printf "%s\\n" "$SYNTHETIC_DRIFT_STAT" > "$root/$pid/stat"; fi; [ -f "$root/$pid/alive" ] ;; -TERM|-KILL) printf "%s %s\\n" "$signal" "$pid" >> "$SYNTHETIC_SIGNAL_LOG"; rm -f "$root/$pid/alive" ;; *) exit 1 ;; esac',
  );
  writeExecutable(join(bin, "setsid"), 'exec "$@"');
  writeExecutable(join(bin, "rsync"), "exit 0");
  writeExecutable(join(bin, "loginctl"), "exit 0");
  writeExecutable(join(bin, "openssl"), 'printf "SYNTHETIC_INSTALL_SECRET\\n"');
  writeExecutable(
    join(bin, "hostname"),
    '[ "${1:-}" = "-I" ] && exit 0\nprintf "synthetic.invalid\\n"',
  );
  writeExecutable(
    join(bin, "systemctl"),
    'printf "%s\\n" "$*" >> "$SYNTHETIC_SYSTEMCTL_LOG"\nunit="$SYNTHETIC_SYSTEMD_UNIT_DIR/${3:-}"\nlocal_unit="$HOME/.config/systemd/user/${3:-}"\n[ -f "$unit" ] || unit="$local_unit"\ncase "${2:-}" in\n  show-environment) exit 0 ;;\n  show)\n    if [ ! -f "$unit" ] || [ -f "$unit.unloaded" ]; then printf "LoadState=not-found\\nMainPID=0\\n"; exit 0; fi\n    working=$(sed -n "s/^WorkingDirectory=//p" "$unit" | tail -1)\n    environment=$(sed -n "s/^EnvironmentFile=//p" "$unit" | tail -1)\n    command=$(sed -n "s/^ExecStart=//p" "$unit" | tail -1)\n    executable=${command%% *}\n    mainpid=0\n    [ ! -f "$unit.mainpid" ] || mainpid=$(cat "$unit.mainpid")\n    printf "LoadState=loaded\\nWorkingDirectory=%s\\nEnvironmentFiles=%s (ignore_errors=no)\\nExecStart={ path=%s ; argv[]=%s ; ignore_errors=no ; }\\nMainPID=%s\\n" "$working" "$environment" "$executable" "$command" "$mainpid" ;;\n  cat) [ -f "$unit" ] || exit 1; cat "$unit" ;;\n  is-active) [ -f "$unit.active" ]; exit $? ;;\n  daemon-reload) [ -z "${SYNTHETIC_DRIFT_UNIT_ON_RELOAD:-}" ] || printf "[Service]\\nWorkingDirectory=/foreign\\nEnvironmentFile=/foreign/.env\\nExecStart=/foreign/bun /foreign/bootstrap.ts\\n" > "$SYNTHETIC_DRIFT_UNIT_ON_RELOAD" ;;\n  restart)\n    pid=${SYNTHETIC_SYSTEMD_PID:-42001}\n    working=$(sed -n "s/^WorkingDirectory=//p" "$unit" | tail -1)\n    command=$(sed -n "s/^ExecStart=//p" "$unit" | tail -1)\n    executable=${command%% *}\n    entrypoint=${command#* }\n    process="$LOCAL_STUDIO_PROCESS_PROC_ROOT/$pid"\n    mkdir -p "$process"\n    ln -sf "$executable" "$process/exe"\n    ln -sf "$working" "$process/cwd"\n    printf "%s\\0%s\\0" "$executable" "$entrypoint" > "$process/cmdline"\n    printf "bun\\n" > "$process/comm"\n    printf "%s (bun) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 424242\\n" "$pid" > "$process/stat"\n    printf alive > "$process/alive"\n    printf "%s\\n" "$pid" > "$unit.mainpid"\n    : > "$unit.active"\n    if [ -n "${SYNTHETIC_LISTENER_PID_FILE:-}" ] && [ -z "${SYNTHETIC_SKIP_LISTENER:-}" ]; then printf "%s\\n" "${SYNTHETIC_SYSTEMD_LISTENER_PID:-$pid}" > "$SYNTHETIC_LISTENER_PID_FILE"; fi ;;\nesac\nexit 0',
  );
  writeExecutable(
    join(bin, "docker"),
    'printf "%s\\n" "$*" >> "$SYNTHETIC_DOCKER_LOG"\nif [ -n "${SYNTHETIC_DRIFT_ON_DOCKER:-}" ]; then : > "$SYNTHETIC_DRIFT_MARKER"; rm -f "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$SYNTHETIC_OWNED_PID/cwd"; ln -s "$SYNTHETIC_FOREIGN_CWD" "$LOCAL_STUDIO_PROCESS_PROC_ROOT/$SYNTHETIC_OWNED_PID/cwd"; fi',
  );
  writeExecutable(
    join(bin, "ssh"),
    'while [ "$#" -gt 0 ]; do\n  [ "$1" != "bash" ] || exec "$@"\n  shift\ndone\nexit 0',
  );
  writeExecutable(join(bin, "daemon-bun"), 'printf invoked > "$SYNTHETIC_DAEMON_MARKER"');
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe("controller script trust boundaries", () => {
  test("non-systemd install never uses pattern-wide process signals", () => {
    const pid = 41001;
    const foreignBun = join(bin, "foreign-bun");
    writeExecutable(foreignBun, "exit 0");
    seedSyntheticProcess(pid, {
      executable: foreignBun,
      cwd: join(install, "controller"),
      arguments: [foreignBun, join(install, "controller", "src", "bootstrap.ts")],
    });
    const processEnvironment = syntheticProcessEnvironment([pid], [], {
      SYNTHETIC_PUBLISH_LISTENER_EARLY: "1",
    });

    const result = runInstaller(install, false, processEnvironment);

    expect(result.exitCode).toBe(0);
    expect(syntheticSignals()).toBe("");
    expect(syntheticProcessAlive(pid)).toBe(true);
  }, 15_000);

  test("non-systemd install replaces only a verified same-install controller", () => {
    const pid = 41002;
    const bun = join(home, ".bun", "bin", "bun");
    seedSyntheticProcess(pid, {
      executable: bun,
      cwd: join(install, "controller"),
      arguments: [bun, "src/bootstrap.ts"],
    });

    const result = runInstaller(
      install,
      false,
      syntheticProcessEnvironment([pid], [pid], {
        SYNTHETIC_PUBLISH_LISTENER_EARLY: "1",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(syntheticSignals()).toBe(`-TERM ${pid}\n`);
    expect(syntheticProcessAlive(pid)).toBe(false);
  }, 15_000);

  test("non-systemd install refuses process identity drift before signaling", () => {
    const pid = 41003;
    const bun = join(home, ".bun", "bin", "bun");
    seedSyntheticProcess(pid, {
      executable: bun,
      cwd: join(install, "controller"),
      arguments: [bun, "src/bootstrap.ts"],
    });
    const environment = syntheticProcessEnvironment([pid], [pid], {
      SYNTHETIC_DRIFT_PID: String(pid),
      SYNTHETIC_DRIFT_CHECK: "3",
      SYNTHETIC_DRIFT_STAT: syntheticProcessStat(pid, "989898").trim(),
    });

    const result = runInstaller(install, false, environment);

    expect(result.exitCode).toBe(1);
    expect(syntheticSignals()).toBe("");
    expect(syntheticProcessAlive(pid)).toBe(true);
  }, 15_000);

  test("daemon refuses a stale PID reused by a foreign process", () => {
    const pid = 41004;
    const bun = join(bin, "daemon-bun");
    const foreignDirectory = join(fixture, "foreign-process");
    mkdirSync(foreignDirectory);
    seedSyntheticProcess(pid, {
      executable: bun,
      cwd: foreignDirectory,
      arguments: [bun, join(REPOSITORY_ROOT, "controller", "src", "bootstrap.ts")],
    });
    writeFileSync(join(fixture, "daemon.pid"), `${pid}\n`);

    const result = runDaemon(
      DAEMON,
      "stop",
      syntheticProcessEnvironment([pid], [pid]),
    );

    expect(result.exitCode).toBe(1);
    expect(syntheticSignals()).toBe("");
    expect(syntheticProcessAlive(pid)).toBe(true);
  });

  test("daemon stops a verified same-install controller", () => {
    const pid = 41005;
    const bun = join(bin, "daemon-bun");
    seedSyntheticProcess(pid, {
      executable: bun,
      cwd: join(REPOSITORY_ROOT, "controller"),
      arguments: [bun, "src/bootstrap.ts"],
    });
    writeFileSync(join(fixture, "daemon.pid"), `${pid}|424242\n`);

    const result = runDaemon(
      DAEMON,
      "stop",
      syntheticProcessEnvironment([pid], [pid]),
    );

    expect(result.exitCode).toBe(0);
    expect(syntheticSignals()).toBe(`-TERM ${pid}\n`);
    expect(syntheticProcessAlive(pid)).toBe(false);
    expect(existsSync(join(fixture, "daemon.pid"))).toBe(false);
  });

  test("daemon refuses an exact process whose stored start identity is stale", () => {
    const pid = 41006;
    const bun = join(bin, "daemon-bun");
    seedSyntheticProcess(pid, {
      executable: bun,
      cwd: join(REPOSITORY_ROOT, "controller"),
      arguments: [bun, "src/bootstrap.ts"],
      startIdentity: "515151",
    });
    writeFileSync(join(fixture, "daemon.pid"), `${pid}|424242\n`);

    const result = runDaemon(
      DAEMON,
      "stop",
      syntheticProcessEnvironment([pid], [pid]),
    );

    expect(result.exitCode).toBe(1);
    expect(syntheticSignals()).toBe("");
    expect(syntheticProcessAlive(pid)).toBe(true);
  });

  test("daemon stores the verified start identity of a launched controller", () => {
    writeSyntheticDaemonLauncher(
      'printf "%s\\n" "$pid" > "$SYNTHETIC_LISTENER_PID_FILE"',
    );

    const result = runDaemon(DAEMON, "start", syntheticProcessEnvironment([]));
    const record = readFileSync(join(fixture, "daemon.pid"), "utf8").trim();

    expect(result.exitCode).toBe(0);
    expect(record).toMatch(/^[0-9]+\|424242$/);
    expect(existsSync(join(fixture, "daemon-invoked"))).toBe(true);
    expect(syntheticSignals()).toBe("");
  }, 15_000);

  test("daemon refuses to persist a launched process without a listener", () => {
    writeSyntheticDaemonLauncher(":");

    const result = runDaemon(DAEMON, "start", syntheticProcessEnvironment([]));

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain("exact listener");
    expect(existsSync(join(fixture, "daemon.pid"))).toBe(false);
    expect(syntheticSignals()).toMatch(/^-TERM [0-9]+\n$/);
  }, 30_000);

  test("daemon rejects multiple listeners and preserves the foreign process", () => {
    const foreignPid = 41008;
    const foreignBun = join(bin, "foreign-bun");
    writeExecutable(foreignBun, "exit 0");
    seedSyntheticProcess(foreignPid, {
      executable: foreignBun,
      cwd: join(fixture, "foreign-process"),
      arguments: [foreignBun, "foreign.ts"],
    });
    writeSyntheticDaemonLauncher(
      'printf "%s %s\\n" "$pid" "$SYNTHETIC_FOREIGN_PID" > "$SYNTHETIC_LISTENER_PID_FILE"',
    );

    const result = runDaemon(
      DAEMON,
      "start",
      syntheticProcessEnvironment([foreignPid], [], {
        SYNTHETIC_FOREIGN_PID: String(foreignPid),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(existsSync(join(fixture, "daemon.pid"))).toBe(false);
    expect(syntheticProcessAlive(foreignPid)).toBe(true);
    expect(syntheticSignals()).not.toContain(String(foreignPid));
  }, 15_000);

  test("daemon verifies Darwin process metadata through ps and lsof", () => {
    const pid = 41007;
    const { alive, environment } = darwinProcessEnvironment(pid, [pid]);

    const result = runDaemon(DAEMON, "stop", environment);

    expect(result.exitCode).toBe(0);
    expect(syntheticSignals()).toBe(`-TERM ${pid}\n`);
    expect(existsSync(alive)).toBe(false);
  }, 15_000);

  test("daemon rejects a Darwin process record without an exact listener", () => {
    const pid = 41009;
    const { alive, environment } = darwinProcessEnvironment(pid, []);

    const result = runDaemon(DAEMON, "stop", environment);

    expect(result.exitCode).toBe(1);
    expect(syntheticSignals()).toBe("");
    expect(existsSync(alive)).toBe(true);
  }, 15_000);

  test("rejects writable runtime, source, and ancestor inputs before execution", () => {
    chmodSync(join(home, ".bun", "bin", "bun"), 0o777);
    expect(runInstaller().exitCode).toBe(1);
    chmodSync(join(home, ".bun", "bin", "bun"), 0o755);

    chmodSync(join(install, "controller", "src"), 0o777);
    expect(runInstaller().exitCode).toBe(1);
    chmodSync(join(install, "controller", "src"), 0o755);

    chmodSync(join(install, "controller", "package.json"), 0o666);
    expect(runInstaller().exitCode).toBe(1);

    const writableAncestor = join(fixture, "writable-ancestor");
    const nestedInstall = join(writableAncestor, "install");
    mkdirSync(writableAncestor, { mode: 0o777 });
    chmodSync(writableAncestor, 0o777);
    seedInstall(nestedInstall);
    expect(runInstaller(nestedInstall).exitCode).toBe(1);
  });

  test("daemon and deploy reject writable controller sources before launch", () => {
    const daemonRoot = join(fixture, "daemon-root");
    const daemonScript = join(daemonRoot, "scripts", "daemon.sh");
    mkdirSync(join(daemonRoot, "scripts"), { recursive: true });
    mkdirSync(join(daemonRoot, "controller", "src"), { recursive: true });
    copyFileSync(DAEMON, daemonScript);
    writeFileSync(join(daemonRoot, "controller", "src", "bootstrap.ts"), 'import "./imported";\n');
    writeFileSync(join(daemonRoot, "controller", "src", "imported.ts"), "export {};\n");
    chmodSync(join(daemonRoot, "controller", "src"), 0o777);

    const daemon = runDaemon(daemonScript);
    expect(daemon.exitCode).toBe(1);
    expect(daemon.stderr?.toString() ?? "").toContain("Unsafe writable controller source");
    expect(existsSync(join(fixture, "daemon-invoked"))).toBe(false);

    chmodSync(join(install, "controller", "src", "bootstrap.ts"), 0o666);
    const deploy = runDeploy();
    expect(deploy.exitCode).toBe(1);
    expect(deploy.stderr?.toString() ?? "").toContain("Unsafe writable controller source");
    expect(existsSync(join(fixture, "deploy-invoked"))).toBe(false);
  });

  test("rejects a writable imported source before every Bun boundary", () => {
    chmodSync(join(install, "controller", "src", "imported.ts"), 0o666);
    expect(runInstaller().exitCode).toBe(1);

    const daemonRoot = join(fixture, "daemon-import-root");
    const daemonScript = join(daemonRoot, "scripts", "daemon.sh");
    mkdirSync(join(daemonRoot, "scripts"), { recursive: true });
    seedInstall(daemonRoot);
    copyFileSync(DAEMON, daemonScript);
    chmodSync(join(daemonRoot, "controller", "src", "imported.ts"), 0o666);
    expect(runDaemon(daemonScript).exitCode).toBe(1);
    expect(existsSync(join(fixture, "daemon-invoked"))).toBe(false);

    const deploy = runDeploy();
    expect(deploy.exitCode).toBe(1);
    expect(existsSync(join(fixture, "deploy-invoked"))).toBe(false);
  });

  test("revalidates the complete runtime after dependency installation", () => {
    const imported = join(install, "controller", "src", "imported.ts");
    const installer = runInstaller(install, false, {
      SYNTHETIC_MUTATE_SOURCE: imported,
    });
    expect(installer.exitCode).toBe(1);

    chmodSync(imported, 0o644);
    const deploy = runDeploy({ SYNTHETIC_MUTATE_SOURCE: imported });
    expect(deploy.exitCode).toBe(1);
    expect(existsSync(join(fixture, "deploy-invoked"))).toBe(true);
  }, 15_000);

  test("validates the remote Bun ancestry before its first invocation", () => {
    chmodSync(join(home, ".bun", "bin"), 0o777);

    const deploy = runDeploy();

    expect(deploy.exitCode).toBe(1);
    expect(existsSync(join(fixture, "deploy-invoked"))).toBe(false);
  });

  test("migrates only same-install legacy services and preserves a foreign port unit", () => {
    writeUnit("vllm-studio-controller-b70.service", install);
    writeUnit("vllm-studio-controller.service", install, true);
    writeUnit("local-studio-controller-8080.service", join(fixture, "foreign"), true);

    const result = runInstaller(install, true);
    const serviceRoot = join(home, ".config", "systemd", "user");

    expect(result.exitCode).toBe(0);
    expect(
      existsSync(join(serviceRoot, "vllm-studio-controller.service.d", "10-private-output.conf")),
    ).toBe(true);
    expect(existsSync(join(serviceRoot, "local-studio-controller-8080.service.d"))).toBe(false);
    expect(readFileSync(systemctlLog, "utf8")).not.toContain(
      "restart local-studio-controller-8080.service",
    );
  }, 15_000);

  test("refuses to overwrite a foreign unit for the requested port", () => {
    const service = "local-studio-controller-18081.service";
    writeUnit(service, join(fixture, "foreign"), true);

    const result = runInstaller(install, true);

    expect(result.exitCode).toBe(1);
    expect(existsSync(join(home, ".config", "systemd", "user", service))).toBe(false);
    expect(readFileSync(join(units, service), "utf8")).toContain(
      `WorkingDirectory=${join(fixture, "foreign")}`,
    );
  }, 15_000);

  test("deploy preserves a foreign exact-port listener and never launches Bun", async () => {
    await withForeignListener((pid, launchMarker) => {
      writeUnit("local-studio-controller-8080.service", join(fixture, "foreign"), true);
      const result = runDeploy({
        SYNTHETIC_FOREIGN_PID: String(pid),
        SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr?.toString() ?? "").toContain("Refusing foreign controller unit");
      expect(processIsAlive(pid)).toBe(true);
      expectNoControllerMutation(launchMarker);
    });
  }, 15_000);

  test("rejects adversarial effective systemd properties before mutation", () => {
    const launchMarker = join(fixture, "adversarial-launch");
    writeEffectiveUnit("local-studio-controller-8080.service", {
      workingDirectory: install,
      environmentFile: `${install}/.env.evil`,
      executable: join(fixture, "foreign-wrapper"),
      entrypoint: `--decoy=${install}/controller/src/bootstrap.ts`,
      active: true,
    });

    const result = runDeploy({ SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker });

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain("Refusing foreign controller unit");
    expectNoControllerMutation(launchMarker);
  }, 15_000);

  test("installer rejects a trusted base overridden by foreign effective properties", () => {
    const service = "local-studio-controller-18081.service";
    const bun = join(home, ".bun", "bin", "bun");
    writeFileSync(
      join(units, service),
      [
        `[Service]`,
        `WorkingDirectory=${install}`,
        `EnvironmentFile=${install}/.env`,
        `ExecStart=${bun} ${install}/controller/src/main.ts`,
        `WorkingDirectory=${install}`,
        `EnvironmentFile=${install}/.env.evil`,
        `ExecStart=${join(fixture, "foreign-wrapper")} --decoy=${install}/controller/src/bootstrap.ts`,
        "",
      ].join("\n"),
    );

    const result = runInstaller(install, true);

    expect(result.exitCode).toBe(1);
    expect(result.stdout?.toString() ?? "").toContain("refusing foreign controller unit");
    expect(mutationLog()).not.toContain("daemon-reload");
  }, 15_000);

  test("installer revalidates migrated services after daemon reload", () => {
    const service = "vllm-studio-controller.service";
    const unit = join(units, service);
    writeUnit(service, install);

    const result = runInstaller(install, true, {
      SYNTHETIC_DRIFT_UNIT_ON_RELOAD: unit,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout?.toString() ?? "").toContain("refusing changed controller unit");
    expect(readFileSync(systemctlLog, "utf8")).not.toContain(`disable --now ${service}`);
  }, 15_000);
});

describe("controller listener ownership", () => {

  test("installer rejects a foreign systemd listener before trusting a healthy endpoint", () => {
    const foreignPid = 41010;
    const healthMarker = join(fixture, "installer-health-requested");
    const foreignBun = join(bin, "foreign-systemd-bun");
    writeExecutable(foreignBun, "exit 0");
    seedSyntheticProcess(foreignPid, {
      executable: foreignBun,
      cwd: join(fixture, "foreign-systemd"),
      arguments: [foreignBun, "foreign.ts"],
    });
    writeExecutable(join(bin, "curl"), `printf requested > "${healthMarker}"; exit 0`);

    const result = runInstaller(
      install,
      true,
      syntheticProcessEnvironment([foreignPid], [], {
        SYNTHETIC_SYSTEMD_LISTENER_PID: String(foreignPid),
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout?.toString() ?? "").toContain("unverified systemd controller");
    expect(result.stdout?.toString() ?? "").not.toContain("LOCAL_STUDIO_CONTROLLER {");
    expect(existsSync(healthMarker)).toBe(false);
    expect(syntheticProcessAlive(foreignPid)).toBe(true);
    expect(syntheticSignals()).toBe("");
  }, 15_000);

  test("deploy verifies an active systemd MainPID before healthy success", () => {
    writeEffectiveUnit("local-studio-controller-8080.service", {
      workingDirectory: join(install, "controller"),
      environmentFile: `${install}/.env`,
      executable: join(home, ".bun", "bin", "bun"),
      entrypoint: join(install, "controller", "src", "bootstrap.ts"),
      active: true,
    });

    const result = runDeploy();

    expect(result.exitCode).toBe(0);
    expect(result.stdout?.toString() ?? "").toContain("controller :8080 verified");
    expect(readFileSync(systemctlLog, "utf8")).toContain(
      "show local-studio-controller-8080.service --property=MainPID",
    );
  }, 15_000);

  test("deploy rejects a foreign systemd listener even when health would return 200", () => {
    const foreignPid = 41011;
    const healthMarker = join(fixture, "deploy-health-requested");
    const foreignBun = join(bin, "foreign-deploy-bun");
    writeExecutable(foreignBun, "exit 0");
    seedSyntheticProcess(foreignPid, {
      executable: foreignBun,
      cwd: join(fixture, "foreign-deploy"),
      arguments: [foreignBun, "foreign.ts"],
    });
    writeEffectiveUnit("local-studio-controller-8080.service", {
      workingDirectory: join(install, "controller"),
      environmentFile: `${install}/.env`,
      executable: join(home, ".bun", "bin", "bun"),
      entrypoint: join(install, "controller", "src", "bootstrap.ts"),
      active: true,
    });
    writeExecutable(join(bin, "curl"), `printf requested > "${healthMarker}"; exit 0`);

    const result = runDeploy(
      syntheticProcessEnvironment([foreignPid], [], {
        SYNTHETIC_SYSTEMD_LISTENER_PID: String(foreignPid),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain("unverified systemd controller");
    expect(existsSync(healthMarker)).toBe(false);
    expect(syntheticProcessAlive(foreignPid)).toBe(true);
    expect(syntheticSignals()).toBe("");
  }, 15_000);

  test("deploy rejects a foreign listener that wins the post-preflight bind race", () => {
    const foreignPid = 41012;
    const foreignBun = join(bin, "foreign-race-bun");
    const launchMarker = join(fixture, "race-launch");
    writeExecutable(foreignBun, "exit 0");
    seedSyntheticProcess(foreignPid, {
      executable: foreignBun,
      cwd: join(fixture, "foreign-race"),
      arguments: [foreignBun, "foreign.ts"],
    });

    const result = runDeploy(
      syntheticProcessEnvironment([foreignPid], [], {
        SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
        SYNTHETIC_STARTED_LISTENER_PIDS: String(foreignPid),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain("unverified nohup controller");
    expect(existsSync(launchMarker)).toBe(true);
    expect(syntheticProcessAlive(foreignPid)).toBe(true);
    expect(syntheticSignals()).toBe("");
  }, 15_000);

  test("deploy rejects a launched process that never owns a listener", () => {
    const result = runDeploy({ SYNTHETIC_SKIP_LISTENER: "1" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain("unverified nohup controller");
  }, 30_000);

  test("treats an unloaded but present exact-port unit as foreign", () => {
    const launchMarker = join(fixture, "unloaded-launch");
    writeEffectiveUnit("local-studio-controller-8080.service", {
      workingDirectory: install,
      environmentFile: `${install}/.env`,
      executable: join(home, ".bun", "bin", "bun"),
      entrypoint: `${install}/controller/src/bootstrap.ts`,
      unloaded: true,
    });

    const result = runDeploy({ SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker });

    expect(result.exitCode).toBe(1);
    expect(result.stderr?.toString() ?? "").toContain("Refusing foreign controller unit");
    expectNoControllerMutation(launchMarker);
  }, 15_000);

  test("ignores inactive foreign legacy units but rejects active ones before mutation", () => {
    const service = "vllm-studio-controller.service";
    const launchMarker = join(fixture, "inactive-legacy-launch");
    writeEffectiveUnit(service, {
      workingDirectory: join(fixture, "foreign"),
      environmentFile: `${join(fixture, "foreign")}/.env`,
      executable: join(fixture, "foreign-bun"),
      entrypoint: join(fixture, "foreign.ts"),
    });

    const inactive = runDeploy({ SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker });
    expect(inactive.exitCode).toBe(0);
    expect(existsSync(launchMarker)).toBe(true);

    rmSync(launchMarker, { force: true });
    writeFileSync(join(units, `${service}.active`), "active\n");
    writeFileSync(systemctlLog, "");
    writeFileSync(dockerLog, "");
    const active = runDeploy({ SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker });
    expect(active.exitCode).toBe(1);
    expect(active.stderr?.toString() ?? "").toContain("Refusing foreign controller unit");
    expectNoControllerMutation(launchMarker);
  }, 20_000);

  test("re-samples a listener published between ownership probes", () => {
    const launchMarker = join(fixture, "probe-race-launch");
    const identityMarker = join(fixture, "probe-race-identity");
    const sampleMarker = join(fixture, "probe-race-sample");
    const realFuser = join(bin, "real-fuser");
    copyFileSync(join(bin, "fuser"), realFuser);
    chmodSync(realFuser, 0o755);
    writeExecutable(
      join(bin, "cat"),
      'path=${1:-}; case "$path" in "$LOCAL_STUDIO_PROCESS_PROC_ROOT"/*/comm) if [ -f "$SYNTHETIC_DEPLOY_LAUNCH_MARKER" ] && [ ! -f "$SYNTHETIC_IDENTITY_MISS_MARKER" ]; then : > "$SYNTHETIC_IDENTITY_MISS_MARKER"; exit 0; fi ;; esac; exec /bin/cat "$@"',
    );
    writeExecutable(
      join(bin, "fuser"),
      'if [ -f "$SYNTHETIC_DEPLOY_LAUNCH_MARKER" ] && [ ! -f "$SYNTHETIC_HIDE_FIRST_LISTENER_SAMPLE" ]; then for _ in $(seq 1 100); do if [ -f "$SYNTHETIC_LISTENER_PID_FILE" ]; then : > "$SYNTHETIC_HIDE_FIRST_LISTENER_SAMPLE"; exit 0; fi; sleep 0.01; done; fi; exec "$SYNTHETIC_REAL_FUSER" "$@"',
    );

    const result = runDeploy({
      SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
      SYNTHETIC_HIDE_FIRST_LISTENER_SAMPLE: sampleMarker,
      SYNTHETIC_IDENTITY_MISS_MARKER: identityMarker,
      SYNTHETIC_REAL_FUSER: realFuser,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(identityMarker)).toBe(true);
    expect(existsSync(sampleMarker)).toBe(true);
    expect(existsSync(launchMarker)).toBe(true);
  }, 20_000);

  test("deploy refuses an unmanaged listener without signaling it", async () => {
    await withForeignListener((pid, launchMarker) => {
      const result = runDeploy({
        SYNTHETIC_FOREIGN_PID: String(pid),
        SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr?.toString() ?? "").toContain("Refusing unowned listener");
      expect(processIsAlive(pid)).toBe(true);
      expectNoControllerMutation(launchMarker);
    });
  }, 15_000);

  test("recognizes and replaces a detached controller launched from the controller directory", async () => {
    await withOwnedControllerProcess((pid, launchMarker, driftMarker, processMarker) => {
      const result = runDeploy({
        SYNTHETIC_OWNED_PID: String(pid),
        SYNTHETIC_CONTROLLER_DIR: join(install, "controller"),
        SYNTHETIC_BUN_PATH: join(home, ".bun", "bin", "bun"),
        SYNTHETIC_FOREIGN_CWD: join(fixture, "foreign"),
        SYNTHETIC_DRIFT_MARKER: driftMarker,
        SYNTHETIC_PROCESS_MARKER: processMarker,
        SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(processMarker)).toBe(false);
      expect(existsSync(launchMarker)).toBe(true);
    });
  }, 20_000);

  test("refuses a controller process whose cwd drifts before signaling", async () => {
    await withOwnedControllerProcess((pid, launchMarker, driftMarker, processMarker) => {
      const result = runDeploy({
        SYNTHETIC_OWNED_PID: String(pid),
        SYNTHETIC_CONTROLLER_DIR: join(install, "controller"),
        SYNTHETIC_BUN_PATH: join(home, ".bun", "bin", "bun"),
        SYNTHETIC_FOREIGN_CWD: join(fixture, "foreign"),
        SYNTHETIC_DRIFT_MARKER: driftMarker,
        SYNTHETIC_PROCESS_MARKER: processMarker,
        SYNTHETIC_DRIFT_ON_DOCKER: "1",
        SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
      });

      expect(result.exitCode).toBe(1);
      expect(existsSync(processMarker)).toBe(true);
      expect(existsSync(launchMarker)).toBe(false);
    });
  }, 20_000);

  test("refuses a fuser-only foreign listener before mutation", async () => {
    await withForeignListener((pid, launchMarker) => {
      const result = runDeploy({
        SYNTHETIC_FOREIGN_PID: String(pid),
        SYNTHETIC_DEPLOY_LAUNCH_MARKER: launchMarker,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr?.toString() ?? "").toContain("Refusing unowned listener");
      expect(processIsAlive(pid)).toBe(true);
      expectNoControllerMutation(launchMarker);
    }, false);
  }, 15_000);
});
