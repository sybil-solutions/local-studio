# MiniMax-M2 Thinking Tokens: Quick Reference

## One-Line Commands

### 🚀 Conservative (16K) - Recommended
```bash
vllm serve MiniMaxAI/MiniMax-M2.1 \
  --reasoning-parser minimax_m2_append_think \
  --default-chat-template-kwargs '{"max_thinking_tokens": 16384}'
```
**Best for**: Most tasks, fast responses, production

---

### ⚖️ Balanced (64K)
```bash
vllm serve MiniMaxAI/MiniMax-M2.1 \
  --reasoning-parser minimax_m2_append_think \
  --default-chat-template-kwargs '{"max_thinking_tokens": 65536}'
```
**Best for**: Coding, standard reasoning

---

### 🔬 Aggressive (128K)
```bash
vllm serve MiniMaxAI/MiniMax-M2.1 \
  --reasoning-parser minimax_m2_append_think \
  --default-chat-template-kwargs '{"max_thinking_tokens": 131072}'
```
**Best for**: Complex multi-step tasks

---

### ⚡ No Thinking
```bash
vllm serve MiniMaxAI/MiniMax-M2.1 \
  --reasoning-parser minimax_m2_append_think \
  --default-chat-template-kwargs '{"enable_thinking": false}'
```
**Best for**: Simple generation, fastest

---

## Token Limits Quick Reference

| Model | Conservative | Balanced | Aggressive |
|-------|--------------|----------|------------|
| **MiniMax-M2.1** | `16384` | `65536` | `131072` |
| **MiniMax-M2.1-REAP-50** | `32768` | `131072` | `262144` |
| **GLM-4.7** | `8192` | `32768` | `65536` |

---

## What to Use When?

```
Simple Q&A      → Conservative (16K)
Chatbot         → Conservative (16K)
Customer Svc    → Conservative (16K)
─────────────────────────────────────────
Coding          → Balanced (64K)
Debugging       → Balanced (64K)
Writing         → Balanced (64K)
─────────────────────────────────────────
Architecture    → Aggressive (128K)
Research        → Aggressive (128K)
Complex Tasks   → Aggressive (128K)
```

---

## Python API

```python
from vllm import LLM

llm = LLM(
    model="MiniMaxAI/MiniMax-M2.1",
    reasoning_parser="minimax_m2_append_think",
    default_chat_template_kwargs={"max_thinking_tokens": 16384}
)
```

---

## Key Points

✅ **16K is the sweet spot** for most use cases  
✅ **Models adapt to budget** - they don't "request more"  
✅ **Lower = faster & cheaper**  
✅ **Higher = deeper reasoning**  
✅ **Start conservative, scale up as needed**  

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Too slow | Decrease limit (try 8K) |
| Not detailed | Increase limit (try 64K) |
| Infinite loop | Add `max_thinking_tokens` |

---

**Full Guide**: See `VLLM_THINKING_TOKENS_GUIDE.md`
