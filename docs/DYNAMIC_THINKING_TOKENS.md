# Dynamic Thinking Token Allocation

## Overview

This system implements **research-backed dynamic token allocation** for reasoning models like MiniMax-M2.1, preventing infinite thinking loops while maintaining model performance.

Based on cutting-edge research:
- **SelfBudgeter**: 61% token reduction with maintained accuracy
- **Plan-and-Budget**: 39% reduction with 70% accuracy improvement
- **MiniMax-M2 interleaved thinking** best practices

## Problem Solved

MiniMax-M2 models were generating unlimited reasoning tokens, causing:
- Never-ending responses in `` tags
- Excessive token usage and compute costs
- Poor user experience

## Solution

Dynamic `max_thinking_tokens` limits that adapt based on:
1. **Model type** (MiniMax-M2, GLM, DeepSeek-R1)
2. **Thinking mode** (conservative/balanced/aggressive/disabled)
3. **User overrides** (explicit values)

## Usage

### 1. Default (Auto Mode)

```python
from controller.models import Recipe

recipe = Recipe(
    id='minimax-m21',
    name='MiniMax-M2.1',
    model_path='MiniMaxAI/MiniMax-M2.1',
    backend='vllm',
    # Default: thinking_mode='auto'
)
```

Result: `max_thinking_tokens=64000` (standard reasoning depth)

### 2. Conservative Mode (Quick Responses)

```python
recipe = Recipe(
    id='minimax-m21-quick',
    name='MiniMax-M2.1 Quick',
    model_path='MiniMaxAI/MiniMax-M2.1',
    backend='vllm',
    thinking_mode='conservative'  # 4x less thinking
)
```

Result: `max_thinking_tokens=16000` (minimal thinking for fast responses)

**Use cases:**
- Simple Q&A
- Chatbots
- Customer service
- Real-time applications

### 3. Aggressive Mode (Complex Tasks)

```python
recipe = Recipe(
    id='minimax-m21-complex',
    name='MiniMax-M2.1 Complex',
    model_path='MiniMaxAI/MiniMax-M2.1',
    backend='vllm',
    thinking_mode='aggressive'  # 2x more thinking
)
```

Result: `max_thinking_tokens=128000` (deep reasoning for complex tasks)

**Use cases:**
- Multi-step code generation
- Complex problem solving
- Research and analysis
- Architectural design

### 4. Disabled Mode (No Thinking)

```python
recipe = Recipe(
    id='minimax-m21-no-thinking',
    name='MiniMax-M2.1 No Thinking',
    model_path='MiniMaxAI/MiniMax-M2.1',
    backend='vllm',
    thinking_mode='disabled'  # Disable reasoning
)
```

Result: `enable_thinking=false` (no `` phase)

**Use cases:**
- Simple generation tasks
- When reasoning isn't needed
- Faster response times

### 5. Explicit Override

```python
recipe = Recipe(
    id='minimax-m21-custom',
    name='MiniMax-M2.1 Custom',
    model_path='MiniMaxAI/MiniMax-M2.1',
    backend='vllm',
    thinking_mode='auto',
    max_thinking_tokens=42000  # Custom value
)
```

Result: `max_thinking_tokens=42000` (your exact limit)

## Token Allocation Table

| Model              | Auto    | Conservative | Balanced | Aggressive | Disabled |
|--------------------|---------|--------------|----------|------------|----------|
| **MiniMax-M2.1**   | 64,000  | 16,000       | 64,000   | 128,000    | 0        |
| **MiniMax-M2.1-REAP-50** | 128,000 | 32,000    | 128,000  | 256,000    | 0        |
| **GLM-4.7**        | 32,000  | 8,000        | 32,000   | 64,000     | 0        |
| **DeepSeek-R1**    | 64,000  | 16,000       | 64,000   | 128,000    | 0        |

## Implementation Details

### Files Modified

1. **`controller/models.py`**
   - Added `max_thinking_tokens` field (explicit override)
   - Added `thinking_mode` field (conservative/balanced/aggressive/disabled/auto)

2. **`controller/thinking_config.py`** (new file)
   - `calculate_thinking_tokens()`: Dynamic allocation logic
   - `get_chat_template_kwargs()`: Build kwargs for vLLM

3. **`controller/backends.py`**
   - Imports `get_chat_template_kwargs` from thinking_config
   - Applies kwargs to vLLM command

### How It Works

1. **User creates recipe** with optional `thinking_mode` and `max_thinking_tokens`
2. **Controller calculates** optimal limit based on model type and mode
3. **vLLM launches** with `--default-chat-template-kwargs` flag
4. **Model generates** response with limited thinking tokens
5. **Response stops** when thinking token limit is reached

### Example vLLM Command

```bash
vllm serve MiniMaxAI/MiniMax-M2.1 \
  --reasoning-parser minimax_m2_append_think \
  --default-chat-template-kwargs '{"max_thinking_tokens": 64000}'
```

## Research Backing

### SelfBudgeter (2025)
- **Finding**: 61% token reduction with maintained accuracy
- **Method**: Adaptive token allocation based on task complexity
- **Result**: Models stop "overthinking" simple problems

### Plan-and-Budget (2025)
- **Finding**: 39% reduction with 70% accuracy improvement
- **Method**: Dynamic budget allocation for sub-questions
- **Result**: Better resource utilization

### MiniMax-M2 Best Practices
- **Finding**: Interleaved thinking improves agentic performance
- **Method**: Separate reasoning from final output
- **Result**: Transparent, traceable reasoning steps

## Recommendations

### When to Use Each Mode

**Conservative** (16K-32K tokens)
- Simple queries (FAQ, basic questions)
- Chat applications
- Customer service
- Real-time interactions

**Balanced/Auto** (64K-128K tokens)
- General-purpose tasks
- Most coding tasks
- Standard reasoning
- Default choice

**Aggressive** (128K-256K tokens)
- Complex multi-step problems
- Architectural design
- Research tasks
- When you need maximum reasoning depth

**Disabled** (0 tokens)
- Simple generation
- When reasoning adds no value
- Fastest response times needed
- Non-agentic workflows

### Fine-Tuning

If you find the defaults aren't optimal for your use case:

1. Start with `thinking_mode='balanced'` (auto)
2. Monitor actual thinking token usage in your logs
3. Adjust mode based on your patterns:
   - Models hit limit too often → Increase (aggressive)
   - Models waste tokens → Decrease (conservative)
4. Use explicit `max_thinking_tokens` for fine control

### Performance vs. Token Trade-off

More thinking tokens ≠ better results. Research shows:
- **Conservative mode** often sufficient for simple tasks
- **Balanced mode** optimal for most workloads
- **Aggressive mode** only helps for genuinely complex problems

## Testing

Run the test suite to verify configuration:

```bash
python3 scripts/test_minimax_config.py
```

Expected output:
```
Testing MiniMax-M2 dynamic thinking token allocation...
✓ MiniMax-M2.1 auto mode: max_thinking_tokens=64000
✓ MiniMax-M2.1-REAP-50 auto mode: max_thinking_tokens=128000
✓ Conservative mode: max_thinking_tokens=16000 (4x reduction)
✓ Aggressive mode: max_thinking_tokens=128000 (2x increase)
✓ Disabled mode: enable_thinking=false
✓ Explicit override: max_thinking_tokens=42000 (custom value)
All tests PASSED ✓
```

## Future Enhancements

Potential improvements for even smarter allocation:

1. **Task complexity detection**: Automatically detect if a task is simple/complex
2. **Token budget optimization**: Use reinforcement learning (like SelfBudgeter)
3. **Adaptive scaling**: Adjust limits based on historical performance
4. **User feedback loop**: Learn from which modes work best for which tasks

## References

- [SelfBudgeter: Adaptive Token Allocation](https://openreview.net/forum?id=e7EBzbi8Qd)
- [Plan-and-Budget Framework](https://arxiv.org/abs/2505.16122)
- [MiniMax-M2 vLLM Deployment Guide](https://huggingface.co/MiniMaxAI/MiniMax-M2.1/blob/main/docs/vllm_deploy_guide.md)
- [vLLM Reasoning Outputs Documentation](https://docs.vllm.ai/en/latest/features/reasoning_outputs/)
