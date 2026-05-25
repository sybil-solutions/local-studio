# Agent Workspace

The agent workspace (`/agent`) is the main surface — a multi-pane chat environment where you converse with an AI agent that can browse the web, edit files, run terminal commands, manage git, and use plugins and skills.

---

## Projects

A **project** is a local directory you give the agent access to. The project defines:

- **Working directory** — where the agent reads, writes, and runs commands
- **Git scope** — which branch and repo the Git panel tracks
- **File access boundary** — the agent can only see files within the project

### Adding a project

Click **Add a project** in the left sidebar, or use the empty-state prompt on the workspace page. Pick a local folder — the agent is now scoped to that directory.

Switch projects from the sidebar dropdown at any time. Sessions are per-project — changing projects shows the sessions for that project.

---

## Sessions

A **session** is a single conversation — messages, tool calls, and run status. Sessions persist automatically and can be reopened later.

### Creating a session

- Click the **+** button in the pane header
- Navigate to `/agent?new=1`
- Start typing in the composer — a new session creates automatically

### Session tabs

Each pane shows tabs for its open sessions. Click a tab to switch conversations without changing your layout. Sessions survive pane closures — closing a pane doesn't delete the session.

---

## Panes

Panes are the layout slots that hold chat sessions. You can split, resize, and rearrange them.

| Action | How |
|---|---|
| **Split horizontally** | Drag a session tab to the left or right edge of a pane |
| **Split vertically** | Drag a session tab to the top or bottom edge of a pane |
| **Resize** | Drag the divider between panes |
| **Move a session** | Drag its tab to another pane |
| **Close a pane** | Click the close button on the pane header |

The layout persists — reopening the workspace restores your panes.

---

## The Composer

The composer is the text input at the bottom of each chat pane. Beyond typing messages, it supports three ways to give the agent context.

### @mentions — plugins and MCP tools

Type `@` in the composer to bring up the plugin catalogue. Select one or more plugins — they appear as pills above the input. Plugins give the agent access to external tools via MCP (Model Context Protocol).

Common plugins include browser automation, filesystem operations, and API integrations. The catalogue loads from the controller's plugin registry.

### $mentions — skills

Type `$` to bring up available skills. Skills inject instructions into the agent's prompt — they're prompt modifiers, not tools. For example, a "code review" skill tells the agent to adopt a reviewer persona.

### File attachments

Drag files from your filesystem into the composer, or paste them from the clipboard. Text files under 350 KB are inlined as code blocks. Images under 1.5 MB are attached as data URLs. Larger files pass as metadata only. Attached files appear as pills above the composer — click one to remove it.

On the desktop app, file paths from your local machine are included automatically.

### Sending a message

Press **Enter** (or click the send button) to submit. The session status changes through:

| Status | What's happening |
|---|---|
| `idle` | Waiting for input |
| `running` | Agent is processing — messages stream in real time |
| `error` | Something went wrong — check the message for details |

You can queue a follow-up message while the agent is running — it will send as soon as the current run finishes.

---

## The Right Panel

The right panel is a resizable sidebar with six tabs. Drag the left edge to resize; click the close button to hide it. Panel width persists across sessions.

### Browser

Two modes, toggled from the URL bar:

- **Live mode** (desktop app) — renders pages in an embedded browser. The agent can interact with pages directly.
- **Reading mode** (browser / fallback) — fetches pages through the controller, strips styling, and renders clean text. Works past CSP and X-Frame-Options restrictions.

The start page discovers running localhost servers and shows them as clickable cards. You can also type any URL directly.

### Filesystem

A tree browser for the project directory. Features:

- Expand and collapse folders
- Search by filename
- Click a file to view it with syntax highlighting
- Preview toggle — renders HTML and Markdown files in-place
- Font size controls

### Git

Diff viewer for the project's git repository. Shows staged and unstaged changes in unified or side-by-side view. Actions:

- Switch branches
- Stage all and commit with a message
- Push to remote
- Open a PR link
- `git init` if the project isn't already a repo

### Terminal

An xterm.js terminal scoped to the project's working directory. The agent can run commands here, and you can type directly. Use it to verify what the agent did, run git commands, or inspect files.

### Canvas

A shared scratchpad — both you and the agent can read and write it. Toggle it on from the panel launcher. Content syncs to the controller. Useful for passing notes, draft content, or instructions between you and the agent.

---

## Before you start

You need a running model. If you haven't set one up yet, head to [Recipes & Models](./recipes.md) first.

---

## Settings

Agent-related settings live in the main **Settings** page (`/settings`):

| Section | What you configure |
|---|---|
| **API connection** | Controller URL, API key, voice URL |
| **Appearance** | Theme |
| **Engines** | Backend engine configuration |

Tool selections (which `@plugins` and `$skills` you've picked) are saved per session and persist across restarts.

---

## Example workflow

1. **Add a project** — pick a local directory from the sidebar
2. **Create a session** — click **+** to start a new conversation
3. **Attach tools** — type `@` and pick a browser plugin, then `$` for a skill
4. **Send a message** — "Review the README and suggest improvements"
5. **Watch the right panel** — the agent browses files in the Filesystem tab, shows diffs in the Git tab, and streams its response in the chat pane
6. **Review and iterate** — open the Terminal to verify changes, check the Git diff, send a follow-up

---

[← Back to docs index](./README.md)
