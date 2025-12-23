#!/bin/bash
# vLLM Studio Watchdog - Ensures services stay running
# Run via: nohup ./scripts/watchdog.sh &

LOG="/tmp/vllm-studio-watchdog.log"
CONTROLLER_PORT=8080
CHECK_INTERVAL=30

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

check_controller() {
    curl -sf "http://localhost:$CONTROLLER_PORT/health" > /dev/null 2>&1
}

start_controller() {
    cd /home/ser/workspace/projects/lmvllm
    nohup /home/ser/.pyenv/versions/3.11.9/bin/python -m controller.cli --port $CONTROLLER_PORT >> /tmp/controller.log 2>&1 &
    sleep 5
}

check_frontend() {
    docker ps --filter "name=vllm-studio-frontend" --format "{{.Status}}" | grep -q "Up"
}

restart_frontend() {
    docker start vllm-studio-frontend 2>/dev/null || {
        docker run -d \
            --name vllm-studio-frontend \
            --network host \
            -e BACKEND_URL=http://localhost:8080 \
            -e LITELLM_URL=http://localhost:4100 \
            -e LITELLM_MASTER_KEY=sk-master \
            -e NEXT_PUBLIC_LITELLM_URL=https://homelabai.org \
            --restart unless-stopped \
            vllm-studio-frontend:local
    }
}

check_litellm() {
    docker ps --filter "name=vllm-studio-litellm" --format "{{.Status}}" | grep -q "Up"
}

restart_litellm() {
    docker start vllm-studio-litellm 2>/dev/null
}

log "Watchdog started"

while true; do
    # Check Controller
    if ! check_controller; then
        log "Controller DOWN - restarting..."
        pkill -f "controller.cli" 2>/dev/null
        sleep 2
        start_controller
        if check_controller; then
            log "Controller restarted successfully"
        else
            log "Controller failed to restart!"
        fi
    fi

    # Check Frontend
    if ! check_frontend; then
        log "Frontend DOWN - restarting..."
        restart_frontend
        sleep 5
        if check_frontend; then
            log "Frontend restarted successfully"
        else
            log "Frontend failed to restart!"
        fi
    fi

    # Check LiteLLM
    if ! check_litellm; then
        log "LiteLLM DOWN - restarting..."
        restart_litellm
        sleep 5
        if check_litellm; then
            log "LiteLLM restarted successfully"
        else
            log "LiteLLM failed to restart!"
        fi
    fi

    sleep $CHECK_INTERVAL
done
