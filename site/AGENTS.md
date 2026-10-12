# Agent instructions

## Local server policy

- Never start a local HTTP server from an agent tool call.
- Forbidden commands include `pnpm dev`, `pnpm dev:lan`, `pnpm preview`, `vite`, `vite preview`, and equivalent direct or background commands.
- Do not run local Playwright E2E or visual commands that depend on a web server. The user starts the server manually.
- Build, typecheck, lint, unit, and static validation commands are allowed only when they do not start a server.
- Do not bypass this policy with raw Node scripts, shell backgrounding, alternate ports, or detached processes.
