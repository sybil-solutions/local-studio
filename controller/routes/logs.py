"""Log and SSE streaming endpoints."""

from __future__ import annotations

import asyncio
import datetime as dt
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..config import settings
from ..events import event_manager, Event
from ..process import find_inference_process
from ..store import RecipeStore

router = APIRouter()


def get_store() -> RecipeStore:
    """Get recipe store instance."""
    from ..app import get_store as _get_store
    return _get_store()


def _log_path_for(session_id: str) -> Path:
    safe = "".join(ch for ch in (session_id or "") if ch.isalnum() or ch in ("-", "_", "."))
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid log session id")
    return Path("/tmp") / f"vllm_{safe}.log"


def _tail_lines(path: Path, limit: int) -> list[str]:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            return list(deque(f, maxlen=limit))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Log not found")


@router.get("/logs", tags=["Logs"])
async def list_logs(store: RecipeStore = Depends(get_store)):
    """List available inference log files."""
    current = find_inference_process(settings.inference_port)
    log_files = sorted(Path("/tmp").glob("vllm_*.log"), key=lambda p: p.stat().st_mtime, reverse=True)

    sessions = []
    for p in log_files:
        sid = p.name.removeprefix("vllm_").removesuffix(".log")
        recipe = store.get(sid)
        created_at = dt.datetime.fromtimestamp(p.stat().st_mtime, tz=dt.timezone.utc).isoformat()

        status = "stopped"
        if current and recipe and current.model_path and recipe.model_path and recipe.model_path in current.model_path:
            status = "running"
        elif current and recipe and current.served_model_name and recipe.served_model_name == current.served_model_name:
            status = "running"

        sessions.append(
            {
                "id": sid,
                "recipe_id": recipe.id if recipe else sid,
                "recipe_name": recipe.name if recipe else None,
                "model_path": recipe.model_path if recipe else None,
                "model": (recipe.served_model_name or recipe.name) if recipe else sid,
                "backend": recipe.backend.value if recipe else None,
                "created_at": created_at,
                "status": status,
            }
        )

    return {"sessions": sessions}


@router.get("/logs/{session_id}", tags=["Logs"])
async def get_logs(session_id: str, limit: int = 2000):
    """Get log content for a session."""
    limit = max(1, min(int(limit), 20000))
    path = _log_path_for(session_id)
    lines = _tail_lines(path, limit)
    logs = [ln.rstrip("\n") for ln in lines]
    return {"id": session_id, "logs": logs, "content": "\n".join(logs)}


@router.delete("/logs/{session_id}", tags=["Logs"])
async def delete_logs(session_id: str):
    """Delete a log file."""
    path = _log_path_for(session_id)
    try:
        path.unlink()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Log not found")
    return {"success": True}


@router.get("/events", tags=["Events"])
async def events_stream():
    """Subscribe to real-time status updates via Server-Sent Events."""
    async def event_generator():
        try:
            async for event in event_manager.subscribe():
                yield event.to_sse()
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/logs/{session_id}/stream", tags=["Logs"])
async def stream_logs(session_id: str):
    """Stream log file updates in real-time via SSE."""
    path = _log_path_for(session_id)

    async def log_generator():
        try:
            if path.exists():
                with path.open("r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        event = Event(type="log", data={"line": line.rstrip("\n")})
                        yield event.to_sse()

            async for event in event_manager.subscribe(f"logs:{session_id}"):
                yield event.to_sse()
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        log_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        }
    )


@router.get("/events/stats", tags=["Events"])
async def events_stats():
    """Get event manager statistics for monitoring."""
    return event_manager.get_stats()
