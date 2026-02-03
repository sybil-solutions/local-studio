---
name: vllm-studio
description: Use when setting up, deploying, or operating vLLM Studio (env keys, controller/frontend startup, Docker services, branch workflow, and release checklists).
---

# vLLM Studio Operations

## Overview
This skill covers operational workflows for vLLM Studio: local setup, deployment, environment keys, branch hygiene, and verification steps.

## When To Use
- Setting up a new workstation or server.
- Deploying controller/frontend updates.
- Rotating API keys or changing environment settings.
- Preparing a release or syncing branches.

## Quick Start
- Read `references/env-and-keys.md` to set required env variables.
- Read `references/deployment.md` for local and server deploy flows.
- Read `references/branches.md` for branch and release hygiene.

## Workflow (Short)
1. Ensure `.env` is configured and Docker services are up (if used).
2. Build/test controller + frontend.
3. Deploy controller (port 8080) and rebuild frontend.
4. Verify OpenAI-compatible endpoints and `/chat` UI.
5. Tag release and update changelog.

## References
- `references/env-and-keys.md` for env variables and API keys.
- `references/deployment.md` for local + production deployment commands.
- `references/branches.md` for branch checkout, merge, and release steps.
