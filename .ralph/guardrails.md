# Ralph Guardrails

## Sign: Avoid hidden destructive git operations
- Trigger: need to reset branches or rewrite history
- Instruction: avoid git reset --hard; use safe alternatives or note divergence
- Added after: policy blocked git reset
