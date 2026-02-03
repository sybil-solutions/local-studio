# Deployment Workflow

## Local dev (controller + services)
```
./start.sh --dev --port 8080 --docker
```
- Starts controller on `:8080` and brings up docker dependencies.

## Local production build (frontend)
```
cd frontend
npm run build
npm run lint
```

## Docker rebuild (frontend)
```
docker compose up -d --build frontend
```

## Server deploy (example)
```
ssh -i ~/.ssh/linux-ai ser@<your-server-ip>
cd /workspace/projects/lmvllm

git fetch origin
# checkout target branch
# git checkout <branch>
# git pull

# Restart controller on 8080
pkill -f "controller/src/main.ts" || true
./start.sh --port 8080 --docker > /tmp/vllm-controller.log 2>&1 &

# Rebuild frontend
docker compose up -d --build frontend
```

## Post-deploy checks
- `curl -sS https://<your-api-domain>/v1/models`
- `curl -N https://<your-api-domain>/v1/chat/completions` with `stream: true`
- Load `/chat` UI and run a tool-call prompt.
