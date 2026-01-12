"""MCP (Model Context Protocol) server management endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..models import MCPServer


def get_mcp_store():
    """Lazy import to avoid circular dependency."""
    from ..app import get_mcp_store as _get_mcp_store
    return _get_mcp_store()

router = APIRouter(tags=["MCP"])
logger = logging.getLogger(__name__)


class MCPServerCreate(BaseModel):
    """Request body for creating/updating an MCP server."""
    id: str
    name: str
    enabled: bool = True
    command: str
    args: List[str] = []
    env: Dict[str, str] = {}
    description: Optional[str] = None
    url: Optional[str] = None


class MCPServerUpdate(BaseModel):
    """Request body for updating an MCP server."""
    name: Optional[str] = None
    enabled: Optional[bool] = None
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    description: Optional[str] = None
    url: Optional[str] = None


def _get_npx_path() -> str:
    """Find a working npx path."""
    from pathlib import Path
    for path in ["/usr/local/bin/npx", "/usr/bin/npx", "npx"]:
        if Path(path).exists() or path == "npx":
            return path
    return "npx"


async def _run_mcp_command(server: MCPServer, method: str, params: dict = None) -> dict:
    """Run an MCP command against a server using JSON-RPC over stdio."""
    command = server.command
    args = server.args
    env_vars = server.env

    if command == "npx":
        command = _get_npx_path()

    full_command = [command] + args

    env = os.environ.copy()
    env.update(env_vars)

    try:
        proc = await asyncio.create_subprocess_exec(
            *full_command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        try:
            # Step 1: Send initialize request
            init_request = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "vllm-studio", "version": "1.0.0"}
                }
            }) + "\n"

            proc.stdin.write(init_request.encode())
            await proc.stdin.drain()

            # Step 2: Read initialize response
            init_response_line = await asyncio.wait_for(
                proc.stdout.readline(),
                timeout=30.0
            )

            if not init_response_line:
                stderr = await proc.stderr.read()
                raise Exception(f"No response from MCP server. Stderr: {stderr.decode()[:500]}")

            init_response = json.loads(init_response_line.decode().strip())
            if "error" in init_response:
                raise Exception(init_response["error"].get("message", "Initialize failed"))

            # Step 3: Send initialized notification
            initialized_notification = json.dumps({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }) + "\n"

            proc.stdin.write(initialized_notification.encode())
            await proc.stdin.drain()

            # Step 4: If not just initializing, send the actual request
            if method != "initialize":
                request = json.dumps({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": method,
                    "params": params or {}
                }) + "\n"

                proc.stdin.write(request.encode())
                await proc.stdin.drain()

                response_line = await asyncio.wait_for(
                    proc.stdout.readline(),
                    timeout=30.0
                )

                if response_line:
                    response = json.loads(response_line.decode().strip())
                    if "error" in response:
                        raise Exception(response["error"].get("message", "Unknown MCP error"))
                    return response.get("result", {})
                return {}
            else:
                return init_response.get("result", {})

        except asyncio.TimeoutError:
            proc.kill()
            raise Exception("MCP command timed out")
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except Exception:
                proc.kill()

    except FileNotFoundError:
        raise Exception(f"Command not found: {command}")
    except Exception as e:
        if "MCP error" in str(e) or "command timed out" in str(e):
            raise
        raise Exception(f"MCP error: {str(e)}")


# ============================================================================
# CRUD Endpoints for MCP Servers
# ============================================================================

@router.get("/mcp/servers")
async def list_mcp_servers(enabled_only: bool = False):
    """List all configured MCP servers from the database."""
    store = get_mcp_store()
    servers = store.list(enabled_only=enabled_only)
    return [server.model_dump() for server in servers]


@router.get("/mcp/servers/{server_id}")
async def get_mcp_server(server_id: str):
    """Get a single MCP server by ID."""
    store = get_mcp_store()
    server = store.get(server_id)
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    return server.model_dump()


@router.post("/mcp/servers")
async def create_mcp_server(data: MCPServerCreate):
    """Create or update an MCP server configuration."""
    store = get_mcp_store()
    server = MCPServer(
        id=data.id,
        name=data.name,
        enabled=data.enabled,
        command=data.command,
        args=data.args,
        env=data.env,
        description=data.description,
        url=data.url,
    )
    store.save(server)
    return server.model_dump()


@router.put("/mcp/servers/{server_id}")
async def update_mcp_server(server_id: str, data: MCPServerUpdate):
    """Update an existing MCP server configuration."""
    store = get_mcp_store()
    existing = store.get(server_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    # Update only provided fields
    updated = MCPServer(
        id=server_id,
        name=data.name if data.name is not None else existing.name,
        enabled=data.enabled if data.enabled is not None else existing.enabled,
        command=data.command if data.command is not None else existing.command,
        args=data.args if data.args is not None else existing.args,
        env=data.env if data.env is not None else existing.env,
        description=data.description if data.description is not None else existing.description,
        url=data.url if data.url is not None else existing.url,
    )
    store.save(updated)
    return updated.model_dump()


@router.delete("/mcp/servers/{server_id}")
async def delete_mcp_server(server_id: str):
    """Delete an MCP server configuration."""
    store = get_mcp_store()
    if not store.delete(server_id):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    return {"status": "deleted", "id": server_id}


@router.post("/mcp/servers/{server_id}/enable")
async def enable_mcp_server(server_id: str):
    """Enable an MCP server."""
    store = get_mcp_store()
    if not store.set_enabled(server_id, True):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    return {"status": "enabled", "id": server_id}


@router.post("/mcp/servers/{server_id}/disable")
async def disable_mcp_server(server_id: str):
    """Disable an MCP server."""
    store = get_mcp_store()
    if not store.set_enabled(server_id, False):
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    return {"status": "disabled", "id": server_id}


# ============================================================================
# Tool Discovery and Execution
# ============================================================================

@router.get("/mcp/servers/{server_id}/tools")
async def get_mcp_server_tools(server_id: str):
    """Get available tools from a specific MCP server."""
    store = get_mcp_store()
    server = store.get(server_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    if not server.enabled:
        raise HTTPException(status_code=400, detail=f"Server '{server_id}' is disabled")

    try:
        result = await _run_mcp_command(server, "tools/list")
        tools = result.get("tools", [])
        # Add server reference to each tool
        for tool in tools:
            tool["server"] = server_id
        return {"server": server_id, "tools": tools}
    except Exception as e:
        logger.error(f"Failed to get tools from {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/mcp/tools")
async def get_all_mcp_tools():
    """Get all tools from all enabled MCP servers."""
    store = get_mcp_store()
    servers = store.list(enabled_only=True)

    all_tools = []
    errors = []

    for server in servers:
        try:
            result = await _run_mcp_command(server, "tools/list")
            tools = result.get("tools", [])
            for tool in tools:
                tool["server"] = server.id
                all_tools.append(tool)
        except Exception as e:
            logger.warning(f"Failed to get tools from {server.id}: {e}")
            errors.append({"server": server.id, "error": str(e)})

    return {
        "tools": all_tools,
        "errors": errors if errors else None,
    }


@router.post("/mcp/servers/{server_id}/tools/{tool_name}")
async def call_mcp_server_tool(server_id: str, tool_name: str, request: Request):
    """Call a tool on a specific MCP server."""
    store = get_mcp_store()
    server = store.get(server_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    if not server.enabled:
        raise HTTPException(status_code=400, detail=f"Server '{server_id}' is disabled")

    try:
        body = await request.json()
    except Exception:
        body = {}

    try:
        result = await _run_mcp_command(
            server,
            "tools/call",
            {"name": tool_name, "arguments": body}
        )

        content = result.get("content", [])
        if content and isinstance(content, list):
            text_parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text_parts.append(item.get("text", ""))
            if text_parts:
                return {"result": "\n".join(text_parts)}

        return {"result": result}

    except Exception as e:
        logger.error(f"Failed to call tool {tool_name} on {server_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Alias endpoint for frontend compatibility (calls without server prefix)
@router.post("/mcp/tools/{server_id}/{tool_name}")
async def call_mcp_tool(server_id: str, tool_name: str, request: Request):
    """Call a tool (alias endpoint for frontend compatibility)."""
    return await call_mcp_server_tool(server_id, tool_name, request)
