# Quick Start - Model Validation Test Harness

Get started with model validation in 5 minutes.

## Prerequisites

```bash
# 1. Install dependencies
pip install httpx pyyaml

# 2. Ensure vLLM Studio is running
# Controller should be accessible at http://localhost:8080
# Inference backend should be accessible at http://localhost:8000
```

## Basic Usage

### Run Full Validation

```bash
cd /path/to/vllm-studio

# Run all tests (including restart)
python tests/test_model_validation.py

# Skip restart test (faster, non-disruptive)
python tests/test_model_validation.py --skip-restart
```

### Expected Output

```
============================================================
Starting validation for model: Qwen2.5-72B-Instruct-AWQ
============================================================

Running health check...
  Result: PASS

Running short generation test...
  Result: PASS
  Latency: 1250.34ms

Running long context test...
  Result: PASS
  Target ratio: 90.0%
  Achieved ratio: 89.2%

Running memory headroom test...
  Result: PASS
  GPU 0: 88.3% used

Running restart validation test...
  Result: PASS
  Restart time: 125.4s

============================================================
Validation PASSED
============================================================
```

## Save Results

```bash
# Save to timestamped file
python tests/test_model_validation.py \
  --output artifacts/tests/results/validation-$(date +%Y%m%d-%H%M%S).json
```

## Customize Configuration

Edit `tests/test_config.yaml`:

```yaml
# Adjust thresholds
thresholds:
  short_generation_max_latency_ms: 3000  # Stricter requirement
  long_context_target_ratio: 0.95        # Higher target

# Adjust timeouts
timeouts:
  long_context: 600  # 10 minutes for slower models
```

## Common Commands

```bash
# Production deployment validation (skip restart)
python tests/test_model_validation.py --skip-restart

# Remote testing
python tests/test_model_validation.py \
  --controller-url http://192.168.1.100:8080 \
  --inference-url http://192.168.1.100:8000

# Specify model explicitly
python tests/test_model_validation.py \
  --model-id "Qwen2.5-72B-AWQ" \
  --recipe-id "qwen-72b-awq"

# Full validation with output
python tests/test_model_validation.py \
  --output validation-results.json
```

## Interpreting Results

### All Tests Pass
```json
{"overall_passed": true}
```
**Action:** Model is production-ready.

### Short Generation Fails
```json
{
  "tests": {
    "short_generation": {
      "passed": false,
      "latency_ms": 6200,
      "details": {"threshold_ms": 5000}
    }
  }
}
```
**Action:** Model is slow. Consider:
- Reducing `max_model_len`
- Increasing GPU resources
- Using faster quantization (e.g., AWQ instead of GPTQ)

### Long Context Fails
```json
{
  "tests": {
    "long_context": {
      "passed": false,
      "error": "Long context generation failed: 500"
    }
  }
}
```
**Action:** OOM or Flash Attention issue. Check:
- vLLM logs: `tail -f /tmp/vllm_*.log`
- Verify Flash Attention is enabled
- Reduce `max_model_len`

### Memory Headroom Fails
```json
{
  "tests": {
    "memory_headroom": {
      "passed": false,
      "details": {
        "gpus": [{"usage_percent": 96.3}]
      }
    }
  }
}
```
**Action:** VRAM usage too high. Adjust recipe:
```yaml
gpu_memory_utilization: 0.85  # More conservative
max_model_len: 16384          # Reduce context window
```

## Next Steps

1. **Read Full Documentation:** `tests/README.md`
2. **Customize Configuration:** `tests/test_config.yaml`
3. **Review Schema:** `artifacts/tests/RESULTS_SCHEMA.json`
4. **Integrate with CI/CD:** See examples in `tests/README.md`

## Troubleshooting

### "Connection refused"
```bash
# Check services are running
curl http://localhost:8080/health
curl http://localhost:8000/health

# If not, start them
./start.sh
docker compose up -d
```

### "Could not determine model max_model_len"
```bash
# Verify model is loaded
curl http://localhost:8000/v1/models
```

### Test hangs
```bash
# Check backend logs
tail -f /tmp/vllm_*.log

# Increase timeout in test_config.yaml
```

## Help

For detailed documentation, see:
- `tests/README.md` - Comprehensive test documentation
- `tests/test_config.yaml` - Configuration options
- `artifacts/tests/RESULTS_SCHEMA.json` - Results schema
