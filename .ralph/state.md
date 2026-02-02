# Ralph State

- iteration: 1
- task: "Phase 1.2: Add run persistence schema + tool linkage fixes"
- completion_criteria:
  - chat_messages has tool_call_id + name columns
  - chat_runs, chat_run_events, chat_tool_executions tables exist
  - routes accept tool_call_id + name and persist correctly
  - controller tests added and passing for new schema
