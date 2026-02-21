<!-- CRITICAL -->
# AGENTS.md

## About This Repo

vLLM Studio is a model lifecycle manager for local LLM inference servers (vLLM, SGLang, llama.cpp, TabbyAPI). It provides a Next.js frontend for chat, model management, analytics, and MCP tool integration, backed by a Bun/Hono/SQLite controller that orchestrates everything.

The production instance runs on a Linux server at `192.168.1.70`. The frontend is served via Docker on port 3000, and the controller runs natively on port 8080.

## Development Environment

### Connecting to the Server

```bash
ssh -i ~/.ssh/linux-ai ser@192.168.1.70
cd /home/ser/workspace/projects/lmvllm
```

### Service Layout (Remote)

| Service | How it runs | Port |
|---------|------------|------|
| Frontend | Docker container (`vllm-studio-frontend`) | 3000 |
| Controller | Native Bun process | 8080 |
| LiteLLM | Docker container | 4100 |
| PostgreSQL | Docker container | 5432 |
| Redis | Docker container | 6379 |
| Prometheus | Docker container | 9090 |

### Starting/Restarting Services

```bash
# Controller (native bun - NOT snap bun)
cd /home/ser/workspace/projects/lmvllm
# If 8080 is already bound, stop old controllers first:
pkill -f "[b]un controller/src/main.ts" || true
nohup ~/.bun/bin/bun run controller/src/main.ts > /tmp/controller-stdout.log 2>&1 &

# Frontend (Docker)
docker compose up -d --build frontend

# All Docker services
docker compose up -d
```

### Deploying Changes

Edit locally, then SCP to the server:
```bash
scp -i ~/.ssh/linux-ai <local-file> ser@192.168.1.70:/home/ser/workspace/projects/lmvllm/<remote-path>
```

After copying, restart the affected service (controller or frontend).

---

## MANDATORY: Lint and Build Checks

**Every change MUST pass lint and build before committing. Zero errors, zero warnings.**

### Frontend (Next.js)

```bash
cd frontend
npm run lint   # MUST pass with no errors or warnings
npm run build  # MUST succeed
```

- Fix all ESLint errors and warnings before proceeding
- Fix all TypeScript type errors before proceeding
- Do NOT commit code that fails lint or build

### Controller (Bun/TypeScript)

```bash
cd controller
npx tsc --noEmit  # MUST pass with no type errors
```

### Swift Client

```bash
cd swift-client
./setup.sh  # Regenerate Xcode project
xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio \
  -destination 'generic/platform=iOS Simulator' clean build
# Exit code MUST be 0
```

---

## Swift Build Requirements

**BEFORE MAKING ANY SWIFT CHANGES, READ THIS ENTIRE SECTION.**

### Mandatory Pre-Commit Checks

1. **REGENERATE XCODE PROJECT AFTER ANY FILE CHANGES**
   ```bash
   cd swift-client && ./setup.sh
   ```
   New/moved/renamed files are NOT automatically included in the Xcode project.

2. **COMMON ERRORS TO AVOID**

   - Using undefined functions across file boundaries (move to same file or mark public)
   - Enum cases without full qualification (use `ColorScheme.dark` not `.dark`)
   - Duplicate initializers across files (use optional params on original init)
   - Missing imports (`UIKit`, `SwiftUI`, `Foundation`, `AVFoundation`, `PhotosUI`) -- do NOT assume transitive imports

3. **SCOPE AND VISIBILITY**
   - Private members are file-scoped and NOT accessible across extensions
   - When splitting a file: move related private methods together, change visibility to internal, or consolidate into one file

### Common Fix Patterns

| Error | Fix |
|-------|-----|
| Cannot find 'X' in scope | Move function to same file OR make it public |
| Cannot find type 'X' | Run `./setup.sh` to regenerate project |
| Cannot infer contextual base | Use full type name (`ColorScheme.dark`) |
| Extra arguments at positions | Check for duplicate inits across files |
| Has no member 'Y' | Add missing import |

---

## Repository Conventions

- **60 LOC limit**: Files >60 lines MUST start with a CRITICAL marker:
  - `// CRITICAL` (Swift, TypeScript/JavaScript)
  - `# CRITICAL` (shell, YAML, `.gitignore`, `.env`, TOML)
  - `<!-- CRITICAL -->` (Markdown/HTML/XML)
  - `/* CRITICAL */` (CSS)
- **Exemptions**: Machine-generated files (`package-lock.json`, `bun.lock`, `*.pbxproj`, `LICENSE`)
- **Shebang files**: Keep shebang on line 1, CRITICAL marker on line 2
- **20 files per directory**: Create subdirectories when exceeded
- **kebab-case naming**: ALL files/directories (`my-component.tsx` NOT `MyComponent.tsx`)

---

## Final Checklist Before Completing Work

- [ ] `npm run lint` passes with no errors or warnings (frontend)
- [ ] `npm run build` succeeds (frontend)
- [ ] `npx tsc --noEmit` passes (controller)
- [ ] Swift builds without errors (if swift-client changed)
- [ ] Xcode project regenerated with `./setup.sh` (if swift-client changed)
- [ ] No files >60 LOC without a CRITICAL marker
- [ ] No directories >20 files
- [ ] All filenames use kebab-case
- [ ] Runtime docs and API references include `/runtime/*` and upgrade payload guidance
- [ ] Keep runtime UI and controller upgrade route contracts in lock-step (`/runtime/*`).

**IF ANY ITEM FAILS, FIX IT BEFORE CLAIMING COMPLETION.**

---

## Codex Skills (Repo-Scoped)

Use these skills when working on operations or backend architecture:
- `skills/vllm-studio` -- setup, deployment, env keys, releases
- `skills/vllm-studio-backend` -- controller/runtime architecture + OpenAI-compatible endpoints

```bash
cp -R skills/vllm-studio ~/.codex/skills/
cp -R skills/vllm-studio-backend ~/.codex/skills/
```
