#!/usr/bin/env python3
"""
TabbyAPI GLM-4.5/4.7 Proxy

Transforms GLM responses:
- <think>...</think> -> reasoning_content
- <tool_call>fn_name <arg>val</arg></tool_call> -> OpenAI tool_calls format

Supports both streaming and non-streaming.

Usage:
    python3 tabby_proxy.py
"""
import json
import re
import hashlib
from typing import Dict, List, Any, Tuple, Optional
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

TABBY_URL = "http://localhost:8000"
TABBY_API_KEY = "2203f577688173dad689c6f65884778c"

app = FastAPI(title="TabbyAPI GLM Proxy")


def hash_string(s: str) -> str:
    """Generate a unique ID from string content."""
    h = 0
    for c in s:
        h = ((h << 5) - h + ord(c)) & 0xFFFFFFFF
        if h & 0x80000000:
            h = h - 0x100000000
    return f"call_{abs(h)}"


def parse_args_section(args_section: str) -> Dict[str, Any]:
    """Parse XML argument section: <arg>value</arg> -> {"arg": "value"}"""
    args = {}
    if not args_section:
        return args

    # Match <key>value</key> patterns
    arg_pattern = re.compile(r'<([^/>]+)>(.*?)</\1>', re.DOTALL)
    matches = arg_pattern.findall(args_section)

    for key, value in matches:
        processed_value = value.strip()

        # Handle Python bytes format b'...' or b"..."
        if (processed_value.startswith("b'") and processed_value.endswith("'")) or \
           (processed_value.startswith('b"') and processed_value.endswith('"')):
            processed_value = processed_value[2:-1]

        # Unescape quotes
        processed_value = processed_value.replace('\\"', '"')

        # Try to parse as JSON
        try:
            args[key] = json.loads(processed_value)
        except (json.JSONDecodeError, ValueError):
            args[key] = processed_value

    return args


def extract_think_content(content: str) -> Tuple[Optional[str], str]:
    """Extract <think>...</think> block and return (reasoning_content, remaining_content)."""
    if not content or not isinstance(content, str):
        return None, content or ""

    # Pattern for think blocks - greedy to capture all thinking
    think_pattern = re.compile(r'<think>(.*?)</think>', re.DOTALL)

    think_matches = think_pattern.findall(content)
    if think_matches:
        # Join all think blocks
        reasoning_content = "\n".join(m.strip() for m in think_matches)
        # Remove think blocks from content
        remaining = think_pattern.sub('', content).strip()
        return reasoning_content, remaining

    return None, content


def clean_tool_call_tags(content: str) -> str:
    """Remove all <tool_call> tags and their content from string."""
    if not content:
        return content

    # Remove closed tool_call tags
    content = re.sub(r'<tool_call>[\s\S]*?</tool_call>', '', content)

    # Remove unclosed tool_call tags (everything from <tool_call> to end or next tag)
    content = re.sub(r'<tool_call>[\s\S]*?(?=<[a-z]|$)', '', content)

    # Remove any remaining <tool_call> opening tags
    content = re.sub(r'<tool_call>[^<]*$', '', content)

    return content.strip()


def extract_tool_calls(content: str) -> Tuple[List[Dict], str]:
    """Extract <tool_call>...</tool_call> blocks into OpenAI format."""
    if not content or not isinstance(content, str):
        return [], content or ""

    tool_calls = []

    # Pattern 1: Closed XML format - <tool_call>function_name <param>value</param>...</tool_call>
    xml_pattern = re.compile(
        r'<tool_call>\s*(\w+)\s*([\s\S]*?)\s*</tool_call>',
        re.MULTILINE
    )

    # Pattern 2: Closed JSON format - <tool_call>{"name": "...", "arguments": {...}}</tool_call>
    json_closed_pattern = re.compile(
        r'<tool_call>\s*(\{[\s\S]*?\})\s*</tool_call>',
        re.MULTILINE
    )

    # Pattern 3: Unclosed JSON format - <tool_call>{"name": "...", "arguments": {...}} (no closing tag)
    json_unclosed_pattern = re.compile(
        r'<tool_call>\s*(\{[^<]*\})\s*(?:</tool_call>)?',
        re.MULTILINE
    )

    modified = content

    # Try XML format first (closed tags)
    xml_matches = xml_pattern.findall(content)
    if xml_matches:
        modified = xml_pattern.sub('', content)
        for tool_name, args_content in xml_matches:
            tool_name = tool_name.strip()
            args = parse_args_section(args_content)

            full_match = f"<tool_call>{tool_name} {args_content}</tool_call>"
            call_id = hash_string(full_match)

            tool_calls.append({
                "id": call_id,
                "type": "function",
                "function": {
                    "name": tool_name,
                    "arguments": json.dumps(args)
                }
            })

    # Try JSON format (both closed and unclosed)
    json_matches = json_unclosed_pattern.findall(modified)
    if json_matches:
        modified = json_unclosed_pattern.sub('', modified)
        for json_str in json_matches:
            try:
                data = json.loads(json_str)
                fn_name = data.get("name", "")
                arguments = data.get("arguments", {})

                if fn_name:
                    call_id = hash_string(json_str)
                    tool_calls.append({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": fn_name,
                            "arguments": json.dumps(arguments) if isinstance(arguments, dict) else str(arguments)
                        }
                    })
            except json.JSONDecodeError:
                continue

    # Final cleanup - remove any remaining tool_call tags
    modified = clean_tool_call_tags(modified)

    return tool_calls, modified.strip()


def transform_response(response_data: dict) -> dict:
    """Transform GLM response: extract thinking and tool calls."""
    if "choices" not in response_data:
        return response_data

    for choice in response_data.get("choices", []):
        message = choice.get("message", {})
        content = message.get("content", "") or ""

        # 1. Extract <think> -> reasoning_content
        reasoning_content, content = extract_think_content(content)
        if reasoning_content:
            message["reasoning_content"] = reasoning_content

        # 2. Handle tool calls
        existing_tool_calls = message.get("tool_calls", [])

        if "<tool_call>" in content:
            # Extract tool calls from content
            new_tool_calls, content = extract_tool_calls(content)

            # If TabbyAPI didn't already provide tool_calls, use ours
            if not existing_tool_calls and new_tool_calls:
                message["tool_calls"] = new_tool_calls
                choice["finish_reason"] = "tool_calls"
        else:
            # Even if no <tool_call> tag, clean up any remnants
            content = clean_tool_call_tags(content)

        # Update cleaned content (None if empty, to match OpenAI format)
        message["content"] = content if content else None

    return response_data


def transform_stream_chunk(chunk_data: dict, accumulated: dict) -> dict:
    """Transform a streaming chunk, accumulating content for final processing."""
    if "choices" not in chunk_data:
        return chunk_data

    for choice in chunk_data.get("choices", []):
        delta = choice.get("delta", {})
        content = delta.get("content", "")

        if content:
            # Accumulate for later processing
            idx = choice.get("index", 0)
            if idx not in accumulated:
                accumulated[idx] = ""
            accumulated[idx] += content

    return chunk_data


# Global client for connection pooling
http_client = httpx.AsyncClient(timeout=600.0)


@app.api_route("/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy(request: Request, path: str):
    """Proxy all /v1/* requests to TabbyAPI with GLM transformation."""
    url = f"{TABBY_URL}/v1/{path}"

    headers = dict(request.headers)
    headers["Authorization"] = f"Bearer {TABBY_API_KEY}"
    headers.pop("host", None)

    body = await request.body()

    # Check request type
    is_streaming = False
    is_chat = path == "chat/completions"

    if body:
        try:
            data = json.loads(body)
            is_streaming = data.get("stream", False)
        except:
            pass

    if is_streaming and is_chat:
        # Streaming: accumulate and transform at the end
        async def stream_generator():
            accumulated_content = {}
            buffer = ""

            async with http_client.stream(
                request.method,
                url,
                headers=headers,
                content=body,
            ) as response:
                async for chunk in response.aiter_text():
                    buffer += chunk

                    # Process complete SSE messages
                    while "\n\n" in buffer:
                        message, buffer = buffer.split("\n\n", 1)

                        for line in message.split("\n"):
                            if line.startswith("data: "):
                                data_str = line[6:]

                                if data_str.strip() == "[DONE]":
                                    yield f"data: [DONE]\n\n"
                                    continue

                                try:
                                    chunk_data = json.loads(data_str)

                                    # Process delta content
                                    for choice in chunk_data.get("choices", []):
                                        delta = choice.get("delta", {})
                                        content = delta.get("content", "")

                                        if content:
                                            idx = choice.get("index", 0)
                                            if idx not in accumulated_content:
                                                accumulated_content[idx] = ""
                                            accumulated_content[idx] += content

                                            # Check for complete think block
                                            acc = accumulated_content[idx]
                                            if "</think>" in acc and "<think>" in acc:
                                                reasoning, remaining = extract_think_content(acc)
                                                if reasoning:
                                                    # Send reasoning_content delta
                                                    chunk_data["choices"][0]["delta"]["reasoning_content"] = reasoning
                                                    accumulated_content[idx] = remaining
                                                    delta["content"] = ""

                                            # Check for complete tool_call block
                                            if "</tool_call>" in accumulated_content[idx]:
                                                acc = accumulated_content[idx]
                                                tool_calls, remaining = extract_tool_calls(acc)
                                                if tool_calls:
                                                    # For streaming, we'll include tool_calls in final chunk
                                                    accumulated_content[idx] = remaining
                                                    delta["content"] = remaining
                                                    # Add tool_calls to delta
                                                    delta["tool_calls"] = tool_calls
                                                    choice["finish_reason"] = "tool_calls"

                                    yield f"data: {json.dumps(chunk_data)}\n\n"

                                except json.JSONDecodeError:
                                    yield f"data: {data_str}\n\n"

        return StreamingResponse(
            stream_generator(),
            media_type="text/event-stream",
        )
    else:
        # Non-streaming: transform complete response
        response = await http_client.request(
            request.method,
            url,
            headers=headers,
            content=body,
        )

        if is_chat:
            try:
                data = response.json()
                data = transform_response(data)
                return JSONResponse(content=data, status_code=response.status_code)
            except:
                pass

        return JSONResponse(
            content=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
            status_code=response.status_code
        )


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "upstream": TABBY_URL}


if __name__ == "__main__":
    print("Starting TabbyAPI GLM Proxy")
    print(f"  Listening: http://0.0.0.0:8001")
    print(f"  Upstream:  {TABBY_URL}")
    uvicorn.run(app, host="0.0.0.0", port=8001)
