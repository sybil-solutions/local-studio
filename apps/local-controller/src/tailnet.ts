import { randomBytes } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalTailnet } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, decodeJson, exec, fail, fetchJson, lastLine } from "./core.ts";
import { normUrl } from "./graph.ts";

const Peer = Schema.Struct({ HostName: Schema.String, OS: Schema.String, Online: Schema.Boolean, TailscaleIPs: Schema.Array(Schema.String) });
const Status = Schema.Struct({ Peer: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Peer))) });
const decodeHealth = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String, name: Schema.String }));

export const scanTailnet = (linked: Set<string>): Effect.Effect<LocalTailnet> =>
  Effect.gen(function* () {
    let status: typeof Status.Type | undefined;
    for (const bin of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
      if (status) break;
      const r = yield* exec([bin, "status", "--json"], 5_000);
      status = r.code === 0 ? decodeJson(Status, r.stdout) : undefined;
    }
    if (!status) return { available: false, devices: [] };
    const peers = Object.values(status.Peer ?? {}).filter((p) => p.Online && p.TailscaleIPs[0]);
    const devices = yield* Effect.forEach(
      peers,
      (p) =>
        Effect.gen(function* () {
          const ip = p.TailscaleIPs.find((a) => !a.includes(":")) ?? p.TailscaleIPs[0] ?? "";
          const url = `http://${ip}:18091`;
          const res = yield* Effect.option(fetchJson(`${url}/api/health`, 1_500));
          const health = res._tag === "Some" && res.value.status === 200 ? decodeHealth(res.value.body) : null;
          return { name: p.HostName, ip, os: p.OS, controller: health?._tag === "Some" ? { ...health.value, url } : null, linked: linked.has(normUrl(url)) };
        }),
      { concurrency: 16 },
    );
    return { available: true, devices: devices.sort((a, b) => a.name.localeCompare(b.name)) };
  });

const RELEASE = process.env.LOCAL_STUDIO_CONTROLLER_RELEASE ?? "https://github.com/sybil-solutions/local-studio/releases/latest/download";
const quote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
const SCRIPT = `set -e
case "$(uname -s)-$(uname -m)" in Linux-x86_64) T=linux-x64;; Linux-aarch64|Linux-arm64) T=linux-arm64;; Darwin-arm64) T=darwin-arm64;; Darwin-x86_64) T=darwin-x64;; *) echo "unsupported $(uname -sm)" >&2; exit 2;; esac
D="$HOME/.local-studio-t3"; B="$HOME/.local/bin/local-studio-controller"
if [ -e "$D/config.json" ] || curl -s -m 2 -o /dev/null "http://$HOST:18091/api/health"; then echo "a controller is already set up on this machine; connect it instead" >&2; exit 3; fi
mkdir -p "$D" "$HOME/.local/bin" && chmod 700 "$D"
curl -fsSL "$RELEASE/local-studio-controller-$T" -o "$B.tmp" && chmod 755 "$B.tmp" && mv "$B.tmp" "$B"
umask 077 && printf '%s\\n' "$CFG" > "$D/config.json"
if [ "$(uname -s)" = Linux ]; then
  mkdir -p "$HOME/.config/systemd/user"
  printf '[Unit]\\nDescription=Local Studio controller\\n[Service]\\nEnvironment=LOCAL_STUDIO_T3_HOST=%s\\nExecStart=%s\\nRestart=always\\n[Install]\\nWantedBy=default.target\\n' "$HOST" "$B" > "$HOME/.config/systemd/user/local-studio-controller.service"
  loginctl enable-linger "$(id -un)" 2>/dev/null || true
  export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if systemctl --user daemon-reload 2>/dev/null; then systemctl --user enable local-studio-controller && systemctl --user restart local-studio-controller
  else pkill -f "$B" 2>/dev/null || true; LOCAL_STUDIO_T3_HOST="$HOST" setsid nohup "$B" > "$D/controller.log" 2>&1 < /dev/null & fi
else
  P="$HOME/Library/LaunchAgents/ai.localstudio.controller.plist" && mkdir -p "$(dirname "$P")"
  printf '<?xml version="1.0" encoding="UTF-8"?>\\n<plist version="1.0"><dict><key>Label</key><string>ai.localstudio.controller</string><key>ProgramArguments</key><array><string>%s</string></array><key>EnvironmentVariables</key><dict><key>LOCAL_STUDIO_T3_HOST</key><string>%s</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\\n' "$B" "$HOST" > "$P"
  launchctl bootout "gui/$(id -u)/ai.localstudio.controller" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$P" || launchctl bootstrap "user/$(id -u)" "$P"
fi`;

export const deployController = (config: Config, req: { ip: string; name: string; user?: string }) =>
  Effect.gen(function* () {
    if (!/^[\d.]+$/.test(req.ip) || !/^[\w.-]*$/.test(req.user ?? "")) return yield* fail(400, "BAD_TARGET", "deploy needs a tailnet IPv4 and a plain user name");
    const url = `http://${req.ip}:18091`;
    const name = req.name.replace(/[^\w.-]/g, "-") || req.ip;
    const cfg = JSON.stringify({ id: `${name}-${randomBytes(3).toString("hex")}`, name, url, fleetKey: config.fleetKey, peers: [] });
    const env = Object.entries({ RELEASE, CFG: cfg, HOST: req.ip }).map(([k, v]) => `${k}=${quote(v)}`).join("\n");
    const target = req.user ? `${req.user}@${req.ip}` : req.ip;
    const r = yield* exec(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", target, "sh -s"], 180_000, { stdin: `${env}\n${SCRIPT}\n` });
    if (r.code !== 0) return yield* fail(502, "DEPLOY_FAILED", `${target}: ${lastLine(r)}`);
    for (let i = 0; i < 20; i++) {
      const h = yield* Effect.option(fetchJson(`${url}/api/health`, 1_500));
      if (h._tag === "Some" && h.value.status === 200) return url;
      yield* Effect.sleep("1 second");
    }
    return yield* fail(504, "DEPLOY_TIMEOUT", `installed on ${target} but nothing answers at ${url}`);
  });
