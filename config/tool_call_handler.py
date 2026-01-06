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
            }
        return self._stream_buffers[request_id]

    def _cleanup_stream_buffer(self, request_id: str):
        """Clean up stream buffer after request completes."""
        if request_id in self._stream_buffers:
            del self._stream_buffers[request_id]

    async def async_pre_call_hook(
        self,
        user_api_key_dict,
        cache,
        data: dict,
        call_type: Literal["completion", "text_completion", "embeddings", "image_generation", "moderation", "audio_transcription"]
    ):
        """Convert deprecated functions parameter to tools format."""
        logger.info(f"[PRE-CALL] call_type={call_type}, has_functions={'functions' in data}, has_tools={'tools' in data}")
        print(f"[PRE-CALL] call_type={call_type}, has_functions={'functions' in data}", flush=True)

        if call_type not in ("completion", "acompletion"):
            return data

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

            logger.info(f"[ToolCallHandler] Converted {len(functions)} functions to tools format")
            print(f"[ToolCallHandler] Converted {len(functions)} functions to tools format", flush=True)

        return data

    def _parse_tool_calls(self, content: str) -> List[dict]:
        """Parse tool calls from various formats."""
        tool_calls = []
        content = content.strip()

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

        # Pattern 4: Raw JSON with name/arguments
        if not matches:
            raw_json_pattern = r'\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\}'
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

        for match in matches:
            try:
                json_str = match.strip()
                json_match = re.search(r'\{[^{}]*\}', json_str)
                if json_match:
                    json_str = json_match.group(0)

                tool_data = json.loads(json_str)
                function_name = tool_data.get("name")
                arguments = tool_data.get("arguments", {})

                if not arguments and isinstance(tool_data, dict):
                    arguments = {k: v for k, v in tool_data.items() if k != "name"}

                if function_name:
                    tool_calls.append({
                        "id": f"call_{uuid.uuid4().hex[:9]}",
                        "type": "function",
                        "function": {
                            "name": function_name,
                            "arguments": json.dumps(arguments) if isinstance(arguments, dict) else str(arguments)
                        }
                    })
            except (json.JSONDecodeError, AttributeError):
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
                    if existing_tool_calls:
                        return response

                    if '<tool_call>' in content or '<function_calls>' in content or (content.strip().startswith('{') and '"name"' in content):
                        logger.info(f"[POST-CALL] Found tool calls in content, parsing...")
                        parsed_tool_calls = self._parse_tool_calls(content)
                        if parsed_tool_calls:
                            message.tool_calls = parsed_tool_calls
                            choice.finish_reason = "tool_calls"
                            logger.info(f"[POST-CALL] Added {len(parsed_tool_calls)} tool calls to response")
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

    # NOTE: async_post_call_streaming_iterator_hook removed - using deployment hook only

    async def async_post_call_streaming_deployment_hook(
        self,
        request_data: dict,
        response_chunk: Any,
        call_type: Optional[Any],
    ) -> Optional[Any]:
        """
        Streaming: Buffer content and extract think tags.
        Called for each streaming chunk.
        """
        logger.info(f"[STREAMING-DEPLOY-HOOK] Called with chunk type={type(response_chunk).__name__}")
        try:
            # Get request ID for buffer tracking
            request_id = request_data.get('litellm_call_id') or request_data.get('id') or 'unknown'
            buf = self._get_stream_buffer(request_id)

            # Check if this is a streaming chunk with choices
            if hasattr(response_chunk, 'choices') and response_chunk.choices:
                choice = response_chunk.choices[0]
                delta = getattr(choice, 'delta', None)

                if delta:
                    content = getattr(delta, 'content', None) or ''

                    if content:
                        # Add to buffer
                        buf['buffer'] += content

                        # Check if we're entering thinking mode
                        if not buf['in_thinking'] and '<think>' in buf['buffer']:
                            buf['in_thinking'] = True

                        # Handle </think> without <think> (GLM-4.7 style - strips opening tag)
                        if not buf['in_thinking'] and not buf['think_complete'] and '</think>' in buf['buffer']:
                            buf['think_complete'] = True
                            parts = buf['buffer'].split('</think>', 1)
                            reasoning = parts[0].strip()
                            remaining = parts[1].strip() if len(parts) > 1 else ''

                            if reasoning and not buf['reasoning_emitted']:
                                if hasattr(delta, 'reasoning_content'):
                                    delta.reasoning_content = reasoning
                                else:
                                    setattr(delta, 'reasoning_content', reasoning)
                                buf['reasoning_emitted'] = True

                            delta.content = remaining or None
                            logger.info(f"[STREAMING] No <think> tag, reasoning={len(reasoning)} chars, remaining={len(remaining)} chars")

                        # Check if we've seen the end of thinking (with <think> tag)
                        elif buf['in_thinking'] and not buf['think_complete'] and '</think>' in buf['buffer']:
                            buf['think_complete'] = True
                            # Split the buffer
                            reasoning, remaining = self._parse_think_tags(buf['buffer'])

                            if reasoning and not buf['reasoning_emitted']:
                                # Emit reasoning_content in this chunk
                                if hasattr(delta, 'reasoning_content'):
                                    delta.reasoning_content = reasoning
                                else:
                                    setattr(delta, 'reasoning_content', reasoning)
                                buf['reasoning_emitted'] = True

                            # Set content to only the part after </think>
                            delta.content = remaining
                            logger.info(f"[STREAMING] Think complete, reasoning={len(reasoning or '')} chars, remaining={len(remaining)} chars")

                        elif buf['in_thinking'] and not buf['think_complete']:
                            # In thinking mode - move content to reasoning_content
                            clean_content = content.replace('<think>', '')
                            if hasattr(delta, 'reasoning_content'):
                                delta.reasoning_content = clean_content
                            else:
                                setattr(delta, 'reasoning_content', clean_content)
                            delta.content = None

                        # If not in thinking mode, content passes through normally

                    # Check for finish_reason to clean up buffer
                    finish_reason = getattr(choice, 'finish_reason', None)
                    if finish_reason:
                        self._cleanup_stream_buffer(request_id)

        except Exception as e:
            logger.error(f"[STREAMING-HOOK] Error: {e}")

        return response_chunk


proxy_handler_instance = ToolCallHandler()
