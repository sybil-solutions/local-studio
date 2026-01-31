#!/bin/bash
# vLLM Studio - Start Script
set -e

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          vLLM Studio                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"

# Load .env if exists
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# Defaults
PORT=${VLLM_STUDIO_PORT:-8080}
DEV_MODE=false
USE_DOCKER=true

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev) DEV_MODE=true; shift ;;
        --port) PORT="$2"; shift 2 ;;
        --direct|--no-docker) USE_DOCKER=false; shift ;;
        --docker) USE_DOCKER=true; shift ;;
        -h|--help)
            echo "Usage: ./start.sh [--dev] [--port PORT] [--direct|--docker]"
            echo ""
            echo "Options:"
            echo "  --dev   Development mode with auto-reload"
            echo "  --port  Controller port (default: 8080)"
            echo "  --direct  Skip docker compose (run controller directly)"
            echo "  --docker  Force docker compose for backend services"
            exit 0
            ;;
        *) shift ;;
    esac
done

# Use non-snap bun (snap bun has sandbox restrictions)
BUN="${HOME}/.bun/bin/bun"
if [ ! -x "$BUN" ]; then
    BUN="bun"  # Fallback to system bun
fi

# Start
if [ "$DEV_MODE" = true ]; then
    echo -e "${GREEN}Starting in dev mode...${NC}"
    if [ "$USE_DOCKER" = true ]; then
        if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
            echo -e "${GREEN}Starting backend services with Docker...${NC}"
            docker compose up -d postgres redis litellm temporal prometheus
        else
            echo -e "${GREEN}Docker not available; running direct.${NC}"
        fi
    fi
    VLLM_STUDIO_PORT="$PORT" "$BUN" --watch controller/src/main.ts
else
    echo -e "${GREEN}Starting controller on port $PORT...${NC}"
    if [ "$USE_DOCKER" = true ]; then
        if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
            echo -e "${GREEN}Starting backend services with Docker...${NC}"
            docker compose up -d postgres redis litellm temporal prometheus
        else
            echo -e "${GREEN}Docker not available; running direct.${NC}"
        fi
    fi
    VLLM_STUDIO_PORT="$PORT" "$BUN" controller/src/main.ts
fi
