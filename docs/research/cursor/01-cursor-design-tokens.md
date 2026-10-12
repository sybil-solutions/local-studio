# Cursor 3.18.0 Design Tokens

Extracted from `/Applications/Cursor.app/Contents/Resources/app/`.

**Default dark theme:** `Cursor Dark Anysphere v0.0.3` (`extensions/theme-cursor/themes/cursor-dark-color-theme.json`). Cursor ships five themes: Cursor Dark (default), Cursor Dark Midnight, Cursor Dark High Contrast, Cursor Light, Cursor Light Colorblind. The VSCode `theme-defaults` extension is also present (`dark_modern.json`, `dark_vs.json`, etc.) but Cursor's own `theme-cursor` extension overrides as default.

**Cursor's own UI layer** lives in two compiled bundles:
- `out/vs/workbench/workbench.glass.main.css` + `workbench.glass.main.js` — the "Glass" design system (AI chat/composer, sidebar, command center, all non-VSCode chrome).
- `out/vs/workbench/workbench.desktop.main.css` + `workbench.desktop.main.js` — VSCode workbench CSS plus Cursor's `--cursor-*` token injections.

Token values below are sourced from the JS bundles (where `--cursor-*` custom properties are defined with literal values) and the theme JSON files (for the VSCode color palette).

---

## 1. Typography

### Font stacks

| Token | Value | Source |
|---|---|---|
| `--cursor-font-family-sans` | `var(--cursor-font-family, var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif))` | `workbench.glass.main.js` |
| `--vscode-font-family` (default) | `-apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, Ubuntu, 'Droid Sans', sans-serif` | `workbench.desktop.main.css` |
| `--monaco-monospace-font` | `"SF Mono", Monaco, Menlo, Courier, monospace` | `workbench.desktop.main.css` |
| `--vscode-editor-font-family` | `var(--monaco-monospace-font)` (resolved from settings; default Menlo/SF Mono stack) | `workbench.desktop.main.css` |
| `cursor-icons` | custom icon font (codicon-derived) | `workbench.desktop.main.css` |
| `codicon` | VSCode codicon font | `workbench.desktop.main.css` |

### Font sizes (Cursor Glass token system)

| Token | Value |
|---|---|
| `--cursor-font-size-xs` | `11px` |
| `--cursor-font-size-sm` | `12px` |
| `--cursor-font-size-base` | `13px` |
| `--cursor-font-size-lg` | `14px` |

Source: `workbench.glass.main.js` / `workbench.desktop.main.js`.

Most common literal `font-size` values in the Glass CSS: `12px` (272 occurrences), `11px` (93), `13px` (92), `10px` (61), `14px` (55), `16px` (36). The AI conversation pane uses `--conversation-text-font-size: var(--cursor-font-size-lg)` = 14px for message text, `--conversation-tool-font-size: var(--cursor-font-size-lg)` = 14px for tool cards, `--conversation-tray-font-size: var(--cursor-font-size-base)` = 13px for the composer tray.

### Font weights

| Token | Value |
|---|---|
| `--cursor-font-weight-normal` | `418` (unique to Cursor; near-400) |
| `--cursor-font-weight-medium` | `500` |
| `--cursor-font-weight-semibold` | `590` (unique to Cursor; between 500–600) |
| `--cursor-font-weight-bold` | `700` |

Source: `workbench.glass.main.js`. Literal `font-weight` usage in Glass CSS: `400` (95×), `600` (73×), `500` (61×), `700` (48×), `590` (9×).

### Line heights

| Token | Value |
|---|---|
| `--cursor-line-height-xs` | `14px` |
| `--cursor-line-height-sm` | `16px` |
| `--cursor-line-height-base` | `18px` |
| `--cursor-line-height-lg` | `22px` |

Source: `workbench.glass.main.js`. The AI conversation pane uses `--conversation-line-height: var(--cursor-line-height-lg)` = 22px. Most common literal `line-height` in Glass CSS: `16px` (101×), `18px` (39×), `1.4` (34×), `14px` (31×), `22px` (27×).

---

## 2. Default Dark Theme Palette

Source: `extensions/theme-cursor/themes/cursor-dark-color-theme.json` (theme name: "Cursor Dark Anysphere v0.0.3").

| Token | Hex |
|---|---|
| `editor.background` | `#181818` |
| `editor.foreground` | `#F0F0F0` |
| `sideBar.background` | `#141414` |
| `sideBar.foreground` | `#F0F0F0BD` |
| `activityBar.background` | `#141414` |
| `activityBar.foreground` | `#F0F0F0BD` |
| `activityBarBadge.background` | `#88C0D0` |
| `activityBarBadge.foreground` | `#141414` |
| `titleBar.activeBackground` | `#141414` |
| `titleBar.activeForeground` | `#F0F0F084` |
| `statusBar.background` | `#141414` |
| `statusBar.foreground` | `#F0F0F099` |
| `tab.activeBackground` | `#181818` |
| `tab.activeForeground` | `#F0F0F0` |
| `tab.inactiveBackground` | `#141414` |
| `tab.inactiveForeground` | `#F0F05C` (`#F0F0F05C`) |
| `tab.border` | `#F0F0F013` |
| `panel.background` | `#141414` |
| `panel.border` | `#F0F0F013` |
| `panelTitle.activeForeground` | `#F0F0F0` |
| `panelTitle.inactiveForeground` | `#F0F0F0BD` |
| `input.background` | `#F0F0F00A` |
| `input.foreground` | `#F0F0F0` |
| `input.border` | `#F0F0F013` |
| `input.placeholderForeground` | `#F0F0F099` |
| `dropdown.background` | `#181818` |
| `dropdown.foreground` | `#F0F0F0` |
| `dropdown.border` | `#F0F0F013` |
| `list.activeSelectionBackground` | `#F0F0F01E` |
| `list.activeSelectionForeground` | `#F0F0F0` |
| `list.inactiveSelectionBackground` | `#F0F0F011` |
| `list.hoverBackground` | `#F0F0F011` |
| `list.focusBackground` | `#F0F0F01E` |
| `list.highlightForeground` | `#88C0D0` |
| `focusBorder` | `#F0F0F026` |
| `badge.background` | `#88C0D0` |
| `badge.foreground` | `#141414` |
| `button.background` | `#81A1C1` |
| `button.foreground` | `#191C22` |
| `button.hoverBackground` | `#87A6C4` |
| `button.secondaryBackground` | `#626262` |
| `button.secondaryForeground` | `#F0F0F0` |
| `textLink.foreground` | `#81A1C1` |
| `textLink.activeForeground` | `#87A6C4` |
| `editor.lineHighlightBackground` | `#262626` |
| `editorCursor.foreground` | `#F0F0F0` |
| `editorLineNumber.foreground` | `#F0F0F05C` |
| `editorLineNumber.activeForeground` | `#F0F0F0` |
| `editorWidget.background` | `#141414` |
| `editorSuggestWidget.background` | `#141414` |
| `editorSuggestWidget.selectedBackground` | `#343434` |
| `editorHoverWidget.background` | `#141414` |
| `selection.background` | `#F0F0F030` |
| `editor.selectionBackground` | `#40404099` |
| `scrollbarSlider.background` | `#F0F0F011` |
| `scrollbarSlider.hoverBackground` | `#F0F0F01E` |
| `scrollbarSlider.activeBackground` | `#F0F0F01E` |
| `widget.shadow` | `#00000066` |
| `errorForeground` | `#E34671` |
| `editorError.foreground` | `#E34671` |
| `editorWarning.foreground` | `#F1B467` |
| `progressBar.background` | `#3FA266` |
| `terminal.background` | `#141414` |
| `terminal.foreground` | `#F0F0F0` |
| `minimap.background` | `#181818` |
| `notifications.background` | `#141414` |

### Accent colors (theme JSON)

| Role | Hex | Source token |
|---|---|---|
| Primary accent (badges, find match) | `#88C0D0` | `activityBarBadge.background`, `badge.background` |
| Button primary | `#81A1C1` | `button.background` |
| Button hover | `#87A6C4` | `button.hoverBackground` |
| Link | `#81A1C1` | `textLink.foreground` |
| Link active | `#87A6C4` | `textLink.activeForeground` |
| Success/added (git) | `#70B489` | `gitDecoration.addedResourceForeground` |
| Modified (git) | `#F1B467` | `gitDecoration.modifiedResourceForeground` |
| Deleted (git) | `#FC6B83` | `gitDecoration.deletedResourceForeground` |
| Untracked (git) | `#88C0D0` | `gitDecoration.untrackedResourceForeground` |
| Error | `#E34671` | `errorForeground` |
| Warning | `#F1B467` | `editorWarning.foreground` |

### Cursor Glass design-system color tokens (from JS)

These are Cursor's own semantic tokens, defined in `workbench.glass.main.js` and `workbench.desktop.main.js`, overlaid on the VSCode theme:

| Token | Hex |
|---|---|
| `--cursor-base` | `#F0F0F0` |
| `--cursor-chrome` | `#141414` |
| `--cursor-editor` | `#181818` |
| `--cursor-sidebar` | `#181818` |
| `--cursor-accent` | `#599CE7` |
| `--cursor-brand` | `#F54E00` |
| `--cursor-blue` | `#7BAFE9` |
| `--cursor-cyan` | `#81A1C1` |
| `--cursor-green` | `#3FA266` |
| `--cursor-magenta` | `#B48EAD` |
| `--cursor-orange` | `#D08770` |
| `--cursor-purple` | `#9386F2` |
| `--cursor-red` | `#FC6B83` |
| `--cursor-yellow` | `#F1B467` |
| `--cursor-danger` | `#E34671` |
| `--cursor-success` | `#3FA266` |
| `--cursor-warn` | `#F1B467` |
| `--cursor-focus` | `#F0F0F0` |
| `--cursor-added` | `#70B489` |
| `--cursor-modified` | `#F1B467` |
| `--cursor-removed` | `#FC6B83` |
| `--cursor-untracked` | `#88C0D0` |
| `--cursor-action-label` | `#191C22` |

Derived background tokens use `color-mix()` opacity tiers: `primary` (full), `secondary` (14–24%), `tertiary` (6–12%), `quaternary` (6%), `quinary` (4%) — all mixed against `--vscode-editor-foreground`. Elevated surfaces: `--cursor-bg-elevated: var(--cursor-editor)` = `#181818` (or `#1b1f27` in one fallback). The `--cursor-bg-primary` literal is `#0c0e11`; `--cursor-bg-secondary` literal is `#14171d`.

Text opacity tiers: `--cursor-text-primary` = `--vscode-editor-foreground` (#F0F0F0), `secondary` = 74–84% mix, `tertiary` = 60–72% mix, `quaternary` = 36–60% mix.

Syntax highlighting tokens (Glass JS):

| Token | Hex |
|---|---|
| `--cursor-syntax-background` | `#181818` |
| `--cursor-syntax-foreground` | `#D6D6DD` |
| `--cursor-syntax-comment` | `#E4E4E45E` |
| `--cursor-syntax-keyword` | `#82D2CE` |
| `--cursor-syntax-string` | `#E394DC` |
| `--cursor-syntax-function` | `#EFB080` |
| `--cursor-syntax-constant` | `#F8C762` |
| `--cursor-syntax-number` | `#EBC88C` |
| `--cursor-syntax-link` | `#87C3FF` |
| `--cursor-syntax-parameter` | `#D6D6DD` |
| `--cursor-syntax-punctuation` | `#D6D6DD` |

---

## 3. AI-Pane (Chat/Composer) Styling

Source: `workbench.glass.main.css` and `workbench.glass.main.js`.

### Conversation layout tokens

| Token | Value |
|---|---|
| `--conversation-font-size` | `var(--conversation-tool-font-size)` → 14px |
| `--conversation-text-font-size` | `var(--cursor-font-size-lg)` = 14px |
| `--conversation-tool-font-size` | `var(--cursor-font-size-lg)` = 14px |
| `--conversation-tray-font-size` | `var(--cursor-font-size-base)` = 13px |
| `--conversation-line-height` | `var(--cursor-line-height-lg)` = 22px |
| `--conversation-block-gap` | `16px` |
| `--conversation-list-before-gap` | `8px` |
| `--conversation-list-after-gap` | `18px` |
| `--conversation-list-item-gap` | `8px` |
| `--conversation-heading-after-gap` | `4px` |
| `--conversation-embedded-block-before-gap` | `12px` |
| `--conversation-classic-block-inset` | `11px` |
| `--conversation-classic-text-inset` | `11px` |
| `--conversation-glass-text-inset` | `13px` (default, overridable via `--conversation-glass-text-inset-override`) |
| `--conversation-glass-block-inset` | `-10px` (default, overridable via `--conversation-glass-block-inset-override`) |
| `--conversation-opposed-inset` | `clamp(0px, (100% - 480px) * 0.4, 20%)` |
| `--conversation-opposed-inset-human` | `max(32px, var(--conversation-opposed-inset))` |
| `--conversation-surface-border-radius` | `var(--cursor-radius-xl)` = 12px |

### Tool card (AI tool-call display)

| Token | Value |
|---|---|
| `--conversation-tool-card-padding-x` | `10px` |
| `--conversation-tool-card-padding-y` | `8px` |
| `--conversation-tool-card-gap` | `6px` |
| `--conversation-tool-card-padding-tight-x` | `calc(padding-x - 2px)` = 8px |

### Message bubble

| Token | Value |
|---|---|
| `--glass-chat-bubble-background` | `var(--cursor-bg-elevated)` → `#181818` (or `color-mix(in srgb, var(--cursor-bg-elevated) 96%, #fff)`) |
| `--conversation-sent-message-bubble-background` | `color-mix(in srgb, var(--glass-chat-bubble-background, var(--vscode-input-background)) 38%, var(--glass-chat-surface-background, var(--vscode-sideBar-background)))` |
| `--glass-chat-surface-background` | `var(--cursor-bg-chrome)` → `#141414` (non-vibrancy); vibrancy modes use `--glass-vibrancy-off-chat-surface-background` / `--glass-vibrancy-on-chat-surface-background` |
| `--glass-editor-surface-background` | `var(--cursor-bg-chrome)` → `#141414` |
| `--glass-sidebar-surface-background` | `var(--cursor-bg-sidebar)` → `#181818` |
| `--glass-surface-background` | `rgba(0,0,0,.42)` (dark) / `hsla(0,0%,100%,.16)` (light) / `var(--cursor-bg-editor)` |

### Glass focus ring

| Token | Value |
|---|---|
| `--glass-focus-ring-color` | `var(--cursor-stroke-focused)` → `var(--vscode-focusBorder)` = `#F0F0F026` |
| `--glass-focus-ring-offset` | `2px` |
| `--glass-focus-ring-radius` | `var(--cursor-radius-sm)` = 4px |
| `--glass-focus-ring-width` | `1px` |

### Glass agent panel (tiled conversations)

| Token | Value |
|---|---|
| `--glass-agent-panel-inactive-tile-opacity` | `0.8` / `0.96` / `1` (state-dependent) |
| `--glass-agent-conversation-tiling-panel-actions-opacity` | `0` / `1` |
| `--glass-agent-conversation-tiling-header-actions-opacity` | `1` / inherits panel |
| `--glass-agent-conversation-tiling-panel-actions-pointer-events` | `none` / `auto` |
| `--glass-agent-conversation-tiling-header-actions-pointer-events` | `auto` |

### Composer bar

The composer bar sets these overrides on `.composer-bar, .composer-messages-container`:
```
--conversation-text-font-size: var(--cursor-font-size-lg)    /* 14px */
--conversation-tool-font-size: var(--cursor-font-size-lg)     /* 14px */
--conversation-tray-font-size: var(--cursor-font-size-base)  /* 13px */
--conversation-font-size: var(--conversation-tool-font-size) /* 14px */
--conversation-line-height: var(--cursor-line-height-lg)     /* 22px */
--conversation-block-gap: 16px
--conversation-list-before-gap: 8px
--conversation-list-after-gap: 18px
--conversation-heading-after-gap: 4px
--conversation-embedded-block-before-gap: 12px
--conversation-list-item-gap: 8px
--conversation-tool-card-padding-x: 10px
--conversation-tool-card-padding-y: 8px
--conversation-tool-card-gap: 6px
```

### Buttons in Glass

- Default `button` border-radius: `4px` (most common), `5px` (secondary), `9999px` (pill-shaped action buttons), `50%` (circular icon buttons).
- Pill/action buttons: `background-color: var(--cursor-bg-blue-primary)`, `border: 1px solid transparent`, `border-radius: 9999px`.
- Glass buttons use `backdrop-filter: blur(10px)`, `background: color-mix(in srgb, var(--cursor-bg-secondary) 56%, transparent)`, `border-radius: 50%` (circular) or `4px`.

---

## 4. Radii & Spacing

### Radii (Cursor Glass token system)

Source: `workbench.glass.main.js`.

| Token | Value |
|---|---|
| `--cursor-radius-none` | `0px` |
| `--cursor-radius-xs` | `2px` |
| `--cursor-radius-sm` | `4px` |
| `--cursor-radius-base` | `6px` |
| `--cursor-radius-lg` | `8px` |
| `--cursor-radius-xl` | `12px` |
| `--cursor-radius-2xl` | `14px` |
| `--cursor-radius-3xl` | `16px` |
| `--cursor-radius-4xl` | `18px` |
| `--cursor-radius-full` | `9999px` |

Most common literal `border-radius` in both CSS files: `4px` (132×), `6px` (65×), `3px` (59×), `2px` (59×), `50%` (40×), `5px` (38×), `8px` (30×), `999px`/`9999px` (pill), `10px`, `12px`, `16px`.

### Spacing scale (4px base unit)

Source: `workbench.glass.main.js`.

| Token | Value |
|---|---|
| `--cursor-spacing-0-25` | `1px` |
| `--cursor-spacing-1` | `4px` |
| `--cursor-spacing-2` | `8px` |
| `--cursor-spacing-3` | `12px` |
| `--cursor-spacing-4` | `16px` |
| `--cursor-spacing-5` | `20px` |
| `--cursor-spacing-6` | `24px` |
| `--cursor-spacing-7` | `28px` |
| `--cursor-spacing-8` | `32px` |
| `--cursor-spacing-9` | `36px` |
| `--cursor-spacing-10` | `40px` |
| `--cursor-spacing-11` | `44px` |
| `--cursor-spacing-12` | `48px` |
| `--cursor-spacing-13` | `52px` |
| `--cursor-spacing-14` | `56px` |
| `--cursor-spacing-15` | `60px` |
| `--cursor-spacing-16` | `64px` |
| `--cursor-spacing-17` | `68px` |
| `--cursor-spacing-18` | `72px` |
| `--cursor-spacing-19` | `76px` |
| `--cursor-spacing-20` | `80px` |

Fractional spacing tokens also exist: `--cursor-spacing-0-75`, `-1-25`, `-1-5`, `-1-75` (values: 3px, 5px, 6px, 7px respectively, following the 4px base).

---

## 5. Density Metrics

Source: `workbench.desktop.main.css`.

| Element | Dimension | Value |
|---|---|---|
| Activity bar width | `.part.activitybar { width }` | `48px` |
| Activity bar item (icon) | `.activitybar .action-label { height, width }` | `48px × 48px` |
| Status bar height | `.part.statusbar { height }` | `22px` |
| Tab bar height | `.title.tabs { height }` (breadcrumbs-below-tabs) | `32px` |
| Breadcrumbs control | `.breadcrumbs-control { height }` | `22px` |
| List row height | `.monaco-list-row { line-height }` | `22px` |
| List row (custom tree item) | `.monaco-list-row .custom-view-tree-node-item { height, line-height }` | `22px` |
| List row icon | `.monaco-list-row .icon { height }` | `16px` |
| Tab icon (codicon in tab) | `.tab .action-label.codicon { height, width, font-size }` | `16px` |
| Suggest widget max height | `.monaco-list { max-height }` | `440px` |
| Status bar font-size | `.part.statusbar { font-size }` | `12px` |
| Tab label font-size (breadcrumbs) | `.breadcrumbs-action-btn { font-size }` | `12px` |

Tab height is not set via a fixed pixel `height` on `.tab` itself; it's computed from font-size + padding. The tabs container row is 32px (breadcrumbs-below-tabs), and the breadcrumb control within is 22px.

---

## 6. Alternate Themes (Reference)

### Cursor Dark Midnight

Source: `extensions/theme-cursor/themes/cursor-dark-midnight-color-theme.json` ("Cursor Dark Midnight v0.0.1").

| Token | Hex |
|---|---|
| `editor.background` | `#1E2127` |
| `editor.foreground` | `#7B88A1` |
| `sideBar.background` | `#191C22` |
| `activityBar.background` | `#191C22` |
| `titleBar.activeBackground` | `#191C22` |
| `statusBar.background` | `#191C22` |
| `tab.activeBackground` | `#1E2127` |
| `tab.inactiveBackground` | `#191C22` |
| `panel.background` | `#191C22` |
| `button.background` | `#88C0D0` |
| `badge.background` | `#88C0D0` |
| `textLink.foreground` | `#8FBCBB` |
| `focusBorder` | `#00000000` (no visible focus border) |
| `list.hoverBackground` | `#272C3699` |

### Cursor Light

Source: `extensions/theme-cursor/themes/cursor-light-color-theme.json`.

| Token | Hex |
|---|---|
| `editor.background` | `#FCFCFC` |
| `editor.foreground` | `#141414` |
| `sideBar.background` | `#F3F3F3` |
| `activityBar.background` | `#F3F3F3` |
| `titleBar.activeBackground` | `#F3F3F3` |
| `statusBar.background` | `#F3F3F3` |
| `tab.activeBackground` | `#FCFCFC` |
| `tab.inactiveBackground` | `#F3F3F3` |
| `button.background` | `#2778C1` |
| `button.foreground` | `#FCFCFC` |
| `focusBorder` | `#14141433` |
| `textLink.foreground` | `#0064B0` |
| `list.activeSelectionBackground` | `#14141414` |
| `list.hoverBackground` | `#14141414` |
| `input.background` | `#FCFCFC` |
| `activityBarBadge.background` | `#005293` |

---

## 7. Source Summary

| Data | Source file |
|---|---|
| Default theme palette (hex values) | `extensions/theme-cursor/themes/cursor-dark-color-theme.json` |
| Midnight theme | `extensions/theme-cursor/themes/cursor-dark-midnight-color-theme.json` |
| Light theme | `extensions/theme-cursor/themes/cursor-light-color-theme.json` |
| Glass design tokens (`--cursor-radius-*`, `--cursor-spacing-*`, `--cursor-font-size-*`, `--cursor-line-height-*`) | `out/vs/workbench/workbench.glass.main.js` |
| Glass color tokens (`--cursor-blue`, `--cursor-chrome`, etc.), font-family, font-weight | `out/vs/workbench/workbench.glass.main.js`, `out/vs/workbench/workbench.desktop.main.js` |
| Conversation/AI-pane layout tokens | `out/vs/workbench/workbench.glass.main.css` |
| Glass chat bubble/surface/vibrancy tokens | `out/vs/workbench/workbench.glass.main.css` |
| Font stacks (VSCode defaults, monaco monospace) | `out/vs/workbench/workbench.desktop.main.css` |
| Density metrics (activity bar, status bar, tab, list row heights) | `out/vs/workbench/workbench.desktop.main.css` |
| Button/border-radius literal usage | `out/vs/workbench/workbench.glass.main.css`, `workbench.desktop.main.css` |
| Theme extension metadata | `extensions/theme-cursor/package.json` |
| Product configuration | `out/vs/workbench/workbench.desktop.main.js` (theme defaults injected at runtime, not in `product.json`) |

**Note:** `product.json` does not contain a `defaultTheme` or `defaultColorTheme` key. The default theme is resolved at runtime via Cursor's theme service in the JS bundles. The `theme-cursor` extension's `package.json` lists "Cursor Dark" (`cursor-dark-color-theme.json`) as the first `vs-dark` theme, which matches the observed default.
