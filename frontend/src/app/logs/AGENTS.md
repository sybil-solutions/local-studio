# frontend/src/app/logs/AGENTS.md

Log viewer - inference server logs.

## Structure

```
logs/
└── page.tsx    # Log viewer component
```

## Features

### Session Overview
- List available log sessions (from `/logs`)
- Select session to view tail content

### Log Filtering
- Search within logs (client-side)
- Session filter by model/id

### Log History
- Load last N lines via `/logs/:sessionId`
- Auto-refresh polling (optional)
- Download log file (client-side)

## API Integration

| Endpoint | Purpose |
|----------|---------|
| `GET /logs` | List log sessions |
| `GET /logs/:sessionId?limit=N` | Tail last N lines |
| `DELETE /logs/:sessionId` | Remove log file |
| `GET /logs/:sessionId/stream` | SSE stream (available, not wired in UI yet) |
| `GET /events` | Global SSE stream (available, not wired in UI yet) |

## Log Sources

Logs come from:
1. vLLM/SGLang stdout/stderr
2. Controller operations
3. Model loading progress
4. Request/response traces

## UI Components

- **LogViewer** - Main scrollable log display
- **LogLine** - Individual log entry with level coloring
- **LogFilter** - Level and search filters
- **LogControls** - Auto-scroll, download, clear

---

## Codex Skills

- `skills/vllm-studio` — ops/deploy/env keys.
- `skills/vllm-studio-backend` — backend architecture + OpenAI compatibility.
