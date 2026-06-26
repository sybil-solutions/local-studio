import Link from "next/link";
import {
  Boxes,
  CheckCircle2,
  DownloadCloud,
  ExternalLink,
  Gauge,
  GitFork,
  HardDrive,
  Network,
  PlugZap,
  ServerCog,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from "@/ui/icon-registry";
import styles from "./marketing.module.css";

type Screenshot = {
  src: string;
  title: string;
  meta: string;
  alt: string;
};

const screenshots: Screenshot[] = [
  {
    src: "/marketing/screenshots/status-dashboard.png",
    title: "Telemetry",
    meta: "live app capture",
    alt: "Local Studio status dashboard showing controllers, decode metrics, VRAM, power, and GPU rows.",
  },
  {
    src: "/marketing/screenshots/discover-models.png",
    title: "Models",
    meta: "live app capture",
    alt: "Local Studio Discover Models screen showing searchable model rows and download actions.",
  },
  {
    src: "/marketing/screenshots/system-settings.png",
    title: "Runtime",
    meta: "live app capture",
    alt: "Local Studio System settings showing installed inference engines and service topology.",
  },
  {
    src: "/marketing/screenshots/model-library.png",
    title: "Fit",
    meta: "live app capture",
    alt: "Local Studio model library with hardware profile, model results, and downloads.",
  },
  {
    src: "/marketing/screenshots/plugins.png",
    title: "MCP",
    meta: "live app capture",
    alt: "Local Studio Plugins page showing MCP custom server and registry source settings.",
  },
];

const capabilities: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: ServerCog,
    title: "Controllers",
    copy: "Local or remote. Same status, launch, logs, metrics, and proxy surface.",
  },
  {
    icon: HardDrive,
    title: "Models",
    copy: "Find, fit, download, launch, evict. VRAM stays visible.",
  },
  {
    icon: PlugZap,
    title: "Agents",
    copy: "Pi runtime, MCP tools, skills, browser, files, project state.",
  },
];

const downloads = [
  {
    title: "Mac DMG",
    copy: "Apple Silicon desktop build.",
    href: "/api/downloads/mac-dmg",
    meta: ["macOS", "arm64", "DMG"],
  },
  {
    title: "Mac ZIP",
    copy: "Same app, archive format.",
    href: "/api/downloads/mac-zip",
    meta: ["macOS", "arm64", "ZIP"],
  },
  {
    title: "Agents",
    copy: "DLTL for controllers, providers, runtimes, MCP, Pi.",
    href: "/agents",
    meta: ["DLTL", "controllers", "providers"],
  },
];

function MarketingNav() {
  return (
    <header className={styles.nav}>
      <Link href="/download" className={styles.brand} aria-label="Local Studio download page">
        <span className={styles.mark}>LS</span>
        <span>Local Studio</span>
      </Link>
      <nav className={styles.navLinks} aria-label="Marketing navigation">
        <Link href="/download#product">Product</Link>
        <Link href="/download#downloads">Downloads</Link>
        <Link href="/agents">Agents</Link>
        <Link className={styles.navCta} href="/api/downloads/mac-dmg" prefetch={false} download>
          <DownloadCloud size={16} aria-hidden="true" />
          Download
        </Link>
      </nav>
    </header>
  );
}

function ScreenshotFrame({
  screenshot,
  priority = false,
}: {
  screenshot: Screenshot;
  priority?: boolean;
}) {
  return (
    <figure className={styles.frame}>
      <figcaption className={styles.frameHeader}>
        <span>{screenshot.title}</span>
        <span>{screenshot.meta}</span>
      </figcaption>
      <img src={screenshot.src} alt={screenshot.alt} loading={priority ? "eager" : "lazy"} />
    </figure>
  );
}

export function MarketingLandingPage() {
  return (
    <main className={styles.shell}>
      <MarketingNav />

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroImage} aria-hidden="true">
          <img src="/marketing/screenshots/status-dashboard.png" alt="" />
        </div>
        <div className={styles.heroScrim} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroLayout}>
            <div className={styles.heroCopyColumn}>
              <p className={styles.eyebrow}>Local inference control plane</p>
              <h1 id="landing-title" className={styles.heroTitle}>
                Local Studio
              </h1>
              <p className={styles.heroCopy}>
                Controllers, GPUs, models, providers, agents. One operating surface.
              </p>
              <div className={styles.heroActions}>
                <Link
                  className={styles.button}
                  href="/api/downloads/mac-dmg"
                  prefetch={false}
                  download
                >
                  <DownloadCloud size={18} aria-hidden="true" />
                  Download for Mac
                </Link>
                <Link className={styles.ghostButton} href="/agents">
                  <TerminalSquare size={18} aria-hidden="true" />
                  Agent setup
                </Link>
              </div>
            </div>
            <div className={styles.heroPreview}>
              <ScreenshotFrame screenshot={screenshots[0]} priority />
            </div>
          </div>
          <div className={styles.metricStrip} aria-label="Local Studio product scope">
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Serve</span>
              <span className={styles.metricValue}>vLLM / SGLang / MLX / llama.cpp</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Control</span>
              <span className={styles.metricValue}>local or remote</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Route</span>
              <span className={styles.metricValue}>OpenAI-compatible</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Tool</span>
              <span className={styles.metricValue}>Pi + MCP</span>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className={styles.section} aria-labelledby="product-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Actual app, no mock glass</p>
            <h2 id="product-title" className={styles.sectionTitle}>
              The machine stays in frame.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            Status, runtime, models, plugins. The working surfaces are the pitch.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[0]} priority />
          <div className={styles.stack}>
            {screenshots.slice(1, 3).map((screenshot) => (
              <ScreenshotFrame key={screenshot.src} screenshot={screenshot} />
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Capabilities">
        <div className={styles.capabilityGrid}>
          {capabilities.map(({ icon: Icon, title, copy }) => (
            <article className={styles.capability} key={title}>
              <div className={styles.capabilityIcon}>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.quoteBand}`} aria-label="Operating thesis">
        <blockquote className={styles.quote}>
          Control the stack before the stack controls you.
        </blockquote>
        <ul className={styles.terminalList}>
          <li>{"GET /status -> active model, pid, backend, port"}</li>
          <li>{"GET /gpus -> VRAM, power, temperature, utilization"}</li>
          <li>{"POST /studio/providers -> route provider/model requests"}</li>
          <li>{"GET /studio/provider-models -> inspect enabled upstreams"}</li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="gallery-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Operator surfaces</p>
            <h2 id="gallery-title" className={styles.sectionTitle}>
              Runtime. Fit. Tools.
            </h2>
          </div>
          <p className={styles.sectionLead}>
            The app is for the moment when a model, a GPU box, and an agent all need the same truth.
          </p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[3]} />
          <div className={styles.stack}>
            <ScreenshotFrame screenshot={screenshots[4]} />
            <ScreenshotFrame screenshot={screenshots[2]} />
          </div>
        </div>
      </section>

      <section id="downloads" className={styles.wideBand} aria-labelledby="downloads-title">
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionKicker}>Download</p>
              <h2 id="downloads-title" className={styles.sectionTitle}>
                Download the app. Point it at the machines.
              </h2>
            </div>
            <p className={styles.sectionLead}>
              Mac artifacts are served here. Agents get their own runbook.
            </p>
          </div>
          <div className={styles.downloadGrid}>
            {downloads.map((download) => {
              const isExternal = download.href.startsWith("http");
              const Icon = download.href === "/agents" ? GitFork : DownloadCloud;
              return (
                <article className={styles.downloadCard} key={download.title}>
                  <div className={styles.capabilityIcon}>
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <h3>{download.title}</h3>
                  <p>{download.copy}</p>
                  <div className={styles.downloadMeta}>
                    {download.meta.map((item) => (
                      <span className={styles.pill} key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                  <div className={styles.downloadActions}>
                    {isExternal ? (
                      <a className={styles.ghostButton} href={download.href}>
                        {download.href === "/agents" ? "Open page" : "Download"}
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    ) : (
                      <Link
                        className={styles.ghostButton}
                        href={download.href}
                        prefetch={false}
                        download={download.href.startsWith("/api/downloads")}
                      >
                        {download.href === "/agents" ? "Open page" : "Download"}
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Local Studio v0.2.9</span>
        <span>Desktop / web / controller / CLI / Pi</span>
      </footer>
    </main>
  );
}

const dltl = `DLTL: Local Studio multi-controller setup

Role:
Operate on the real install. Use live controller URLs. Do not expose secrets.

Hard rules:
- Never use max_tokens.
- For vLLM/SGLang, never add --disable-cuda-graphs or --enforce-eager.
- Do not bypass SSH host-key verification.
- Keep keys in env, secure local files, or app settings.

Controller setup:
1. Verify each controller with GET /status, /gpus, /config, /v1/models.
2. Local default: http://localhost:8080.
3. Remote GPU boxes expose controller API, not raw inference ports.
4. Add each URL in Settings -> Connection. Keep all saved controllers.
5. Switch active target and confirm Settings -> System runtime state.

Provider setup:
1. Providers are OpenAI-compatible /v1 upstreams.
2. Create through the active controller:
   POST /studio/providers
   {
     "id": "local-lmstudio",
     "name": "LM Studio",
     "base_url": "https://provider.example/v1",
     "api_key": "$PROVIDER_API_KEY",
     "enabled": true
   }
3. Verify GET /studio/providers and /studio/provider-models.
4. Route as model: "provider-id/model-name".

Runtime map:
- vLLM: CUDA throughput.
- SGLang: structured and multi-turn serving.
- llama.cpp: GGUF / llama-server.
- MLX: Apple Silicon.
- Launch through recipes/UI. Do not make chat proxy calls silently launch models.

Agent setup:
1. Add MCP servers in Plugins -> Custom.
2. Open /agent.
3. Pick the controller model or provider/model route.
4. Select only the needed MCP tools.
5. Smoke test: model, controller, tools.

Acceptance checks:
- Settings switches controllers.
- System shows runtime state.
- /studio/provider-models lists enabled upstreams.
- /v1/chat/completions works locally and through one provider route.
- /agent can complete a turn using the selected model and selected MCP tools.
- No secrets in diff, logs, screenshots, or commits.`;

const setupChecks = [
  "Controllers stay saved; switching is non-destructive.",
  "Provider keys live in controller config, not prompts.",
  "provider/model routes to that provider.",
  "Default model names hit the active backend.",
  "Pi sessions load only selected MCP tools.",
];

export function AgentsPage() {
  return (
    <main className={styles.shell}>
      <MarketingNav />
      <section className={styles.agentHero} aria-labelledby="agents-title">
        <p className={styles.eyebrow}>Agent field note</p>
        <h1 id="agents-title" className={styles.agentTitle}>
          Set up the stack.
        </h1>
        <p className={styles.agentLead}>
          A compact DLTL for controllers, providers, runtimes, MCP, and Pi.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.button} href="/api/downloads/mac-dmg" prefetch={false} download>
            <DownloadCloud size={18} aria-hidden="true" />
            Download app
          </Link>
          <Link className={styles.ghostButton} href="/download">
            <Gauge size={18} aria-hidden="true" />
            Back to funnel
          </Link>
        </div>
      </section>

      <section className={styles.agentGrid} aria-label="Agent setup instructions">
        <aside className={styles.agentPanel}>
          <div className={styles.capabilityIcon}>
            <Network size={18} aria-hidden="true" />
          </div>
          <h2>Scope</h2>
          <p>Multi-controller. Multi-provider. Runtime-aware. Tool-gated.</p>
          <div className={styles.checklist}>
            {setupChecks.map((check) => (
              <div className={styles.checkItem} key={check}>
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{check}</span>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: "1.4rem" }}>Useful probes</h3>
          <pre className={styles.compactBlock}>{`curl -s "$LOCAL_STUDIO_URL/status"
curl -s "$LOCAL_STUDIO_URL/gpus"
curl -s "$LOCAL_STUDIO_URL/config"
curl -s "$LOCAL_STUDIO_URL/studio/providers"
curl -s "$LOCAL_STUDIO_URL/studio/provider-models"`}</pre>
        </aside>

        <article className={styles.steps}>
          <div className={styles.stepsHeader}>
            <span className={styles.smallCaps}>Agent instructions</span>
            <span className={styles.pill}>DLTL</span>
          </div>
          <pre className={styles.codeBlock}>{dltl}</pre>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="agent-screenshots-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionKicker}>Where to look</p>
            <h2 id="agent-screenshots-title" className={styles.sectionTitle}>
              Runtime. MCP. Models.
            </h2>
          </div>
          <p className={styles.sectionLead}>The setup path is visible in the app.</p>
        </div>
        <div className={styles.screenshotGrid}>
          <ScreenshotFrame screenshot={screenshots[2]} />
          <div className={styles.stack}>
            <ScreenshotFrame screenshot={screenshots[4]} />
            <ScreenshotFrame screenshot={screenshots[1]} />
          </div>
        </div>
      </section>

      <section className={styles.section} aria-label="Agent architecture quick map">
        <div className={styles.capabilityGrid}>
          {[
            {
              icon: Boxes,
              title: "Controllers",
              copy: "Lifecycle, logs, metrics, recipes, provider config, proxy.",
            },
            {
              icon: Zap,
              title: "Providers",
              copy: "OpenAI-compatible upstreams addressed as provider/model.",
            },
            {
              icon: TerminalSquare,
              title: "Pi agents",
              copy: "Selected MCP, project context, browser, files.",
            },
          ].map(({ icon: Icon, title, copy }) => (
            <article className={styles.capability} key={title}>
              <div className={styles.capabilityIcon}>
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Agent setup page</span>
        <span>Controllers, providers, runtimes, MCP, Pi</span>
      </footer>
    </main>
  );
}
