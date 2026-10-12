# Cursor — Public Information Architecture & Web Design Tokens

> Research date: 2025-08-25  
> Sources: https://docs.cursor.com, https://cursor.com, https://cursor.com/pricing  
> Method: `curl` fetches of HTML and CSS; nav tree reconstructed from docs page link inventory; design tokens extracted from compiled CSS custom properties.

---

## 1. Docs Navigation Tree

Source: `https://docs.cursor.com` (Next.js app, Mintlify-style). The sitemap at `/sitemap.xml` returned HTML (no XML sitemap served). The nav tree below was reconstructed from all `href="/docs/..."` links present in the rendered page, de-duplicated. Group labels are inferred from URL path segments; page titles (where the link had visible text) are shown in brackets.

```
docs.cursor.com
├── get-started/
│   └── quickstart
│
├── agent/                                    [7 pages]
│   ├── overview
│   ├── agents-window
│   ├── agent-review
│   ├── plan-mode
│   ├── prompting
│   ├── debug-mode
│   └── design-mode
│
├── cloud-agent/                              [7 pages]
│   ├── setup
│   ├── builds
│   ├── best-practices
│   ├── automations
│   ├── mobile
│   ├── settings
│   └── api/endpoints
│
├── models/                                   [11 pages]
│   ├── claude-fable-5       [Claude Fable 5]
│   ├── claude-opus-5        [Claude Opus 5]
│   ├── claude-sonnet-5       [Claude Sonnet 5]
│   ├── cursor-composer-2-5   [Composer 2.5]
│   ├── gemini-3-1-pro       [Gemini 3.1 Pro]
│   ├── gemini-3-7-flash     [Gemini 3.7 Flash]
│   ├── gpt-5-6-luna         [GPT-5.6 Luna]
│   ├── gpt-5-6-sol          [GPT-5.6 Sol]
│   ├── gpt-5-6-terra        [GPT-5.6 Terra]
│   ├── grok-4-5             [Grok 4.5]
│   └── grok-4-6             [Grok 4.6]
│
├── origin/                                   [8 pages]
│   ├── create-repository
│   ├── git
│   ├── mirror-github
│   ├── pull-requests
│   ├── browse
│   ├── settings
│   ├── codebase-settings
│   └── integrations
│
├── integrations/                             [11 pages]
│   ├── slack
│   ├── microsoft-teams
│   ├── jira
│   ├── linear
│   ├── notion
│   ├── github
│   ├── gitlab
│   ├── azure-devops
│   ├── bitbucket
│   ├── jetbrains
│   └── xcode
│
├── cli/                                      [7 pages]
│   ├── overview
│   ├── installation
│   ├── using
│   ├── changelog
│   ├── shell-mode
│   ├── acp
│   └── headless
│
├── sdk/                                      [4 pages]
│   ├── typescript
│   ├── python
│   ├── bridge
│   └── changelog
│
├── reference/
│   └── deeplinks
│
└── top-level pages (ungrouped):
    ├── api                   [API]
    ├── models-and-pricing    [Models & Pricing]
    ├── customize-cursor
    ├── rules
    ├── skills
    ├── subagents
    ├── plugins
    ├── hooks
    ├── mcp
    ├── bugbot
    ├── security-agents
    ├── approval-agents
    └── cloud-agent           (also linked as top-level)
```

**Total pages discovered:** ~65 unique doc paths.

---

## 2. Feature Pillars (from docs tree)

| Pillar | Doc group / page(s) | Page count | Notes |
|---|---|---|---|
| **Agent** (in-editor AI) | `agent/` | 7 | Core pillar — overview, modes (plan/debug/design), prompting, review, agents window |
| **Background / Cloud Agents** | `cloud-agent/` + `approval-agents`, `security-agents` | 9 | Remote CI-style agents, automations, mobile, API endpoints, approval & security variants |
| **Models** | `models/` + `models-and-pricing` | 12 | Per-model pages for each offered LLM; deepest single group |
| **Origin** (Git hosting) | `origin/` | 8 | Cursor's own Git platform — repos, PRs, GitHub mirroring, browsing |
| **Integrations** | `integrations/` | 11 | Third-party: Slack, Teams, Jira, Linear, Notion, GitHub, GitLab, Bitbucket, Azure DevOps, JetBrains, Xcode |
| **CLI** | `cli/` | 7 | Headless, shell-mode, ACP protocol, installation |
| **SDK** | `sdk/` | 4 | TypeScript, Python, bridge, changelog |
| **Rules / Context / MCP** | `rules`, `mcp`, `skills`, `subagents`, `hooks` | 5 | Customization & context injection (rules files, MCP servers, skills, subagents, hooks) |
| **Plugins** | `plugins` | 1 | Extension system |
| **Customization** | `customize-cursor` | 1 | General settings/config |
| **Bugbot** | `bugbot` | 1 | Automated bug-finding agent |
| **API** | `api` | 1 | Public API reference |
| **Getting started** | `get-started/quickstart` | 1 | Onboarding |

**Relative depth:** Models (12) and Integrations (11) are the deepest groups, followed by Origin (8) and Agent/Cloud-Agent/CLI (7 each). The product's documentation emphasis is split between *what models you can use* and *what external services it connects to*, with the in-editor agent mode system as the central conceptual pillar.

---

## 3. Web Design Tokens

Source: Marketing site CSS at `https://cursor.com/marketing-static/_next/static/chunks/` (4 CSS files, ~452 KB total). Tokens extracted from `:root` custom properties and `@font-face` declarations.

### 3.1 Font Families (custom / named)

| Token / @font-face family | Usage | Stack |
|---|---|---|
| **CursorGothic** | Primary display/sans (`--font-sans` override) | `"CursorGothic", "CursorGothic Fallback", system-ui, Helvetica Neue, Helvetica, Arial, sans-serif` |
| **CursorGothic Fallback** | Metrics-matched fallback for CursorGothic | — |
| **berkeleyMono** | Monospace (`--font-berkeley-mono`) | `"berkeleyMono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ...` |
| **cursorMono** | Alternate mono (`--font-cursor-mono`) | `"cursorMono", ui-monospace, SFMono-Regular, ...` |
| **cursorDisplay** | Display headings (`--font-cursor-display`) | `"cursorDisplay", system-ui, Helvetica Neue, Helvetica, Arial, sans-serif` |
| **EB Garamond** | Serif (`--font-serif` override) | `"EB Garamond", Iowan Old Style, Palatino Linotype, URW Palladio L, P052, ui-serif, Georgia, ...` |
| **Lato** | Body/sans fallback | `"Lato", "Lato Fallback", ...` |
| KaTeX_* | Math rendering only (12 sub-families) | — |

The marketing HTML `<html>` element loads these as CSS variable classes: `cursorgothic_…`, `berkeleymono_…`, `cursormono_…`, `eb_garamond_…`.

### 3.2 Background / Foreground Palette

**Light theme (default `:root`):**

| Token | Value | Role |
|---|---|---|
| `--color-theme-bg` | `#f7f7f4` | Page background (warm off-white) |
| `--color-theme-fg` | `#26251e` | Primary foreground text (warm near-black) |
| `--color-theme-fg-02` | `#3b3a33` | Secondary foreground (hover states) |
| `--color-theme-card-hex` | `#f2f1ed` | Card background |
| `--color-theme-card-01-hex` | `#f0efeb` | Card variant 1 |
| `--color-theme-card-02-hex` | `#ebeae5` | Card variant 2 |
| `--color-theme-card-03-hex` | `#e6e5e0` | Card variant 3 |
| `--color-theme-card-04-hex` | `#e1e0db` | Card variant 4 |
| `--color-theme-card-warm-hex` | `#f3ede6` | Warm card background |
| `--color-theme-card-hover-hex` | `#ebeae5` | Card hover |
| `--color-theme-card-hover-light-hex` | `#f0efeb` | Card hover (light) |
| `--color-theme-button-bg` | `var(--color-theme-fg)` = `#26251e` | Primary button background |
| `--color-theme-button-text` | `var(--color-theme-bg)` = `#f7f7f4` | Primary button text |
| `--color-theme-button-hover-bg` | `var(--color-theme-fg-02)` = `#3b3a33` | Button hover bg |
| `--color-theme-button-sec-bg` | `transparent` | Secondary button bg |
| `--color-theme-button-sec-border` | `var(--color-theme-border-03)` = `#26251e99` | Secondary button border |
| `--color-theme-button-sec-text` | `var(--color-theme-fg)` = `#26251e` | Secondary button text |

**Dark theme (`[data-theme="dark"]`):**

| Token | Value |
|---|---|
| `--color-theme-bg` | `#14120b` |
| `--color-theme-fg` | `#edecec` |
| `--color-theme-fg-02` | `#d7d6d5` |
| `--color-theme-card-hex` | `#1b1913` |
| `--color-theme-card-01-hex` | `#1d1b15` |
| `--color-theme-card-02-hex` | `#201e18` |
| `--color-theme-card-03-hex` | `#26241e` |
| `--color-theme-card-04-hex` | `#2b2923` |
| `--color-theme-card-hover-hex` | `#201e18` |
| `--color-theme-card-hover-light-hex` | `#1d1b15` |
| `--color-theme-card-warm-hex` | `#1c1713` |

**Foreground opacity variants** (derived from `#26251e` via `color-mix`):

| Token | Hex | Opacity |
|---|---|---|
| `--color-theme-fg-01` | `#26251e03` | 1% |
| `--color-theme-fg-02-5` | `#26251e06` | 2.5% |
| `--color-theme-fg-05` | `#26251e0d` | 5% |
| `--color-theme-fg-07-5` | `#26251e13` | 7.5% |
| `--color-theme-fg-08` | `#26251e14` | 8% |
| `--color-theme-fg-10` | `#26251e1a` | 10% |
| `--color-theme-fg-15` | `#26251e26` | 15% |
| `--color-theme-fg-20` | `#26251e33` | 20% |
| `--color-theme-text-mid` | `#26251e80` | 50% |
| `--color-theme-text-sec` | `#26251e99` | 60% |
| `--color-theme-text-tertiary` | `#26251e66` | 40% |

**Borders** (also fg-derived):

| Token | Hex | Opacity |
|---|---|---|
| `--color-theme-border-01` | `#26251e06` | 2.5% |
| `--color-theme-border-01-5` | `#26251e0d` | 5% |
| `--color-theme-border-02` | `#26251e1a` | 10% |
| `--color-theme-border-02-5` | `#26251e33` | 20% |
| `--color-theme-border-03` | `#26251e99` | 60% |

### 3.3 Accent Colors

| Token / Context | Value | Notes |
|---|---|---|
| `--color-theme-accent` | `#f54e00` | **Primary accent** — vivid orange |
| `--theme-orange-secondary` (dark) | `#772600` | Dark-theme orange secondary |
| `--theme-orange-tertiary` (dark) | `#2f0f00` | Dark-theme orange tertiary |
| `#ff7433` | — | Lighter orange accent variant |
| `#ed4c00` | — | Orange accent variant |
| `#2268ff` | — | Blue accent (links/interactive) |
| `#1750eb` | — | Blue accent variant |

**Dark-theme multi-hue palette** (secondary/tertiary pairs for categorical/chart use):

| Hue | Secondary | Tertiary |
|---|---|---|
| Brown | `#493019` | `#1d130a` |
| Salmon | `#803a1a` | `#33170a` |
| Amber | `#544701` | `#221c00` |
| Green | `#165014` | `#092008` |
| Sky | `#195460` | `#0a2226` |
| Blue | `#113480` | `#071533` |
| Lavender | `#464574` | `#1c1b2e` |
| Pink | `#763c60` | `#2f1826` |
| Red | `#6e1918` | `#2c0a09` |

**Product chrome (code-editor preview) colors:**

| Token | Value |
|---|---|
| `--color-theme-product-ansi-green` | `#1f8a65` |
| `--color-theme-product-ansi-red` | `#cf2d56` |
| `--color-theme-product-text` | `#26251eeb` (92% fg) |
| `--color-theme-product-text-sec` | `#26251e99` (60% fg) |
| `--color-theme-product-text-tertiary` | `#26251e66` (40% fg) |
| `--color-theme-product-chrome` | `var(--color-theme-card-hex)` |
| `--color-theme-product-editor` | `var(--color-theme-bg)` |

### 3.4 Border Radii

**Design-token scale (`:root`):**

| Token | Value |
|---|---|
| `--radius-2xs` | `2px` |
| `--radius-xs` | `4px` |
| `--radius-sm` | `.25rem` (4px) |
| `--radius-md` | `8px` |
| `--radius-lg` | `.5rem` (8px) |
| `--radius-xl` | `.75rem` (12px) |
| `--radius-2xl` | `1rem` (16px) |

**Additional hardcoded radii in CSS:** `10px`, `12px`, `14px`, `16px`, `18px`, `19px`, `20px`, `22px`, `23px`, `28px`, `40px`, `50%`, `9999px` (pill).

### 3.5 Typography Scale (text tokens)

| Token | Value |
|---|---|
| `--text-xs` | `.75rem` |
| `--text-sm` | `.875rem` |
| `--text-base` | `1rem` |
| `--text-product-sm` | `.6875rem` |
| `--text-product-base` | `.75rem` |
| `--text-product-lg` | `.8125rem` |
| `--text-md-sm` | `1.125rem` |
| `--text-md` | `1.375rem` |
| `--text-md-lg` | `1.625rem` |
| `--text-lg` | `2.25rem` |
| `--text-xl` | `3.25rem` |
| `--text-2xl` | `4.5rem` |
| `--text-3xl` | `1.875rem` |
| `--text-4xl` | `2.25rem` |

Font weights: `300` (light), `400` (normal), `500` (medium), `600` (semibold), `700` (bold).

---

## 4. Pricing / Product Tiers

Source: `https://cursor.com/pricing` — JSON-LD structured data (`offers` array) and visible HTML.

| Tier | Price | Category |
|---|---|---|
| **Hobby** | $0 (Free) | Individual |
| **Pro** | $20/mo | Individual |
| **Pro+** | $60/mo | Individual |
| **Ultra** | $200/mo | Individual |
| **Teams** | $40/mo | Teams |
| **Enterprise** | Custom (contact sales) | Enterprise |

Pricing page headings group these as: **Hobby** (free), **Individual** (Pro / Pro+ / Ultra), **Teams** ($40/user), **Enterprise** (custom). The "Ultra" tier at $200/mo is the top individual plan; "Pro+" at $60/mo sits between Pro and Ultra.

---

## 5. Fetch Notes

| URL | Status | Notes |
|---|---|---|
| `https://docs.cursor.com` | ✅ 200, 499 KB | Next.js RSC app (Mintlify-based). Nav tree extracted from rendered `<a href>` links. |
| `https://docs.cursor.com/sitemap.xml` | ⚠️ 200, but HTML not XML | No XML sitemap served; returns the docs app shell. Sitemap unavailable. |
| `https://docs.cursor.com/llms.txt` | ⚠️ 200, but HTML | Same app shell; no plain-text index. |
| `https://docs.cursor.com/llms-full.txt` | ⚠️ 200, but HTML | Same app shell. |
| `https://cursor.com` | ✅ 200, 642 KB | Marketing home page; 4 CSS stylesheets linked. |
| `https://cursor.com/pricing` | ✅ 200, 249 KB | Pricing page; JSON-LD `offers` array provided structured tier data. |
| Marketing CSS (4 files) | ✅ 200, ~452 KB total | `0422heeqb2-0n.css` (323 KB, main tokens), `0c~npwg.7_voy.css` (98 KB), `0aim4jn04i49~.css` (24 KB), `0iad.5x0nsa4f.css` (7 KB). All design tokens extracted from these. |

**Docs group labels:** The docs app renders navigation client-side via React Server Components; the sidebar group headings (e.g. "Get Started", "Agent") are not present as static text in the initial HTML. Group names in the tree above are inferred from URL path segments. The page-level titles shown in brackets come from link text where available (model pages have visible labels; most other links render text client-side after hydration).

**Design token fidelity:** All hex/lab/oklch values are quoted verbatim from the compiled CSS `:root` blocks. Where a token has both a hex and a `color-mix()` / `lab()` definition, both are shown — the hex is the static fallback, the `color-mix()` is the computed value. The palette is built on a warm-neutral foundation (`#f7f7f4` bg / `#26251e` fg) with a single vivid orange accent (`#f54e00`).
