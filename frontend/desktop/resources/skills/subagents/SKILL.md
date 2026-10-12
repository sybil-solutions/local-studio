---
name: subagents
description: Delegate self-contained work to parallel subagent sessions — when a task splits into independent chunks (research several areas at once, review many files, try approaches in parallel), or when the user asks to fan out, parallelize, or run something in the background.
---

# Subagents

A subagent is an independent child agent session this session spawns. It runs in the same project directory with its own fresh context, works with the same tools, and hands back one final report. It cannot see this conversation, and you cannot see its progress except through its report and `subagent_status`. At most 4 run at once per session, and a subagent cannot spawn its own.

Reach for subagents when work is parallelizable and self-contained: sweeping several parts of a codebase, reviewing independent files, researching separate questions, or generating alternatives to compare. Skip them for small sequential tasks — a subagent costs a session start and only communicates once.

## Tools

- `subagent` — spawn one child and wait for its report (up to 15 minutes; a child still working after that keeps running and stays reachable). Call it several times in one turn to fan out — the calls run concurrently.
- `subagent_list` — every child this session spawned, with the run ids the other tools need.
- `subagent_status` — one child's state and whatever report text it has written so far; usable mid-run.
- `subagent_stop` — stop one running child and free its slot; returns its partial work.

## Writing the task

The task is the child's entire world — it has no memory of this chat. Include:

1. What to do, concretely: files, paths, names, URLs.
2. What the finished report must contain, so the child knows when it is done.
3. Any constraints you would otherwise have said mid-conversation (do not edit files, stay in directory X, prefer approach Y).

Give each child a short name that says what it is doing ("api auditor", "docs sweep") — the names label the progress chips the user sees.

## Protocol

1. Split the work so children do not overlap — two children editing the same file will race each other.
2. Fan out in one turn: issue all the `subagent` calls together rather than one per turn.
3. When a wait elapses with the child still working, do not respawn it — check `subagent_status` with its run id, and only `subagent_stop` it if the work is no longer needed.
4. Synthesize the reports yourself. Each child saw only its slice; contradictions between reports are yours to resolve before answering the user.
