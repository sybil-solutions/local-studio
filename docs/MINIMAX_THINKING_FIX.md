# MiniMax-M2.1 Infinite Thinking Loop Fix

## Problem

MiniMax-M2.1 models were generating unlimited reasoning/thinking tokens, causing them to loop indefinitely in the `` tags before producing a final answer. This resulted in:
- Never-ending responses
- Excessive token usage
- Wasted compute resources
- Poor user experience

## Solution

Implemented server-level `max_thinking_tokens` limit for MiniMax-M2 models using vLLM's `--default-chat-template-kwargs` parameter.

## Implementation Details

### Changes to `controller/backends.py`

1. **Added `_get_default_chat_template_kwargs()` function** (lines 72-91):
   - Automatically detects MiniMax-M2 models by name
   - Sets `max_thinking_tokens=64000` for standard MiniMax-M2.1
   - Sets `max_thinking_tokens=128000` for MiniMax-M2.1-REAP-50 (longer context variant)
   - Returns None for non-MiniMax models

2. **Updated `build_vllm_command()` function** (lines 138-145):
   - Calls `_get_default_chat_template_kwargs()` to get default limits
   - Merges with user-provided kwargs (user override takes precedence)
   - Adds `--default-chat-template-kwargs` flag to vLLM command

### Configuration Values

| Model | max_thinking_tokens | Context Length |
|-------|-------------------|----------------|
| MiniMax-M2.1 | 64,000 | Standard |
| MiniMax-M2.1-REAP-50 | 128,000 | Extended |

## How It Works

When a MiniMax-M2 model is launched, the controller now automatically adds:

```bash
vllm serve MiniMaxAI/MiniMax-M2.1 \
  --reasoning-parser minimax_m2_append_think \
  --default-chat-template-kwargs '{"max_thinking_tokens": 64000}'
```

This tells vLLM to:
1. Use the `minimax_m2_append_think` parser to extract reasoning content
2. Limit thinking tokens to 64,000 before requiring the model to produce the final answer

## User Override

Users can customize the limit by adding to their recipe:

```yaml
extra_args:
  default_chat_template_kwargs:
    max_thinking_tokens: 32000  # Custom limit
```

## Testing

Run the test script to verify the configuration:

```bash
python3 scripts/test_minimax_config.py
```

Expected output:
```
✓ MiniMax-M2.1 standard: max_thinking_tokens=64000
✓ MiniMax-M2.1-REAP-50: max_thinking_tokens=128000
✓ User override: max_thinking_tokens=32000 (custom)
✓ Non-MiniMax models: no max_thinking_tokens added

All tests PASSED ✓
```

## Benefits

1. **Prevents infinite loops** - Model must stop thinking after hitting the token limit
2. **Maintains reasoning capability** - Still gets substantial thinking space (64K-128K tokens)
3. **Automatic** - No manual configuration needed for standard deployments
4. **Flexible** - Users can override defaults if needed
5. **Model-specific** - Only affects MiniMax-M2 models, not other reasoning models

## References

- [vLLM Reasoning Outputs Documentation](https://docs.vllm.ai/en/latest/features/reasoning_outputs/)
- [MiniMax-M2.1 vLLM Deployment Guide](https://huggingface.co/MiniMaxAI/MiniMax-M2.1/blob/main/docs/vllm_deploy_guide.md)
- [vLLM Recipes: MiniMax-M2](https://docs.vllm.ai/projects/recipes/en/latest/MiniMax/MiniMax-M2.html)<tool_call>
