# Backend Commands

## Controller
```
./start.sh --dev --port 8080 --docker
./start.sh --port 8080 --docker
```

## Health + Status
```
curl -sS http://localhost:8080/health
curl -sS http://localhost:8080/status
```

## OpenAI-compatible tests
```
curl -sS http://localhost:8080/v1/models
curl -N http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"<model>","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

## Logs
- Controller logs: `./start.sh` output or `/tmp/vllm-controller.log` (if redirected).
- Inference logs: `/logs` endpoints in controller UI.
