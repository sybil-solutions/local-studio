---
name: vllm-studio-backend
description: Use when working on vLLM Studio backend architecture (controller runtime, Pi-mono agent loop, OpenAI-compatible endpoints, LiteLLM gateway, inference process, and debugging commands).
---

# vLLM Studio Backend Architecture

## Overview
This skill explains how the backend is wired: controller runtime, OpenAI-compatible proxy, Pi-mono agent loop, LiteLLM gateway, and inference process management.

## When To Use
- Modifying controller routes or run streaming.
- Debugging OpenAI-compatible endpoint behavior.
- Updating Pi-mono agent runtime or tool execution.
- Understanding how inference + LiteLLM fit together.

## Quick Start
- Read `references/backend-architecture.md` for the component map and data flow.
- Read `references/openai-compat.md` for `/v1/models` and `/v1/chat/completions` behavior.
- Read `references/backend-commands.md` for useful run/debug commands.

## Core Guarantees
- Keep OpenAI-compatible endpoints stable (`/v1/models`, `/v1/chat/completions`).
- `/chat` UI uses controller run stream (`/chats/:id/turn`) and Pi-mono runtime.
- Tool execution happens server-side (MCP + AgentFS + plan tools).

## References
- `references/backend-architecture.md`
- `references/openai-compat.md`
- `references/backend-commands.md`
