# Pattern 9 — Markdown + syntax-highlighted assistant rendering

Assistant messages are rendered as Markdown with syntax highlighting and
a copy-to-clipboard affordance for code blocks. The renderer is small,
self-contained, and wrapped in an error boundary so a malformed model
output cannot crash the chat pane.

## Where it appears

| File | Role |
|------|------|
| `frontend/src/app/agent/_components/assistant-markdown.tsx` (5,290 bytes) | The full implementation: `AssistantMarkdown` component + `MarkdownErrorBoundary` + `CodeBlockCopyButton`. |
| `frontend/src/app/agent/_components/chat-pane.tsx` | The consumer — uses `<AssistantMarkdown text={...}>` for `message`-typed events from the pi event stream. |
| `package.json` (frontend) | Declares `react-markdown`, `rehype-highlight`, `remark-gfm`, and `highlight.js`. |
| Commit `365eac90` | `feat: markdown + syntax highlighting for assistant messages; thinking shown above body (not at end)` |

## Anatomy

```tsx
export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 text-sm leading-6 text-(--fg)">
      <MarkdownErrorBoundary fallback={<pre className="whitespace-pre-wrap text-sm">{text}</pre>}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={components}
        >
          {text}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  );
}
```

The `components` map overrides every block type (`h1`-`h4`, `p`, `ul`,
`ol`, `li`, `code`, `pre`, `a`, `blockquote`, `hr`, `table`, `thead`,
`tr`, `th`, `td`) to apply Tailwind classes consistent with the
agent-surface design tokens (`text-(--fg)`, `bg-(--surface)`,
`border-(--border)`).

For `pre`, the override extracts the rendered text via a small
`nodeToPlainText` helper and renders a `<CodeBlockCopyButton code={...}>`
in the top-right corner — clicking it sets `copied=true` for 1.2s.

The error boundary is a stock React `componentDidCatch`:

```tsx
class MarkdownErrorBoundary extends React.Component<...> {
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
```

Fallback is a `<pre>` of the raw text — losing formatting but never the
content.

## Thinking-block expansion

Commit `365eac90`'s commit message — "thinking shown above body (not at
end)" — refers to a sibling concern handled in `chat-pane.tsx`: when the
pi event stream emits a `message` event with a `thinking` field, the
renderer puts thinking text in a collapsible block *above* the assistant
body. `assistant-markdown.tsx` itself does not own the thinking-block
logic — see Chapter 1 for that.

## Why this pattern

- **Standard, well-trodden libraries.** `react-markdown` + `remark-gfm`
  (GitHub-flavored Markdown) + `rehype-highlight` (highlight.js) is the
  default stack and unlikely to surprise.
- **Theming via CSS variables.** Component overrides reference
  `--fg`, `--surface`, `--border`, `--accent`, `--dim`. The Markdown
  renderer thereby inherits the agent surface theme automatically.
- **Robust to malformed input.** `MarkdownErrorBoundary` falls back to a
  preformatted `<pre>` — a stuck token stream or invalid table never
  takes down the chat pane.
- **Affordance for code blocks.** Auto-detected language + per-block
  copy button is the lowest-effort UX upgrade for a chat surface.

## Trade-offs

- **Bundle size.** `highlight.js` ships every language by default unless
  you tree-shake. `rehype-highlight` with `{ detect: true }` keeps the
  full bundle.
- **No XSS scope checks beyond `react-markdown`.** Links use
  `target="_blank" rel="noreferrer noopener"` (good), but no
  `rehype-sanitize` is configured. `react-markdown` defaults to safe
  output, but a future custom component override could leak.
- **No streaming-friendly rendering hint.** Tokens trickle in and the
  whole document re-parses each frame. For long assistant turns this is
  wasteful; a real streaming markdown renderer would maintain partial
  AST state.
- **No `KaTeX`, no Mermaid.** The renderer is plain Markdown; there's no
  math or diagram support out of the box.

## Cross-references

- [Chapter 1 — `chat-pane-deep-dive.md`](../chapter-01-frontend/chat-pane-deep-dive.md) — how the chat pane composes `AssistantMarkdown` with thinking blocks, tool calls, and the streaming reducer.
- [Chapter 1 — `modifications-inventory.md`](../chapter-01-frontend/modifications-inventory.md) — record of when the Markdown stack landed.
