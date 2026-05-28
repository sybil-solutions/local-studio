# UI Kit

`frontend/src/components/ui-kit/` contains shared visual primitives used by frontend surfaces that need consistent panel, badge, timeline, modal, and metric styling.

## Purpose

The UI kit keeps repeated visual structure out of feature components. Feature components should map data and behavior; UI kit components should provide the reusable surface, tone, and layout primitives.

## What Is In Use

- `types.ts`: shared `UiTone` contract.
- `configs.ts`: tone mappings and theme-variable expectations.
- `primitives.tsx`: reusable UI components:
  - `UiPanelSurface`
  - `UiStatusBadge`
  - `UiTimelineMarker`
  - `UiPulseLabel`
  - `UiStatusPill`
  - `UiMetricTile`
  - `UiInsetSurface`
  - `UiModal`
  - `UiModalHeader`

## Usage Rules

1. Prefer these primitives when a feature needs an existing shared visual pattern.
2. Use theme variables and tone config instead of hardcoded colors.
3. Keep feature-specific data fetching, state, and event handling outside this folder.

## Where To Look

- `primitives.tsx`: component implementations.
- `configs.ts`: tone and theme mapping.
- `types.ts`: exported UI kit types.
