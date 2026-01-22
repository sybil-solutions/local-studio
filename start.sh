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

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev) DEV_MODE=true; shift ;;
        --port) PORT="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: ./start.sh [--dev] [--port PORT]"
            echo ""
            echo "Options:"
            echo "  --dev   Development mode with auto-reload"
            echo "  --port  Controller port (default: 8080)"
            exit 0
            ;;
        *) shift ;;
    esac
done

# Start
if [ "$DEV_MODE" = true ]; then
    echo -e "${GREEN}Starting in dev mode...${NC}"
    VLLM_STUDIO_PORT="$PORT" bun --watch controller/src/main.ts
else
    echo -e "${GREEN}Starting controller on port $PORT...${NC}"
    VLLM_STUDIO_PORT="$PORT" bun controller/src/main.ts
fi
