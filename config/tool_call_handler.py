"""
Custom LiteLLM callback handler for tool call handling and think tag parsing.

1. PRE-CALL: Converts deprecated functions parameter to tools format
2. POST-CALL: Parses tool_calls from content (for models using XML format)
3. POST-CALL: Extracts <think>...</think> content to reasoning_content field
"""
import json
import re
import uuid
import logging
from typing import List, Literal, Optional, Any, Dict
from litellm.integrations.custom_logger import CustomLogger

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ToolCallHandler")

# Pattern to match think tags - captures content between <think> and </think>
# Handles both with and without opening <think> tag
THINK_PATTERN = re.compile(r'^(?:<think>)?(.*?)</think>(.*)$', re.DOTALL)


class ToolCallHandler(CustomLogger):
    """Handle tool calls: convert functions->tools and parse from content + think tag parsing."""

    def __init__(self):
        super().__init__()
        # Track streaming state per request_id for think tag parsing
        self._stream_buffers: Dict[str, dict] = {}
        logger.info("ToolCallHandler initialized with functions-to-tools + think tag parsing!")
        print("ToolCallHandler initialized with functions-to-tools + think tag parsing!", flush=True)

    def _parse_think_tags(self, content: str) -> tuple[Optional[str], str]:
        """
        Parse content for think tags.
        Returns (reasoning_content, main_content).
        If no </think> tag found, returns (None, original_content).
        """
        if not content:
            return None, content

        # Match pattern: everything before </think> is reasoning, everything after is content
        match = THINK_PATTERN.match(content)
        if match:
            reasoning = match.group(1).strip()
            main_content = match.group(2).strip()
            return reasoning, main_content

        return None, content

    def _get_stream_buffer(self, request_id: str) -> dict:
        """Get or create a stream buffer for a request."""
        if request_id not in self._stream_buffers:
            self._stream_buffers[request_id] = {
                'buffer': '',
                'in_thinking': False,  # Only true after seeing <think>
                'think_complete': False,
                'reasoning_emitted': False,
                # MCP XML tracking
                'in_mcp_xml': False,
                'mcp_buffer': '',
                'content_buffer': '',  # Buffer content for final processing
                'tool_calls': [],
            }
        return self._stream_buffers[request_id]

    def _cleanup_stream_buffer(self, request_id: str):
        """Clean up stream buffer after request completes."""
        if request_id in self._stream_buffers:
            del self._stream_buffers[request_id]

    def _tools_to_mcp_prompt(self, tools: List[dict]) -> str:
        """Convert OpenAI tools format to MCP system prompt format for MiroThinker."""
        tool_docs = []
        for tool in tools:
            if tool.get("type") == "function":
                func = tool.get("function", {})
                name = func.get("name", "unknown")
                desc = func.get("description", "")
                params = func.get("parameters", {})

                # Parse server__tool format (e.g., exa__search -> server=exa, tool=search)
                if "__" in name:
                    server, tool_name = name.split("__", 1)
                else:
                    server, tool_name = "default", name

                tool_docs.append(f"""## {server} / {tool_name}
{desc}
Parameters: {json.dumps(params, indent=2)}""")

        mcp_prompt = """
# Available Tools

IMPORTANT: You can ONLY use the tools listed below. Do NOT invent or call any other tools like "google_search" or "scrape_and_extract_info" - they do not exist.

To call a tool, use this EXACT XML format:
<use_mcp_tool>
<server_name>SERVER_NAME</server_name>
<tool_name>TOOL_NAME</tool_name>
<arguments>
{"param": "value"}
</arguments>
</use_mcp_tool>

## Available Tools:

""" + "\n\n".join(tool_docs) + """

REMINDER: Only use the tools listed above. Use the exact server_name and tool_name shown."""

        return mcp_prompt

    def _is_mcp_model(self, model: str) -> bool:
        """Check if model uses MCP-style tool calls (not OpenAI native)."""
        model_lower = (model or "").lower()
        return "mirothinker" in model_lower

    async def async_pre_call_hook(
        self,
        user_api_key_dict,
        cache,
        data: dict,
        call_type: Literal["completion", "text_completion", "embeddings", "image_generation", "moderation", "audio_transcription"]
    ):
        """Convert tools to MCP format for MiroThinker models."""
        logger.info(f"[PRE-CALL] call_type={call_type}, has_functions={'functions' in data}, has_tools={'tools' in data}")

        if call_type not in ("completion", "acompletion"):
            return data

        # Convert deprecated functions to tools first
        if "functions" in data and "tools" not in data:
            functions = data.pop("functions")
            data["tools"] = [{"type": "function", "function": f} for f in functions]
            if "function_call" in data:
                fc = data.pop("function_call")
                if fc == "auto":
                    data["tool_choice"] = "auto"
                elif fc == "none":
                    data["tool_choice"] = "none"
                elif isinstance(fc, dict) and "name" in fc:
                    data["tool_choice"] = {"type": "function", "function": {"name": fc["name"]}}

        # For MCP models (MiroThinker): convert tools to system prompt, remove from request
        model = data.get("model", "")
        if self._is_mcp_model(model) and "tools" in data:
            tools = data.pop("tools", [])
            data.pop("tool_choice", None)  # Remove tool_choice too

            if tools:
                mcp_prompt = self._tools_to_mcp_prompt(tools)
                messages = data.get("messages", [])

                # Prepend MCP tool docs to system message or add new system message
                if messages and messages[0].get("role") == "system":
                    messages[0]["content"] = mcp_prompt + "\n\n" + messages[0].get("content", "")
                else:
                    messages.insert(0, {"role": "system", "content": mcp_prompt})

                data["messages"] = messages
                logger.info(f"[PRE-CALL] Converted {len(tools)} tools to MCP prompt for {model}")

        return data

    def _strip_tool_call_content(self, content: str) -> str:
        """Strip tool call XML/JSON from content so it doesn't show in UI.

        Removes:
        - <use_mcp_tool>...</use_mcp_tool> blocks (including malformed </use_mcp tool>)
        - <tool_call>...</tool_call> blocks
        - Raw JSON tool calls like {"name": "...", "arguments": ...}
        """
        if not content:
            return content

        # Remove MCP tool calls - handle malformed closing tags (</use_mcp tool> with space)
        content = re.sub(r'<?use_mcp_tool>.*?</use_mcp[_ ]?tool>', '', content, flags=re.DOTALL)
        content = re.sub(r'<use_mcp_tool>.*', '', content, flags=re.DOTALL)  # Incomplete at end

        # Remove hermes-style tool calls
        content = re.sub(r'<tool_call>.*?</tool_call>', '', content, flags=re.DOTALL)
        content = re.sub(r'<tool_call>.*', '', content, flags=re.DOTALL)

        # Remove raw JSON tool calls ({"name": "...", "arguments": ...})
        content = re.sub(r'\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}', '', content)

        # Clean up any remaining fragments
        content = re.sub(r'use_mcp_tool>.*?</use_mcp[_ ]?tool>', '', content, flags=re.DOTALL)  # Missing opening <
        content = re.sub(r'use_mcp_tool>.*', '', content, flags=re.DOTALL)  # Incomplete fragment

        return content.strip()

    def _clean_think_tags_from_content(self, content: str) -> str:
        """Remove stray <think> tags from content that may corrupt JSON parsing.

        This handles the case where reasoning parser issues cause <think> tokens
        to be interleaved within structured content (e.g., tool call JSON).
        Example corruption: <think>{"name<think>":<think> "search"...
        """
        if '<think>' not in content:
            return content

        # Remove all <think> tags (but preserve </think> as it marks end of reasoning)
        cleaned = re.sub(r'<think>', '', content)
        logger.info(f"[PARSE] Cleaned stray <think> tags from content")
        return cleaned

    def _parse_tool_calls(self, content: str) -> List[dict]:
        """Parse tool calls from various formats including GLM-4.5/INTELLECT-3 style and MCP format.

        Returns OpenAI-compatible tool_calls format:
        [{"id": "call_xxx", "type": "function", "function": {"name": "...", "arguments": "..."}}]
        """
        tool_calls = []
        content = content.strip()

        # IMPORTANT: Clean any stray <think> tags that may have corrupted the content
        # This handles MiroThinker/Qwen3-Thinking models where reasoning parser issues
        # can cause <think> tokens to appear inside JSON structures
        content = self._clean_think_tags_from_content(content)

        # Pattern 0: MCP-style <use_mcp_tool> format (MiroThinker/Qwen3 MCP)
        # Handles various malformations:
        # - Missing opening < (e.g., "use_mcp_tool>")
        # - Space in closing tag (e.g., "</use_mcp tool>")
        # - Missing closing tag entirely
        mcp_pattern = r'<?use_mcp_tool>\s*<?server_name>([^<]*)</server_name>\s*<?tool_name>([^<]*)</tool_name>\s*<?arguments>\s*(\{.*?\})\s*</arguments>\s*</use_mcp[_ ]?tool>'
        mcp_matches = re.findall(mcp_pattern, content, re.DOTALL)
        for server_name, tool_name, args_json in mcp_matches:
            try:
                # Clean any remaining <think> tags from the JSON
                args_json_clean = self._clean_think_tags_from_content(args_json.strip())
                arguments = json.loads(args_json_clean)

                # Format function name as server__tool for OpenAI compatibility
                # This matches what the frontend expects (e.g., "exa__search")
                server = server_name.strip()
                tool = tool_name.strip()
                function_name = f"{server}__{tool}" if server else tool

                tool_calls.append({
                    "id": f"call_{uuid.uuid4().hex[:9]}",
                    "type": "function",
                    "function": {
                        "name": function_name,
                        "arguments": json.dumps(arguments)
                    }
                })
                logger.info(f"[PARSE] Extracted MCP tool call: {function_name} -> OpenAI format")
            except json.JSONDecodeError as e:
                logger.warning(f"[PARSE] Failed to parse MCP tool call arguments: {e}, trying repair...")
                # Try to repair corrupted JSON by removing non-JSON characters
                try:
                    # Extract just the JSON part more aggressively
                    json_match = re.search(r'\{[^{}]*\}', args_json, re.DOTALL)
                    if json_match:
                        repaired = json_match.group(0)
                        repaired = self._clean_think_tags_from_content(repaired)
                        arguments = json.loads(repaired)
                        server = server_name.strip()
                        tool = tool_name.strip()
                        function_name = f"{server}__{tool}" if server else tool
                        tool_calls.append({
                            "id": f"call_{uuid.uuid4().hex[:9]}",
                            "type": "function",
                            "function": {
                                "name": function_name,
                                "arguments": json.dumps(arguments)
                            }
                        })
                        logger.info(f"[PARSE] Repaired and extracted MCP tool call: {function_name}")
                except Exception as repair_error:
                    logger.error(f"[PARSE] Could not repair MCP tool call: {repair_error}")
                continue

        if tool_calls:
            return tool_calls

        # Pattern 0.5: Malformed </tool_call> without <tool_call> - extract JSON before it
        # Handles: <think>\n{"name": "...", "arguments": {...}}\n</tool_call>
        if '</tool_call>' in content and '<tool_call>' not in content:
            # Find JSON object before </tool_call>
            malformed_pattern = r'(\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\})\s*</tool_call>'
            malformed_matches = re.findall(malformed_pattern, content, re.DOTALL)
            for json_str in malformed_matches:
                try:
                    tool_data = json.loads(json_str.strip())
                    tool_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:9]}",
                        "type": "function",
                        "function": {
                            "name": tool_data.get("name"),
                            "arguments": json.dumps(tool_data.get("arguments", {}))
                        }
                    })
                    logger.info(f"[PARSE] Extracted malformed tool call (no opening tag): name={tool_data.get('name')}")
                except json.JSONDecodeError:
                    continue
            if tool_calls:
                return tool_calls

        # Pattern 1: Complete <tool_call>...</tool_call>
        pattern1 = r'<tool_call>(.*?)</tool_call>'
        matches = re.findall(pattern1, content, re.DOTALL)

        # Pattern 2: <tool_call>...followed by </think>
        if not matches and '<tool_call>' in content:
            pattern2 = r'<tool_call>(.*?)</think>'
            matches = re.findall(pattern2, content, re.DOTALL)

        # Pattern 3: Incomplete - <tool_call>{JSON} at end of string
        if not matches and '<tool_call>' in content:
            pattern3 = r'<tool_call>(\{.*?\})(?:\s*$|(?=<))'
            matches = re.findall(pattern3, content, re.DOTALL)

        # Pattern 4: GLM-style action format: <|action_start|><|plugin|>...JSON...<|action_end|>
        if not matches:
            glm_pattern = r'<\|action_start\|><\|plugin\|>\s*(\{.*?\})\s*<\|action_end\|>'
            matches = re.findall(glm_pattern, content, re.DOTALL)

        # Pattern 5: Raw JSON with name/arguments (handles nested JSON for arguments)
        if not matches:
            # More robust pattern that handles nested braces in arguments
            raw_json_pattern = r'\{"name"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|parameters)"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})\}'
            raw_matches = re.findall(raw_json_pattern, content, re.DOTALL)
            for name, args in raw_matches:
                try:
                    arguments = json.loads(args)
                    tool_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:9]}",
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": json.dumps(arguments)
                        }
                    })
                except json.JSONDecodeError:
                    continue
            if tool_calls:
                return tool_calls

        # Pattern 6: Try to find any JSON object with "name" field (fallback)
        if not matches:
            # Match JSON objects that have a "name" field
            json_pattern = r'\{[^{}]*"name"\s*:\s*"[^"]+(?:"[^{}]*|\{[^{}]*\})*\}'
            matches = re.findall(json_pattern, content, re.DOTALL)

        for match in matches:
            try:
                json_str = match.strip()
                # Try to extract JSON from the match
                json_match = re.search(r'\{(?:[^{}]|\{[^{}]*\})*\}', json_str)
                if json_match:
                    json_str = json_match.group(0)

                tool_data = json.loads(json_str)
                function_name = tool_data.get("name")
                # Support both "arguments" and "parameters" keys
                arguments = tool_data.get("arguments") or tool_data.get("parameters", {})

                if not arguments and isinstance(tool_data, dict):
                    arguments = {k: v for k, v in tool_data.items() if k not in ("name", "id", "type")}

                if function_name:
                    tool_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:9]}",
                        "type": "function",
                        "function": {
                            "name": function_name,
                            "arguments": json.dumps(arguments) if isinstance(arguments, dict) else str(arguments)
                        }
                    })
                    logger.info(f"[PARSE] Extracted tool call: name={function_name}")
            except (json.JSONDecodeError, AttributeError) as e:
                logger.debug(f"[PARSE] Failed to parse tool call from match: {e}")
                continue

        return tool_calls

    async def async_post_call_success_hook(self, data: dict, user_api_key_dict, response):
        """Parse and add tool_calls from content, and extract think tags."""
        logger.info(f"[POST-CALL] Processing response, type={type(response).__name__}")
        try:
            logger.info(f"[POST-CALL] has_choices={hasattr(response, 'choices')}")
            if hasattr(response, 'choices') and response.choices:
                logger.info(f"[POST-CALL] choices_len={len(response.choices)}")
                choice = response.choices[0]
                logger.info(f"[POST-CALL] choice_type={type(choice).__name__}")
                message = getattr(choice, 'message', None)
                logger.info(f"[POST-CALL] message={message is not None}, message_type={type(message).__name__ if message else 'None'}")

                if message:
                    content = getattr(message, 'content', '') or ''
                    logger.info(f"[POST-CALL] Content length={len(content)}, has_think_close={'</think>' in content}")

                    # First, parse think tags from content
                    if '</think>' in content:
                        logger.info(f"[POST-CALL] Found </think>, parsing...")
                        reasoning, main_content = self._parse_think_tags(content)
                        logger.info(f"[POST-CALL] Parsed: reasoning={len(reasoning) if reasoning else 0}, main={len(main_content)}")
                        if reasoning:
                            message.content = main_content
                            # Set reasoning_content field
                            if hasattr(message, 'reasoning_content'):
                                message.reasoning_content = reasoning
                            else:
                                setattr(message, 'reasoning_content', reasoning)
                            logger.info(f"[POST-CALL] SET reasoning_content={len(reasoning)} chars, content={len(main_content)} chars")
                            # Debug: verify the change
                            logger.info(f"[POST-CALL] VERIFY: message.content now={len(message.content)} chars")

                    # Re-read content after potential think tag parsing
                    content = getattr(message, 'content', '') or ''

                    # Then check for tool calls
                    existing_tool_calls = getattr(message, 'tool_calls', None)

                    # Check if existing tool calls have empty function names (vLLM parser failure)
                    has_malformed_tool_calls = False
                    if existing_tool_calls:
                        for tc in existing_tool_calls:
                            func = getattr(tc, 'function', None) or (tc.get('function') if isinstance(tc, dict) else None)
                            if func:
                                name = getattr(func, 'name', None) or (func.get('name') if isinstance(func, dict) else None)
                                if not name or name.strip() == '':
                                    has_malformed_tool_calls = True
                                    logger.warning(f"[POST-CALL] Found malformed tool call with empty function name")
                                    break

                    # If tool calls exist and are valid, return as-is
                    if existing_tool_calls and not has_malformed_tool_calls:
                        return response

                    # Try to parse tool calls from content if:
                    # 1. No existing tool calls, or
                    # 2. Existing tool calls are malformed (empty names)
                    # Check for various MCP formats including malformed tags
                    has_mcp = 'use_mcp_tool>' in content or '<server_name>' in content or '<tool_name>' in content
                    if '<tool_call>' in content or '<function_calls>' in content or has_mcp or (content.strip().startswith('{') and '"name"' in content):
                        logger.info(f"[POST-CALL] Found tool calls in content, parsing...")
                        parsed_tool_calls = self._parse_tool_calls(content)
                        if parsed_tool_calls:
                            message.tool_calls = parsed_tool_calls
                            choice.finish_reason = "tool_calls"

                            # Strip MCP/tool call XML from content so it doesn't show in UI
                            clean_content = self._strip_tool_call_content(content)
                            message.content = clean_content.strip() if clean_content else None

                            if has_malformed_tool_calls:
                                logger.info(f"[POST-CALL] Replaced {len(existing_tool_calls)} malformed tool calls with {len(parsed_tool_calls)} parsed tool calls")
                            else:
                                logger.info(f"[POST-CALL] Added {len(parsed_tool_calls)} tool calls to response, stripped tool XML from content")
        except Exception as e:
            logger.error(f"ToolCallHandler error: {e}")

        return response

    async def async_post_call_success_deployment_hook(
        self,
        request_data: dict,
        response: Any,
        call_type: Optional[Any],
    ) -> Optional[Any]:
        """
        Non-streaming: Extract <think>...</think> content to reasoning_content field.
        Called after receiving response from deployment.
        """
        try:
            if hasattr(response, 'choices') and response.choices:
                choice = response.choices[0]
                message = getattr(choice, 'message', None)

                if message:
                    content = getattr(message, 'content', '') or ''

                    if '</think>' in content:
                        reasoning, main_content = self._parse_think_tags(content)
                        if reasoning:
                            message.content = main_content
                            if hasattr(message, 'reasoning_content'):
                                message.reasoning_content = reasoning
                            else:
                                setattr(message, 'reasoning_content', reasoning)
                            logger.info(f"[DEPLOYMENT-HOOK] Non-streaming: extracted reasoning={len(reasoning)} chars")

        except Exception as e:
            logger.error(f"[DEPLOYMENT-HOOK] Non-streaming error: {e}")

        return response

    # NOTE: async_post_call_streaming_iterator_hook not implemented in LiteLLM proxy
    # See: https://github.com/BerriAI/litellm/issues/9639
    # Using async_log_stream_event for per-chunk processing instead

    async def async_log_stream_event(
        self,
        kwargs,
        response_obj,
        start_time,
        end_time,
    ):
        """
        Per-chunk streaming hook - suppress MCP XML content during streaming.
        Called for each streaming chunk. We can't modify chunks here but we can track state.
        """
        try:
            model = kwargs.get("model", "")
            if not self._is_mcp_model(model):
                return

            request_id = kwargs.get("litellm_call_id") or "unknown"
            buf = self._get_stream_buffer(request_id)

            # Buffer content for final processing
            if hasattr(response_obj, 'choices') and response_obj.choices:
                choice = response_obj.choices[0]
                delta = getattr(choice, 'delta', None)
                if delta:
                    content = getattr(delta, 'content', None) or ''
                    if content:
                        buf['content_buffer'] += content

                    # Check finish reason for final processing
                    finish_reason = getattr(choice, 'finish_reason', None)
                    if finish_reason:
                        # Parse tool calls from buffered content
                        full_content = buf['content_buffer']
                        if 'use_mcp_tool>' in full_content or '<server_name>' in full_content:
                            tool_calls = self._parse_tool_calls(full_content)
                            if tool_calls:
                                buf['tool_calls'] = tool_calls
                                logger.info(f"[STREAM-LOG] Parsed {len(tool_calls)} tool calls from stream")
                        self._cleanup_stream_buffer(request_id)

        except Exception as e:
            logger.error(f"[STREAM-LOG] Error: {e}")


proxy_handler_instance = ToolCallHandler()
