<!-- CRITICAL -->
# GLM-4.7 Output Corruption: Technical Analysis

## Executive Summary

This document analyzes a character encoding corruption issue observed in GLM-4.7 model outputs. Specifically, Unicode box-drawing corner characters (e.g., `┌`, `└`, `┐`, `┘`) are replaced with the Unicode replacement character (`U+FFFD`), while other box-drawing characters (`─`, `│`, `▼`) render correctly.

## Observed Behavior

### Symptoms
- Model outputs contain replacement characters (`U+FFFD`) where corner box-drawing characters should appear
- Pattern: `\n```\n�─────` instead of `\n```\n┌─────`
- Only corner characters fail; horizontal/vertical lines work fine
- 40 replacement characters in a single vLLM report output

### Affected Characters
| Character | Unicode | Status |
|-----------|---------|--------|
| `┌` | U+250C | CORRUPTED |
| `┐` | U+2510 | CORRUPTED |
| `└` | U+2514 | CORRUPTED |
| `┘` | U+2518 | CORRUPTED |
| `─` | U+2500 | Works |
| `│` | U+2502 | Works |
| `▼` | U+25BC | Works |

## Root Cause Analysis

### 1. Tokenizer Vocabulary Structure

The GLM-4.7 tokenizer uses byte-pair encoding (BPE) with byte fallback. Analysis reveals:

**Single-token characters (work correctly):**
```
─ (U+2500) → Token 14545 (single token)
│ (U+2502) → Token 72325 (single token)
▼ (U+25BC) → Token 115789 (single token)
```

**Multi-token characters (fail):**
```
┌ (U+250C) → Tokens [11616, 234] (two tokens)
┐ (U+2510) → Tokens [11616, 238] (two tokens)
└ (U+2514) → Tokens [11616, 242] (two tokens)
┘ (U+2518) → Tokens [11616, 246] (two tokens)
```

The corner characters are NOT in the vocabulary as single tokens. They're encoded using byte fallback:
- Token 11616 = `âĶ` (represents partial UTF-8 bytes)
- Token 234 = `Į` (represents the remaining byte)

### 2. UTF-8 Encoding Details

All box-drawing characters use 3-byte UTF-8 sequences starting with `E2 94`:

```
┌ (U+250C): E2 94 8C
┐ (U+2510): E2 94 90
└ (U+2514): E2 94 94
┘ (U+2518): E2 94 98
─ (U+2500): E2 94 80
│ (U+2502): E2 94 82
```

The difference: `─` has its complete 3-byte sequence as a single token, while `┌` has bytes split across two tokens.

### 3. Streaming Detokenization Problem

When decoding token-by-token during streaming:

```python
# Token 11616 alone represents bytes [E2, 94] - incomplete UTF-8!
tokenizer.decode([11616]) → '�' (replacement character)

# Token 234 alone represents byte [8C] - invalid start byte!
tokenizer.decode([234]) → '�'

# Both together form valid UTF-8
tokenizer.decode([11616, 234]) → '┌' (correct!)
```

### 4. Incremental Diff Algorithm Failure

vLLM's streaming uses incremental detokenization with diff-based text emission:

```
Step 1: decode([11616]) = '�'          → emit '�'
Step 2: decode([11616, 234]) = '┌'     → diff: '┌'[len('�'):] = '' (nothing!)
Step 3: decode([11616, 234, 32178]) = '┌────' → diff: '────'

Result: '�' + '' + '────' = '�────' (corrupted!)
Expected: '┌────'
```

The bug occurs because:
1. Token 11616 decodes to `'�'` and is emitted immediately
2. When token 234 arrives, the full decode produces `'┌'`
3. The diff algorithm calculates `'┌'[1:]` = `''` (empty string!)
4. The `'┌'` never replaces the already-emitted `'�'`

## vLLM's Mitigation Attempts

### FastIncrementalDetokenizer (tokenizers >= 0.21.1)

vLLM's v1 engine uses `DecodeStream` from the tokenizers library:

```python
stream = DecodeStream(skip_special_tokens=False)
stream.step(tokenizer, 11616) → None  # Buffers incomplete sequence
stream.step(tokenizer, 234) → '┌'     # Emits complete character
stream.step(tokenizer, 32178) → '────'
# Correct result!
```

**DecodeStream correctly buffers incomplete UTF-8 sequences.**

### SlowIncrementalDetokenizer (fallback)

Has a guard at line 190:
```python
if len(new_text) <= len(prefix_text) or new_text.endswith("�"):
    return new_tokens, "", prefix_offset, read_offset
```

This buffers text ending with `�`, but doesn't handle all edge cases.

## Why Corruption Still Occurs

Despite vLLM having mitigations, corruption persists due to:

### 1. Code Path Variations
- v0 vs v1 engine differences
- Non-streaming requests may use different paths
- OpenAI-compatible API layer processing

### 2. Multiple Processing Layers
```
vLLM Detokenizer
     ↓
HTTP Response (chunked)
     ↓
Controller Proxy (TypeScript)
     ↓
Frontend AI SDK
     ↓
Message Storage
```

Each layer could introduce issues if not handling UTF-8 streaming correctly.

### 3. Stream Reset on Errors

When errors occur, `FastIncrementalDetokenizer` resets its `DecodeStream`:
```python
except Exception as e:
    self.stream = DecodeStream(skip_special_tokens=...)
    token = self.stream.step(fast_tokenizer, next_token_id)
```

This can cause previously buffered bytes to be lost.

## Additional Issue: Exposed Think Tags

GLM-4.7-flash outputs `<think>` tags that are sometimes visible in stored messages:

```
<think>The user just said "hi". This is a simple greeting...</think>

Hello! I'm here to help...
```

This suggests the reasoning content stripping isn't consistently applied across all code paths.

## Recommendations

### 1. Ensure FastIncrementalDetokenizer is Used
- Verify tokenizers >= 0.21.1
- Confirm PreTrainedTokenizerFast is used (not slow tokenizer)
- Check v1 engine is active

### 2. Frontend UTF-8 Handling
- Use TextDecoder with `stream: true` option
- Buffer incomplete chunks before processing

### 3. Model Configuration
- Consider using `--detokenizer-mode=slow` flag if fast path has issues
- Test with `--disable-streaming` to confirm streaming is the cause

### 4. Tokenizer Vocabulary Enhancement
Request model authors to add corner box-drawing characters as single tokens in future model releases.

## Test Script

```python
from transformers import AutoTokenizer
from tokenizers.decoders import DecodeStream

model_path = "/mnt/llm_models/GLM-4.7-REAP-218B-A32B-AWQ-4bit"
tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)

test_string = "┌────"
tokens = tokenizer.encode(test_string, add_special_tokens=False)
print(f"Tokens: {tokens}")

# Test DecodeStream behavior
stream = DecodeStream(skip_special_tokens=False)
fast_tok = tokenizer._tokenizer
accumulated = ""

for tid in tokens:
    result = stream.step(fast_tok, tid)
    if result:
        accumulated += result
    print(f"Token {tid}: {repr(result)}")

print(f"Final: {repr(accumulated)}")
print(f"Expected: {repr(test_string)}")
print(f"Match: {accumulated == test_string}")
```

## Conclusion

The root cause is **tokenizer vocabulary design** - corner box-drawing characters aren't single tokens, causing byte fallback encoding that interacts poorly with incremental detokenization.

While vLLM's `DecodeStream` correctly handles this at the low level, the issue manifests due to complex interactions between:
1. Multiple processing layers in the serving stack
2. Error handling that resets state
3. Diff-based text emission algorithms

This is a **known limitation** of byte-fallback BPE tokenizers combined with streaming detokenization, and affects any character not in the vocabulary as a single token.

---

## Appendix: Think Tag Exposure

### Symptoms

GLM-4.7-flash outputs include visible `<think>` tags that should be parsed as reasoning content:

```
<think>The user just said "hi". This is a simple greeting...</think>

Hello! I'm here to help...
```

### Expected Behavior

The thinking content should be:
1. Extracted to `reasoning_content` field (backend)
2. Displayed in a collapsed "Thinking" section (frontend)
3. Not included in the main message content

### Processing Layers

**Backend (controller/src/services/proxy-parsers.ts):**
- `parseThinkTagsFromContent()` - Parses think tags and sets `reasoning_content`
- Handles mid-stream think tags with state tracking

**Frontend (frontend/src/lib/services/message-parsing/parsers/thinking.parser.ts):**
- `ThinkingParser.parse()` - Extracts think blocks from message content
- Supports both `<think>` and `<thinking>` tags

### Why Tags Are Exposed

1. **Non-streaming responses** may bypass think tag processing
2. **Message persistence** happens after streaming completes, but if frontend doesn't strip tags, they persist
3. **State tracking issues** - if stream ends mid-think-tag, it may not be properly closed

### Context Format Display

The user also observed formatting like:
```
glm-4.7ctx 2.1K / 150.0K
```

This appears to be UI context display (current/max tokens), not a model output issue. It's part of the frontend's token counting display.

---

*Analysis conducted: 2026-01-25*
*Model: GLM-4.7-REAP-218B-A32B-AWQ-4bit*
*vLLM Version: 0.14.0rc1.dev198*
*tokenizers Version: 0.22.1*
