import { DeployError, shq, type Probe, type Remote } from "./ssh";

export type Runner = "tmux" | "nohup" | "systemd" | "launchd";

export interface Layout {
  dir: string;
  port: number;
  host: string;
  name: string | null;
  readOnly: boolean;
}

export interface RemoteHealth {
  service?: string;
  version?: string;
  readOnly?: boolean;
  name?: string;
}

export const session = (port: number) => `local-studio-${port}`;
export const TMUX = "tmux -L local-studio -f /dev/null";
const unit = (port: number) => `local-studio-${port}.service`;
const agent = (port: number) => `org.localstudio.controller.${port}`;

export const probeHost = (host: string) => (host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host);

const healthUrl = (l: Layout) => `http://${probeHost(l.host)}:${l.port}/health`;

export const health = async (r: Remote, l: Layout): Promise<RemoteHealth | null> => {
  const res = await r.run(`curl -s --max-time 2 ${shq(healthUrl(l))}`, 15_000);
  if (res.code !== 0 || !res.stdout.trim()) return null;
  try {
    return JSON.parse(res.stdout) as RemoteHealth;
  } catch {
    return {};
  }
};

export const portBusy = async (r: Remote, p: Probe, port: number): Promise<boolean> => {
  const cmd = p.tools.has("ss")
    ? `ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq '[:.]${port}$'`
    : p.tools.has("lsof")
      ? `lsof -nP -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1`
      : "false";
  const res = await r.run(cmd, 15_000);
  return res.code === 0;
};

export const pollHealth = async (r: Remote, l: Layout, tries = 30): Promise<RemoteHealth | null> => {
  for (let i = 0; i < tries; i++) {
    const h = await health(r, l);
    if (h?.service === "local-studio") return h;
    await Bun.sleep(1000);
  }
  return null;
};

const envFile = (l: Layout): string =>
  [
    `LOCAL_STUDIO_HOST=${shq(l.host)}`,
    `LOCAL_STUDIO_PORT=${l.port}`,
    `LOCAL_STUDIO_HOME=${shq(`${l.dir}/home`)}`,
    `LOCAL_STUDIO_READ_ONLY=${l.readOnly ? 1 : 0}`,
    ...(l.name ? [`LOCAL_STUDIO_NAME=${shq(l.name)}`] : []),
    "",
  ].join("\n");

const startScript = (l: Layout): string =>
  [
    "#!/bin/sh",
    "set -a",
    `. ${shq(`${l.dir}/env`)}`,
    "set +a",
    `exec ${shq(`${l.dir}/local-studio`)} serve >>${shq(`${l.dir}/controller.log`)} 2>&1`,
    "",
  ].join("\n");

const heredoc = (path: string, body: string, mode: string) =>
  `umask 077\ncat > ${shq(path)} <<'LOCAL_STUDIO_EOF'\n${body}LOCAL_STUDIO_EOF\nchmod ${mode} ${shq(path)}`;

export const install = async (r: Remote, l: Layout, tarballName: string): Promise<void> => {
  const d = shq(l.dir);
  const stage = shq(`${l.dir}/.stage`);
  await r.must(
    [
      "set -e",
      `mkdir -p ${stage}`,
      `tar -xzf ${shq(`${l.dir}/${tarballName}`)} -C ${stage}`,
      `chmod 0755 ${stage}/local-studio`,
      `mv -f ${stage}/local-studio ${d}/local-studio`,
      `if [ -d ${d}/ui ]; then mv ${d}/ui ${d}/.ui-old; fi`,
      `mv ${stage}/ui ${d}/ui`,
      `rm -rf ${d}/.ui-old ${stage} ${shq(`${l.dir}/${tarballName}`)}`,
      heredoc(`${l.dir}/env`, envFile(l), "0600"),
      heredoc(`${l.dir}/start.sh`, startScript(l), "0700"),
      `mkdir -p ${shq(`${l.dir}/home`)} && chmod 0700 ${shq(`${l.dir}/home`)}`,
    ].join("\n"),
    "install",
    120_000,
  );
};

const systemdUnit = (l: Layout) =>
  [
    "[Unit]",
    `Description=Local Studio controller on port ${l.port}`,
    "After=network-online.target",
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    `ExecStart="${l.dir}/start.sh"`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

const launchdPlist = (l: Layout) =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0"><dict>`,
    `<key>Label</key><string>${agent(l.port)}</string>`,
    `<key>ProgramArguments</key><array><string>${l.dir}/start.sh</string></array>`,
    `<key>RunAtLoad</key><true/>`,
    `<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>`,
    `</dict></plist>`,
    "",
  ].join("\n");

export const pickRunner = (p: Probe, service: boolean): Runner => {
  if (service) {
    if (p.os === "linux" && p.tools.has("systemctl")) return "systemd";
    if (p.os === "darwin" && p.tools.has("launchctl")) return "launchd";
    throw new DeployError("--service needs systemd (Linux) or launchd (macOS) on the target");
  }
  return p.tools.has("tmux") ? "tmux" : "nohup";
};

export const start = async (r: Remote, p: Probe, l: Layout, runner: Runner): Promise<string | null> => {
  const script = shq(`${l.dir}/start.sh`);
  const pidfile = shq(`${l.dir}/controller.pid`);
  switch (runner) {
    case "tmux":
      await r.must(`${TMUX} new-session -d -s ${session(l.port)} ${script}`, "tmux start");
      return null;
    case "nohup": {
      const detach = p.tools.has("setsid") ? "setsid nohup" : "nohup";
      await r.must(`${detach} ${script} </dev/null >/dev/null 2>&1 &\necho $! > ${pidfile}`, "nohup start");
      return null;
    }
    case "systemd": {
      const out = await r.must(
        [
          "set -e",
          `mkdir -p "$HOME/.config/systemd/user"`,
          heredoc(`$HOME/.config/systemd/user/${unit(l.port)}`.replace("$HOME", p.home), systemdUnit(l), "0644"),
          "systemctl --user daemon-reload",
          `systemctl --user enable --now ${unit(l.port)}`,
          `u=$(id -un); [ "$(loginctl show-user "$u" -p Linger --value 2>/dev/null)" = yes ] || loginctl enable-linger "$u" 2>/dev/null || true`,
          `echo "linger=$(loginctl show-user "$u" -p Linger --value 2>/dev/null)"`,
        ].join("\n"),
        "systemd start",
        60_000,
      );
      return /linger=yes/.test(out) ? null : `linger is off for this user, so ${unit(l.port)} stops at logout and does not start after reboot; run: sudo loginctl enable-linger $(id -un)`;
    }
    case "launchd": {
      const plist = `${p.home}/Library/LaunchAgents/${agent(l.port)}.plist`;
      await r.must(
        ["set -e", `mkdir -p "$HOME/Library/LaunchAgents"`, heredoc(plist, launchdPlist(l), "0644"), `launchctl bootstrap gui/$(id -u) ${shq(plist)}`].join("\n"),
        "launchd start",
        60_000,
      );
      return null;
    }
  }
};

export interface Owned {
  runner: Runner;
  detail: string;
}

export const findOwned = async (r: Remote, l: Layout): Promise<Owned | null> => {
  const pidfile = shq(`${l.dir}/controller.pid`);
  const res = await r.run(
    [
      `if command -v tmux >/dev/null 2>&1 && ${TMUX} has-session -t =${session(l.port)} 2>/dev/null; then echo "tmux $(${TMUX} list-panes -t =${session(l.port)} -F '#{pane_pid}' | head -n1)"; exit 0; fi`,
      `if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet ${unit(l.port)} 2>/dev/null; then echo "systemd ${unit(l.port)}"; exit 0; fi`,
      `if command -v launchctl >/dev/null 2>&1 && launchctl print gui/$(id -u)/${agent(l.port)} >/dev/null 2>&1; then echo "launchd ${agent(l.port)}"; exit 0; fi`,
      `if [ -f ${pidfile} ] && kill -0 "$(cat ${pidfile})" 2>/dev/null; then echo "nohup $(cat ${pidfile})"; exit 0; fi`,
      "echo none",
    ].join("\n"),
    20_000,
  );
  const [kind, ...rest] = res.stdout.trim().split(/\s+/);
  if (kind === "tmux" || kind === "systemd" || kind === "launchd" || kind === "nohup") return { runner: kind, detail: rest.join(" ") };
  return null;
};

export const stopOwned = async (r: Remote, l: Layout, owned: Owned): Promise<void> => {
  const pidfile = shq(`${l.dir}/controller.pid`);
  switch (owned.runner) {
    case "tmux":
      await r.must(`${TMUX} kill-session -t =${session(l.port)}`, "tmux stop");
      return;
    case "systemd":
      await r.must(`systemctl --user stop ${unit(l.port)}`, "systemd stop", 60_000);
      return;
    case "launchd":
      await r.must(`launchctl bootout gui/$(id -u)/${agent(l.port)}`, "launchd stop", 60_000);
      return;
    case "nohup":
      await r.must(
        [
          `pid=$(cat ${pidfile})`,
          `pkill -TERM -P "$pid" 2>/dev/null || true`,
          `kill -TERM "$pid" 2>/dev/null || true`,
          `rm -f ${pidfile}`,
        ].join("\n"),
        "nohup stop",
      );
      return;
  }
};

export const pollDown = async (r: Remote, l: Layout, tries = 15): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    if (!(await health(r, l))) return true;
    await Bun.sleep(1000);
  }
  return false;
};

export const serverPid = async (r: Remote, l: Layout): Promise<string | null> => {
  const res = await r.run(`pgrep -f ${shq(`${l.dir}/local-studio serve`)} | head -n1`, 15_000);
  return res.stdout.trim() || null;
};
