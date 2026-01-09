# INTELLECT-3 Tool Calling Fix

## Problem

When running INTELLECT-3 models, the thinking/reasoning output was correct, but tool calling was not working properly. The initial fix attempted to use the `glm45` parser (since INTELLECT-3 is based on GLM-4.5-Air), but this resulted in empty tool names because INTELLECT-3 outputs a different format.

## Root Cause

**Initial misdiagnosis:** We assumed INTELLECT-3 used the same tool call format as GLM-4.5.

**Actual issue:** The `glm45` parser expects this format:
```
<tool_call>function_name
<arg_key>key</arg_key><arg_value>value</arg_value>
</tool_call>
```

But INTELLECT-3 outputs JSON inside the tags:
```
<tool_call>{"name": "function_name", "arguments": {"key": "value"}}</tool_call>
```

The `glm45` parser's regex `r"<tool_call>([^\n]*)\n(.*)</tool_call>"` captures an empty string for the function name when there's a newline or JSON right after `<tool_call>`.

## Solution

Use the `hermes` tool call parser for INTELLECT-3, which correctly handles JSON inside `<tool_call>` tags.

### `controller/backends.py`

- `_get_default_tool_call_parser()` now detects:
  - GLM-4.5, GLM-4.6, GLM-4.7 → `glm45` parser (native format with `<arg_key>`/`<arg_value>` tags)
  - INTELLECT-3 → `hermes` parser (JSON format inside `<tool_call>` tags)
- `_get_default_reasoning_parser()` detects:
  - INTELLECT-3 → `deepseek_r1` parser
  - GLM-4.5/4.6/4.7 → `glm45` parser
  - MiniMax M2 → `minimax_m2_append_think` parser

## Testing

Tests in `tests/test_tool_call_parser_auto_detection.py`:

- ✅ INTELLECT-3 auto-detects `hermes` tool call parser
- ✅ INTELLECT-3-AWQ auto-detects `hermes` tool call parser
- ✅ GLM-4.7 auto-detects `glm45` tool call parser
- ✅ GLM-4.7 reasoning parser auto-detection (`glm45`)
- ✅ INTELLECT-3 reasoning parser auto-detection (`deepseek_r1`)
- ✅ Explicit tool_call_parser overrides auto-detection
- ✅ Models without auto-detection don't get parser by default
- ✅ MiniMax M2 auto-detection still works

## Parser Configuration

For INTELLECT-3 models:
- **Tool Call Parser**: `hermes` (handles JSON in `<tool_call>` tags)
- **Reasoning Parser**: `deepseek_r1` (for thinking/reasoning tokens)

For GLM-4.x models:
- **Tool Call Parser**: `glm45` (native GLM format)
- **Reasoning Parser**: `glm45`

## vLLM Command Generated

```bash
vllm serve /mnt/llm_models/INTELLECT-3-REAP-50-W4A16 --host 0.0.0.0 --port 8000 ... \
  --tool-call-parser hermes --enable-auto-tool-choice \
  --reasoning-parser deepseek_r1
```
