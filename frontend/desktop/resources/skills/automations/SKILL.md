---
name: automations
description: Manage Local Studio automations — scheduled prompts the app re-runs on its own — when the user asks to schedule, pause, resume, edit, inspect or delete recurring work, or asks what a scheduled job has been doing.
---

# Automations

An automation is a saved prompt Local Studio re-runs on a schedule. By default each run happens in its own fresh session that cannot see this conversation, in a project directory, on a model; an automation can instead be attached to an existing session, and then every run continues that thread. Automations are the same records the user sees in the Automations tab — the tools below read and write that one store, so anything you change shows up there immediately, and anything the user changes there is what you will read back.

Use these tools whenever the user wants work to keep happening without them asking again ("every morning…", "check on this hourly", "remind me weekly"), and whenever they ask about a job that is already scheduled.

## Tools

- `list_automations` — every automation: id, schedule, active/paused, next run, how the last run ended.
- `read_automation` — one automation in full: its exact prompt, model, directory, and its run history (last 20 runs, with what each run reported).
- `schedule_automation` — create one.
- `update_automation` — change name, prompt, schedule, model, directory or session in place.
- `set_automation_status` — pause or resume.
- `run_automation_now` — run it immediately and report the outcome; waits for the run to finish.
- `delete_automation` — remove it and its history, permanently.

## Where a run happens

Runs are fresh by default: no memory of earlier runs, so the prompt has to carry everything the run needs. Pass `sessionId` to `schedule_automation` or `update_automation` to attach the automation to an existing chat instead — the run resumes that session, reads what is already in it, and appends its work to that thread. Pass `sessionId: ""` to detach and go back to fresh runs.

Attach when the recurring work only makes sense as a continuation ("keep updating the migration notes in this thread"). Leave it fresh when each run should stand alone. A session that has been deleted does not break the automation: that run falls back to a fresh session and records why in its summary, which `read_automation` shows.

## Schedule format

Every schedule is one of three shapes:

- `{ kind: "interval", minutes: 30 }` — every 30 minutes (minimum 1).
- `{ kind: "daily", time: "08:00" }` — every day at 08:00 local time; add `weekdaysOnly: true` to skip Saturday and Sunday.
- `{ kind: "weekly", day: 1, time: "09:30" }` — once a week; `day` is 0 for Sunday through 6 for Saturday.

Times are 24-hour `HH:MM` in the machine's local time. A schedule that does not parse is rejected by the tool rather than silently rewritten, so fix the arguments instead of retrying blindly.

## Protocol

1. Call `list_automations` before anything else that names an automation. The ids are opaque (`auto-1a2b3c4d`) and are the only handle the other tools accept — never invent one or reuse one from earlier in the conversation without re-listing.
2. Write the prompt to stand alone. The run has no memory of this chat: name the files, repos, URLs and success criteria it needs, and say what it should produce.
3. Editing beats re-creating. `update_automation` keeps the run history; deleting and re-creating throws it away and gives the user a new id for the same job.
4. After creating or editing something the user is relying on, call `run_automation_now` once to prove it works, then report what it actually returned. A run that completes can still report a failure.
5. When asked how a scheduled job is doing, read `read_automation` and answer from the run history — outcomes and what each run said — not from the fact that the automation exists.
6. Pause, do not delete, when the user wants a job to stop for now. Only `delete_automation` when they clearly want it gone; it cannot be undone.
7. Say the schedule back in plain words when you confirm ("every weekday at 08:00"), mention the next run time the tool returned, and say whether runs are fresh or continue a session.
