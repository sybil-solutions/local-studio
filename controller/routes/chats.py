"""Chat session endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from ..store import ChatStore

router = APIRouter(tags=["Chats"])


def get_chat_store() -> ChatStore:
    """Get chat store instance."""
    from ..app import get_chat_store as _get_chat_store
    return _get_chat_store()


@router.get("/chats")
async def list_chat_sessions(chat_store: ChatStore = Depends(get_chat_store)):
    """List all chat sessions."""
    return chat_store.list_sessions()


@router.get("/chats/{session_id}")
async def get_chat_session(session_id: str, chat_store: ChatStore = Depends(get_chat_store)):
    """Get a chat session with its messages."""
    session = chat_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": session}


@router.post("/chats")
async def create_chat_session(request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Create a new chat session."""
    body = await request.json()
    session_id = str(uuid.uuid4())
    title = body.get("title", "New Chat")
    model = body.get("model")
    session = chat_store.create_session(session_id, title, model)
    return {"session": session}


@router.put("/chats/{session_id}")
async def update_chat_session(session_id: str, request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Update a chat session (title, model)."""
    body = await request.json()
    if not chat_store.update_session(session_id, body.get("title"), body.get("model")):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@router.delete("/chats/{session_id}")
async def delete_chat_session(session_id: str, chat_store: ChatStore = Depends(get_chat_store)):
    """Delete a chat session."""
    if not chat_store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}


@router.post("/chats/{session_id}/messages")
async def add_chat_message(session_id: str, request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Add a message to a chat session."""
    body = await request.json()
    message_id = body.get("id", str(uuid.uuid4()))
    role = body.get("role", "user")
    content = body.get("content")
    model = body.get("model")
    tool_calls = body.get("tool_calls")
    request_prompt_tokens = body.get("request_prompt_tokens")
    request_tools_tokens = body.get("request_tools_tokens")
    request_total_input_tokens = body.get("request_total_input_tokens")
    request_completion_tokens = body.get("request_completion_tokens")
    message = chat_store.add_message(
        session_id, message_id, role, content, model, tool_calls,
        request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens
    )
    return message


@router.get("/chats/{session_id}/usage")
async def get_chat_usage(session_id: str, chat_store: ChatStore = Depends(get_chat_store)):
    """Get token usage for a chat session."""
    return chat_store.get_usage(session_id)


@router.post("/chats/{session_id}/fork")
async def fork_chat_session(session_id: str, request: Request, chat_store: ChatStore = Depends(get_chat_store)):
    """Fork a chat session, optionally from a specific message."""
    body = await request.json()
    new_id = str(uuid.uuid4())
    message_id = body.get("message_id")
    model = body.get("model")
    title = body.get("title")
    session = chat_store.fork_session(session_id, new_id, message_id, model, title)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": session}
