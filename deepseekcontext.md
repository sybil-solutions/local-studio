# DeepSeek-V3.2-REAP-345B-W3A16 Context

## Model Overview

| Property | Value |
|----------|-------|
| **Base Model** | DeepSeek-V3.2 |
| **Variant** | REAP (Router-weighted Expert Activation Pruning) |
| **Total Parameters** | 345B (pruned from 671B) |
| **Active Parameters** | 37B per token |
| **Architecture** | Sparse Mixture-of-Experts (MoE) |
| **Experts** | 128 total, 8 activated per token |
| **Context Length** | 163,840 tokens |
| **Local Path** | `/mnt/llm_models/DeepSeek-V3.2-REAP-345B-W3A16` |

## Quantization Configuration

```json
{
  "autoround_version": "0.9.4",
  "bits": 3,
  "data_type": "int",
  "group_size": 128,
  "packing_format": "auto_round:auto_gptq",
  "quant_method": "auto-round",
  "sym": true
}
```

### What This Means
- **W3A16**: 3-bit weights, 16-bit activations
- **auto-round**: Intel's AutoRound quantization algorithm
- **auto_gptq packing**: Weights packed in GPTQ-compatible format
- **sym: true**: Symmetric quantization (no zero-point offset)
- **group_size: 128**: Quantization applied per 128-weight groups

## Hardware Requirements

- **Target**: 8x RTX 3090 (24GB each = 192GB total)
- **Model Size**: ~130GB (3-bit quantized)
- **KV Cache**: Additional memory needed for inference

## Inference Backend Compatibility

### SGLang / vLLM (NOT WORKING)

**Problem**: 3-bit MoE kernels don't exist.

SGLang's MoE execution path uses:
- **Marlin kernels**: Only support 4-bit and 8-bit
- **Fused MoE**: Built around int4/int8 packing
- **moe_wna16.py**: Has `assert weight_bits in [4, 8]`

Patching the assert is NOT enough because:
1. The underlying CUDA kernels don't support 3-bit unpacking
2. 3-bit GPTQ packing is structurally different (bit-straddling)
3. Worker processes crash silently with "leaked semaphore" warning

### Transformers + AutoGPTQ (WORKING)

Uses CPU offloading + Triton kernels for 3-bit support.

**Launch Command**:
```bash
DEEPSEEK_MODEL_PATH=/mnt/llm_models/DeepSeek-V3.2-REAP-345B-W3A16 \
  scripts/deepseek/run_transformers_server.sh
```

**Performance**: Slower than SGLang/vLLM but functional.

## What Would Be Needed for SGLang 3-bit MoE Support

1. **Native W3A16 grouped GEMM for MoE experts**
   - Tokens-per-expert bucketing + per-expert GEMMs
   - Fused with scatter/gather operations

2. **Int3 kernel implementation options**:
   - Native int3 pack + dequant + MMA
   - OR: Repack int3→int4 strategy

3. **Packing compatibility**:
   - SGLang loader must understand auto_round:auto_gptq 3-bit layout
   - qweight/qzeros/scales interpretation for sym=true, group_size=128

4. **Dispatch logic**:
   - Route `bits==3` to supported backend
   - Currently falls through and crashes

## Alternative Solutions

### Option 1: Re-quantize to W4A16
- Increases model size by ~33%
- Enables use of existing Marlin MoE kernels
- Best performance/compatibility tradeoff

### Option 2: Transformers Server (Current)
- Works with existing 3-bit quantization
- Uses CPU offloading for memory management
- Slower but stable

### Option 3: Wait for Kernel Support
- Intel AutoRound team working on SGLang integration
- GPTQModel added 3-bit Triton kernel (Dec 2025) but not for MoE

## Debugging SGLang Crashes

To see actual crash reason:
```bash
PYTHONFAULTHANDLER=1 \
CUDA_LAUNCH_BLOCKING=1 \
TORCH_SHOW_CPP_STACKTRACES=1 \
python -m sglang.launch_server \
  --model-path=/mnt/llm_models/DeepSeek-V3.2-REAP-345B-W3A16 \
  --tensor-parallel-size=8 \
  --trust-remote-code
```

Check `dmesg` for OOM-kill after crash.

## Files in This Repo

- `scripts/deepseek/transformers_server.py` - FastAPI server using Transformers
- `scripts/deepseek/run_transformers_server.sh` - Launch script
- `scripts/deepseek/stop_transformers_server.sh` - Stop script
- `data/recipes.db` - Contains SGLang recipe (won't work due to kernel issues)

## Key Research Sources

- [Intel Auto-Round GitHub](https://github.com/intel/auto-round)
- [AutoRound + SGLang Integration](https://community.intel.com/t5/Blogs/Tech-Innovation/Artificial-Intelligence-AI/AutoRound-Meets-SGLang-Enabling-Quantized-Model-Inference-with/post/1727196)
- [Cerebras REAP Model](https://huggingface.co/cerebras/DeepSeek-V3.2-REAP-345B-A37B)
- [GPTQModel PyPI](https://pypi.org/project/GPTQModel/)

## Summary

**The 3-bit W3A16 MoE model cannot run on SGLang/vLLM today** due to missing kernel support. The Transformers backend with AutoGPTQ/AutoRound is the only working path for this specific quantization. For SGLang performance, re-quantizing to W4A16 is recommended.
