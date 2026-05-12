# vLLM Studio Context

## Domain language

- **Controller**: the local or remote process exposing vLLM Studio runtime, model, recipe, metrics, and log APIs.
- **Agent workspace**: the `/agent` surface where projects, panes, sessions, composer state, browser/computer tools, and Pi runtime state meet.
- **Project**: a user-selected filesystem root used as the working directory for agent sessions.
- **Session**: a chat/run record with local UI state, runtime session id, optional Pi session id, messages, queue, and tool selections.
- **Pane**: a visible workspace slot that owns one active session id and optional split layout state.
- **Tool catalogue**: available plugins and skills that can be attached to a session from the composer.
- **Runtime stream**: SSE status and Pi events used to update a session while a run is active or being reattached.
- **Settings surface**: the `/settings` page that owns controller connection, archived chats, plugin/skill registry, setup, and appearance knobs.
- **Usage surface**: the `/usage` page that renders provider and Pi session analytics.
- **Recipe surface**: the `/recipes` page used for model discovery, launch recipes, downloads, and runtime setup.

## Architecture direction

The cleanup target is to keep UI modules thin and move behavior into deep modules with typed interfaces:

- Agent workspace behavior should live behind workspace/session/tool seams, not inside large UI modules.
- Browser and Computer Use plumbing should use adapters at typed seams so tests can swap runtime dependencies.
- Data pages should share page-state and refresh primitives instead of reimplementing loading/error controls.
- Lint and coverage should be ratchets: warnings expose current debt, errors block new regressions.
