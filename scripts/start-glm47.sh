#!/bin/bash
# Start GLM-4.7 on ExLlamaV3/TabbyAPI
# Model: GLM-4.7-EXL3-3bpw_H6 (355B params, 3bpw, ~124GB)
# Context: 200k tokens with Q8 KV cache
# Port: 8000
# Integrated with vllm-studio via LiteLLM

set -e

TABBY_DIR="/home/ser/workspace/projects/tabbyAPI"
CONFIG="config-glm47.yml"
LOG="/tmp/tabbyapi-glm47.log"

echo "=== GLM-4.7 Startup Script ==="
echo ""

# Kill any existing vLLM or TabbyAPI on port 8000
echo "Stopping any existing inference servers..."
pkill -9 -f "vllm.entrypoints" 2>/dev/null || true
pkill -9 -f "main.py.*config-glm" 2>/dev/null || true
sleep 5

# Verify GPU memory is available
echo "Checking GPU memory..."
/usr/bin/nvidia-smi --query-gpu=index,memory.used --format=csv,noheader

# Start TabbyAPI with GLM-4.7 config
echo ""
echo "Starting GLM-4.7 on ExLlamaV3..."
cd "$TABBY_DIR"
nohup .venv/bin/python main.py --config "$CONFIG" > "$LOG" 2>&1 &
PID=$!

echo "TabbyAPI starting with PID: $PID"
echo "Log: $LOG"
echo ""
echo "Waiting for model to load (this takes ~30-60 seconds)..."

# Wait for server to be ready (up to 2 minutes)
for i in {1..24}; do
    sleep 5
    if curl -sf http://localhost:8000/v1/models > /dev/null 2>&1; then
        echo ""
        echo "=== GLM-4.7 is ready! ==="
        echo ""
        echo "Model: GLM-4.7-EXL3-3bpw_H6 (355B params)"
        echo "Backend: ExLlamaV3 0.0.11"
        echo "Context: ~200k tokens"
        echo "Cache: Q8 (8-bit)"
        echo "Port: 8000"
        echo ""
        echo "Direct test:"
        echo "  curl http://localhost:8000/v1/models"
        echo ""
        echo "Via LiteLLM (port 4100):"
        echo "  curl http://localhost:4100/v1/chat/completions \\"
        echo "    -H 'Authorization: Bearer sk-master' \\"
        echo "    -d '{\"model\": \"glm-4.7\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'"
        echo ""
        exit 0
    fi
    echo "  Still loading... ($i/24)"
done

echo "Timeout waiting for server. Check log: $LOG"
tail -20 "$LOG"
exit 1
