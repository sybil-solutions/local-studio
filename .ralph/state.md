# Ralph State

- iteration: 6
- task: "Fix config settings save failure and persist API settings"
- completion_criteria:
  - POST /api/settings succeeds without 500s
  - data/api-settings.json updates on save
  - Frontend container writes settings on server
  - Lint/typecheck/build pass
  - Backend + frontend deployed; API health checks pass
