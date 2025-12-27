#!/bin/bash
# Start the TabbyAPI tool call proxy
# This proxy ensures tool_calls are properly formatted in responses

cd /home/ser/workspace/projects/lmvllm

# Kill any existing proxy
pkill -f "tabby_proxy.py" 2>/dev/null

# Start the proxy
nohup python3 scripts/tabby_proxy.py > /tmp/tabby_proxy.log 2>&1 &
PID=$!

echo "TabbyAPI proxy started with PID $PID"
echo "Logs at /tmp/tabby_proxy.log"

# Wait for startup
sleep 2

# Health check
if curl -s http://localhost:8001/health > /dev/null; then
    echo "Proxy is healthy"
else
    echo "ERROR: Proxy health check failed"
    exit 1
fi
