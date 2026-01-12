"""Chat completions proxy endpoint."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..config import settings
from ..models import Recipe
from ..process import evict_model, find_inference_process, launch_model
from ..store import RecipeStore

router = APIRouter(tags=["OpenAI Compatible"])
logger = logging.getLogger(__name__)

_switch_lock = asyncio.Lock()


def get_store() -> RecipeStore:
    """Get recipe store instance."""
    from ..app import get_store as _get_store
    return _get_store()


def _find_recipe_by_model(store: RecipeStore, model_name: str) -> Optional[Recipe]:
    """Find a recipe by served_model_name or id (case-insensitive)."""
    if not model_name:
        return None
    model_lower = model_name.lower()
    for recipe in store.list():
        served_lower = (recipe.served_model_name or "").lower()
        if served_lower == model_lower or recipe.id.lower() == model_lower:
            return recipe
    return None


async def _ensure_model_running(requested_model: str, store: RecipeStore) -> Optional[str]:
    """Ensure the requested model is running, auto-switching if needed.

    Returns None if model is ready, or an error message if switch failed.
    """
    import time
    import psutil

    if not requested_model:
        return None

    requested_lower = requested_model.lower()

    current = find_inference_process(settings.inference_port)
    current_name = current.served_model_name if current else None

    if current_name and current_name.lower() == requested_lower:
        return None

    recipe = _find_recipe_by_model(store, requested_model)
    if not recipe:
        return None

    async with _switch_lock:
        current = find_inference_process(settings.inference_port)
        current_name = current.served_model_name if current else None
        if current_name and current_name.lower() == requested_lower:
            return None

        logger.info(f"Auto-switching model: {current.served_model_name if current else 'none'} -> {requested_model}")

        await evict_model(force=False)
        await asyncio.sleep(2)

        success, pid, message = await launch_model(recipe)
        if not success:
            logger.error(f"Auto-switch failed to launch {requested_model}: {message}")
            return f"Failed to launch model {requested_model}: {message}"

        start = time.time()
        timeout = 300
        ready = False

        while time.time() - start < timeout:
            if pid and not psutil.pid_exists(pid):
                log_file = Path(f"/tmp/vllm_{recipe.id}.log")
                error_tail = ""
                if log_file.exists():
                    try:
                        error_tail = log_file.read_text()[-500:]
                    except Exception:
                        pass
                return f"Model {requested_model} crashed during startup: {error_tail[-200:]}"

            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(f"http://localhost:{settings.inference_port}/health")
                    if r.status_code == 200:
                        ready = True
                        break
            except Exception:
                pass

            await asyncio.sleep(3)

        if not ready:
            return f"Model {requested_model} failed to become ready (timeout)"

        logger.info(f"Auto-switch complete: {requested_model} is ready")
        return None


def parse_tool_calls_from_content(content: str) -> list:
    """Parse tool calls from content when vLLM returns empty tool_calls array.

    Handles various malformed patterns:
    - MCP-style <use_mcp_tool> tags (with missing opening <)
    - Malformed </tool_call> without opening <tool_call>
    - Complete <tool_call>...</tool_call> tags
    - Raw JSON with name/arguments
    """
    import uuid
    tool_calls = []

    # Pattern 0: MCP-style use_mcp_tool format (handles missing opening <, extra spaces)
    mcp_pattern = r'<?use_mcp_tool>\s*<?server_name>([^<]*)</server_name>\s*<?tool_name>([^<]*)</tool_name>\s*<?arguments>\s*(\{.*?\})\s*</arguments>\s*</use_mcp[\s_]*tool>'
    mcp_matches = re.findall(mcp_pattern, content, re.DOTALL)
    for server_name, tool_name, args_json in mcp_matches:
        try:
            tool_calls.append({
                "index": len(tool_calls),
                "id": f"call_{uuid.uuid4().hex[:9]}",
                "type": "function",
                "function": {"name": tool_name.strip(), "arguments": args_json.strip()}
            })
            logger.info(f"Parsed MCP tool call: {tool_name.strip()}")
        except Exception:
            continue
    if tool_calls:
        return tool_calls

    # Pattern 1: Malformed </tool_call> without <tool_call>
    if '</tool_call>' in content:
        pattern = r'\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}\s*</tool_call>'
        matches = re.findall(pattern, content, re.DOTALL)
        for name, args in matches:
            try:
                tool_calls.append({
                    "index": len(tool_calls),
                    "id": f"call_{uuid.uuid4().hex[:9]}",
                    "type": "function",
                    "function": {"name": name, "arguments": args}
                })
                logger.info(f"Parsed tool call from content: {name}")
            except Exception:
                continue

    # Pattern 2: Complete <tool_call>...</tool_call>
    if not tool_calls and '<tool_call>' in content:
        pattern = r'<tool_call>\s*(\{.*?\})\s*</tool_call>'
        matches = re.findall(pattern, content, re.DOTALL)
        for json_str in matches:
            try:
                data = json.loads(json_str)
                tool_calls.append({
                    "index": len(tool_calls),
                    "id": f"call_{uuid.uuid4().hex[:9]}",
                    "type": "function",
                    "function": {
                        "name": data.get("name"),
                        "arguments": json.dumps(data.get("arguments", {}))
                    }
                })
            except Exception:
                continue

    # Pattern 3: Raw JSON with name/arguments at end
    if not tool_calls and '"name"' in content and '"arguments"' in content:
        pattern = r'\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}'
        matches = re.findall(pattern, content, re.DOTALL)
        for name, args in matches:
            tool_calls.append({
                "index": len(tool_calls),
                "id": f"call_{uuid.uuid4().hex[:9]}",
                "type": "function",
                "function": {"name": name, "arguments": args}
            })

    return tool_calls


@router.post("/v1/chat/completions")
async def chat_completions_proxy(request: Request, store: RecipeStore = Depends(get_store)):
    """Proxy chat completions to LiteLLM backend with auto-eviction support.

    If the requested model differs from the currently running model and a matching
    recipe exists, the controller will automatically evict the current model and
    launch the requested one before forwarding the request.
    """
    try:
        body = await request.body()

        try:
            data = json.loads(body)
            requested_model = data.get("model")
            is_streaming = data.get("stream", False)
        except Exception:
            requested_model = None
            is_streaming = False

        if requested_model:
            switch_error = await _ensure_model_running(requested_model, store)
            if switch_error:
                raise HTTPException(status_code=503, detail=switch_error)

        litellm_key = os.environ.get("LITELLM_MASTER_KEY", "sk-master")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {litellm_key}",
        }

        litellm_url = "http://localhost:4100/v1/chat/completions"

        if is_streaming:
            think_state = {"in_thinking": False}

            def parse_think_tags_from_content(data: dict) -> dict:
                """Parse <think>...</think> from content and convert to reasoning_content."""
                if 'choices' not in data:
                    return data

                for choice in data['choices']:
                    delta = choice.get('delta', {})
                    content = delta.get('content')

                    if not content:
                        continue

                    if delta.get('reasoning_content'):
                        continue

                    if '</think>' in content and '<think>' not in content and not think_state["in_thinking"]:
                        parts = content.split('</think>', 1)
                        reasoning = parts[0]
                        remaining = parts[1] if len(parts) > 1 else ''
                        delta['reasoning_content'] = reasoning
                        delta['content'] = remaining.strip() or None
                        continue

                    if '<think>' in content:
                        parts = content.split('<think>', 1)
                        before = parts[0]
                        after = parts[1] if len(parts) > 1 else ''

                        think_state["in_thinking"] = True

                        if '</think>' in after:
                            think_parts = after.split('</think>', 1)
                            reasoning = think_parts[0]
                            remaining = think_parts[1] if len(think_parts) > 1 else ''
                            think_state["in_thinking"] = False

                            delta['reasoning_content'] = reasoning
                            delta['content'] = (before + remaining).strip() or None
                        else:
                            delta['reasoning_content'] = after
                            delta['content'] = before.strip() or None

                    elif think_state["in_thinking"]:
                        if '</think>' in content:
                            parts = content.split('</think>', 1)
                            reasoning = parts[0]
                            remaining = parts[1] if len(parts) > 1 else ''
                            think_state["in_thinking"] = False

                            delta['reasoning_content'] = reasoning
                            delta['content'] = remaining.strip() or None
                        else:
                            delta['reasoning_content'] = content
                            delta['content'] = None

                return data

            tool_call_buffer = {
                "content": "",
                "tool_args": "",
                "tool_name": "",
                "has_malformed_tool_calls": False,
                "tool_calls_found": False
            }

            def fix_malformed_tool_calls(data: dict) -> dict:
                """Fix tool calls with empty function names by re-parsing from content."""
                if 'choices' not in data:
                    return data

                for choice in data['choices']:
                    delta = choice.get('delta', {})
                    message = choice.get('message', delta)

                    content = message.get('content', '') or ''
                    if content:
                        tool_call_buffer["content"] += content

                    tool_calls = message.get('tool_calls', [])
                    if not tool_calls:
                        continue

                    fixed_tool_calls = []
                    for tc in tool_calls:
                        func = tc.get('function', {})
                        name = func.get('name', '')
                        if not name or name.strip() == '':
                            tool_call_buffer["has_malformed_tool_calls"] = True
                            logger.warning(f"Detected malformed tool call with empty name: {tc}")
                            buffered = tool_call_buffer["content"]
                            if '<tool_call>' in buffered or '"name"' in buffered:
                                name_match = re.search(r'"name"\s*:\s*"([^"]+)"', buffered)
                                if name_match:
                                    extracted_name = name_match.group(1)
                                    func['name'] = extracted_name
                                    logger.info(f"Fixed malformed tool call: extracted name={extracted_name}")
                        fixed_tool_calls.append(tc)

                    if tool_calls:
                        message['tool_calls'] = fixed_tool_calls

                return data

            async def stream_response():
                import uuid as uuid_mod

                async with httpx.AsyncClient(timeout=300) as client:
                    async with client.stream("POST", litellm_url, content=body, headers=headers) as response:
                        async for chunk in response.aiter_bytes():
                            chunk_str = chunk.decode('utf-8', errors='ignore')
                            if '"role":"user"' in chunk_str and '"tool_calls":[]' in chunk_str:
                                continue

                            if '"reasoning":' in chunk_str and '"reasoning_content":' in chunk_str:
                                try:
                                    lines = chunk_str.split('\n')
                                    fixed_lines = []
                                    for line in lines:
                                        if line.startswith('data: ') and line != 'data: [DONE]':
                                            data_json = line[6:]
                                            if data_json.strip():
                                                data = json.loads(data_json)
                                                if 'choices' in data:
                                                    for choice in data['choices']:
                                                        if 'delta' in choice and 'reasoning' in choice['delta']:
                                                            del choice['delta']['reasoning']
                                                fixed_lines.append('data: ' + json.dumps(data))
                                            else:
                                                fixed_lines.append(line)
                                        else:
                                            fixed_lines.append(line)
                                    chunk = ('\n'.join(fixed_lines)).encode('utf-8')
                                except Exception:
                                    pass

                            if '<think>' in chunk_str or think_state["in_thinking"]:
                                try:
                                    lines = chunk_str.split('\n')
                                    fixed_lines = []
                                    for line in lines:
                                        if line.startswith('data: ') and line != 'data: [DONE]':
                                            data_json = line[6:]
                                            if data_json.strip():
                                                data = json.loads(data_json)
                                                data = parse_think_tags_from_content(data)
                                                fixed_lines.append('data: ' + json.dumps(data))
                                            else:
                                                fixed_lines.append(line)
                                        else:
                                            fixed_lines.append(line)
                                    chunk = ('\n'.join(fixed_lines)).encode('utf-8')
                                except Exception as e:
                                    logger.warning(f"Think tag parsing error: {e}")
                                    pass

                            if '"tool_calls"' in chunk_str or '<tool_call>' in chunk_str or '"name"' in chunk_str:
                                try:
                                    lines = chunk_str.split('\n')
                                    fixed_lines = []
                                    for line in lines:
                                        if line.startswith('data: ') and line != 'data: [DONE]':
                                            data_json = line[6:]
                                            if data_json.strip():
                                                data = json.loads(data_json)
                                                data = fix_malformed_tool_calls(data)
                                                fixed_lines.append('data: ' + json.dumps(data))
                                            else:
                                                fixed_lines.append(line)
                                        else:
                                            fixed_lines.append(line)
                                    chunk = ('\n'.join(fixed_lines)).encode('utf-8')
                                except Exception as e:
                                    logger.warning(f"Tool call fix error: {e}")
                                    pass

                            try:
                                for line in chunk_str.split('\n'):
                                    if line.startswith('data: ') and line != 'data: [DONE]':
                                        data = json.loads(line[6:])
                                        if 'choices' in data:
                                            for choice in data['choices']:
                                                delta = choice.get('delta', {})
                                                content = delta.get('content', '') or ''
                                                reasoning = delta.get('reasoning_content', '') or ''
                                                if content:
                                                    tool_call_buffer["content"] += content
                                                if reasoning:
                                                    tool_call_buffer["content"] += reasoning
                                                tc = delta.get('tool_calls', [])
                                                if tc and len(tc) > 0:
                                                    for tool_call in tc:
                                                        func = tool_call.get('function', {})
                                                        name = func.get('name', '')
                                                        args = func.get('arguments', '')
                                                        if name:
                                                            tool_call_buffer["tool_name"] = name
                                                            tool_call_buffer["tool_calls_found"] = True
                                                        if args:
                                                            tool_call_buffer["tool_args"] += args
                            except Exception:
                                pass

                            yield chunk

                        parsed_tools = []

                        if not tool_call_buffer["tool_calls_found"] and tool_call_buffer["tool_args"]:
                            args_str = tool_call_buffer["tool_args"].strip()
                            name = tool_call_buffer["tool_name"]

                            if not name:
                                content = tool_call_buffer["content"]
                                name_match = re.search(r'use the (\w+) (?:tool|function)', content, re.IGNORECASE)
                                if name_match:
                                    name = name_match.group(1)
                                if not name:
                                    json_name_match = re.search(r'"name"\s*:\s*"([^"]+)"', content)
                                    if json_name_match:
                                        name = json_name_match.group(1)

                            if args_str.startswith('{') and args_str.endswith('}') and name:
                                parsed_tools.append({
                                    "index": 0,
                                    "id": f"call_{uuid_mod.uuid4().hex[:9]}",
                                    "type": "function",
                                    "function": {"name": name, "arguments": args_str}
                                })
                                logger.info(f"[TOOL PARSE] Reconstructed tool call from streamed args: {name}")

                        if not parsed_tools and not tool_call_buffer["tool_calls_found"] and tool_call_buffer["content"]:
                            content = tool_call_buffer["content"]
                            if ('</tool_call>' in content or '<tool_call>' in content or
                                '</use_mcp_tool>' in content or 'use_mcp_tool>' in content or
                                ('"name"' in content and '"arguments"' in content)):
                                logger.info("[TOOL PARSE] Pattern matched, parsing...")
                                parsed_tools = parse_tool_calls_from_content(content)
                                logger.info(f"[TOOL PARSE] Parsed {len(parsed_tools)} tools: {parsed_tools}")

                        if parsed_tools:
                            logger.info(f"Emitting {len(parsed_tools)} tool calls parsed from stream")
                            final_chunk = {
                                "id": f"chatcmpl-{uuid_mod.uuid4().hex[:8]}",
                                "choices": [{
                                    "index": 0,
                                    "delta": {"tool_calls": parsed_tools},
                                    "finish_reason": "tool_calls"
                                }]
                            }
                            yield f"data: {json.dumps(final_chunk)}\n\n".encode('utf-8')

            return StreamingResponse(
                stream_response(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                }
            )
        else:
            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.post(litellm_url, content=body, headers=headers)
                result = response.json()

                if 'choices' in result and result['choices']:
                    choice = result['choices'][0]
                    message = choice.get('message', {})
                    tool_calls = message.get('tool_calls')
                    content = message.get('content', '') or ''
                    reasoning = message.get('reasoning_content', '') or ''

                    full_content = content + reasoning

                    if (not tool_calls or tool_calls == []) and full_content:
                        has_tool_pattern = (
                            '</tool_call>' in full_content or
                            '<tool_call>' in full_content or
                            '</use_mcp_tool>' in full_content or
                            'use_mcp_tool>' in full_content or
                            ('"name"' in full_content and '"arguments"' in full_content)
                        )

                        if has_tool_pattern:
                            parsed_tools = parse_tool_calls_from_content(full_content)
                            if parsed_tools:
                                logger.info(f"Non-streaming: Parsed {len(parsed_tools)} tool calls from content")
                                result['choices'][0]['message']['tool_calls'] = parsed_tools
                                result['choices'][0]['finish_reason'] = 'tool_calls'

                return JSONResponse(
                    content=result,
                    status_code=response.status_code
                )
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="LiteLLM backend unavailable")
    except Exception as e:
        logger.error(f"Chat completions proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
