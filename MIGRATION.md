# Migration Status

| Domain | Phase | Notes |
| --- | --- | --- |
| frontend/src/app/ | In progress | Updated chat layout CSS so the agent thread column uses the composer width, keeping user message width aligned with the composer instead of spilling wider than it. Added prompt minimap marker/popup styles in `frontend/src/app/styles/globals/chat.css` for the agent timeline prompt navigation feature. Renamed app-facing Local Studio environment variables, cache keys, download patterns, and setup/proxy copy under `frontend/src/app/`. |
| controller/src/modules/ | In progress | Renamed controller module-owned product identifiers, environment variables, metric names, Docker resource names, OpenAPI owner fields, and user-facing messages from the previous product name to Local Studio naming. |
| shared/src/ | Not changed this turn | No migration-target changes made in this domain. |
| cli/src/ | In progress | Renamed CLI API defaults, config keys, render copy, and headless/input environment variable references from the previous product name to Local Studio naming. |
