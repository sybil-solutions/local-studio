"""
Custom LiteLLM callback handler to parse tool_calls from content.

GLM-4.7 outputs tool calls in <tool_call>{JSON}</tool_call> format but some
backends (like LiteLLM passthrough) don't preserve the tool_calls field.

This handler parses tool calls from the content and adds them to the response.
"""
import json
import re
import uuid
from typing import List, Optional
from litellm.integrations.custom_logger import CustomLogger


class ToolCallHandler(CustomLogger):
    """Parse tool_calls from content and add to response."""

    def __init__(self):
        super().__init__()
        print("ToolCallHandler initialized!")
        import logging
        logging.info("ToolCallHandler initialized!")

    def _parse_tool_calls(self, content: str) -> List[dict]:
        """Parse tool calls from various formats."""
        tool_calls = []
        content = content.strip()

        # Pattern 1: Complete <tool_call>...</tool_call>
        pattern1 = r'<tool_call>(.*?)</tool_call>'
        matches = re.findall(pattern1, content, re.DOTALL)

        # Pattern 2: <tool_call>...followed by </think> (GLM-4.7 format)
        if not matches and '<tool_call>' in content:
            pattern2 = r'<tool_call>(.*?)</think>'
            matches = re.findall(pattern2, content, re.DOTALL)

        # Pattern 3: Incomplete - <tool_call>{JSON} at end of string
        if not matches and '<tool_call>' in content:
            pattern3 = r'<tool_call>(\{.*?\})(?:\s*$|(?=<))'
            matches = re.findall(pattern3, content, re.DOTALL)

        # Pattern 4: Raw JSON with name/arguments (browser-use format)
        # e.g., {"name":"navigate","arguments":{"url":"..."}}
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

        # Pattern 5: Raw JSON where function name is key (alternative browser-use format)
        # e.g., {"navigate":{"url":"..."}}
        if not matches and not tool_calls:
            try:
                # Try parsing entire content as JSON
                if content.startswith('{') and content.endswith('}'):
                    data = json.loads(content)
                    # Check if it's {function_name: {args}}
                    if len(data) == 1:
                        func_name = list(data.keys())[0]
                        args = data[func_name]
                        if isinstance(args, dict):
                            tool_calls.append({
                                "id": f"call_{uuid.uuid4().hex[:9]}",
                                "type": "function",
                                "function": {
                                    "name": func_name,
                                    "arguments": json.dumps(args)
                                }
                            })
                            return tool_calls
            except json.JSONDecodeError:
                pass

        for match in matches:
            try:
                # Clean up the JSON - sometimes there's reasoning before it
                json_str = match.strip()
                # Find the JSON object in the match
                json_match = re.search(r'\{[^{}]*\}', json_str)
                if json_match:
                    json_str = json_match.group(0)

                tool_data = json.loads(json_str)

                function_name = tool_data.get("name")
                arguments = tool_data.get("arguments", {})

                # Handle case where arguments are at top level
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

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict,
        response,
    ):
        """Called after successful API call - parse and add tool_calls."""
        print(f"async_post_call_success_hook called! Response type: {type(response)}")
        try:
            # Check if response already has tool_calls
            if hasattr(response, 'choices') and response.choices:
                choice = response.choices[0]
                message = getattr(choice, 'message', None)

                if message:
                    # If already has tool_calls, skip
                    existing_tool_calls = getattr(message, 'tool_calls', None)
                    if existing_tool_calls:
                        return response

                    # Parse tool_calls from content
                    content = getattr(message, 'content', '') or ''
                    # Check for XML tool_call tags or raw JSON tool calls
                    if '<tool_call>' in content or (content.strip().startswith('{') and '"name"' in content) or (content.strip().startswith('{') and content.strip().endswith('}')):
                        parsed_tool_calls = self._parse_tool_calls(content)

                        if parsed_tool_calls:
                            # Add tool_calls to response
                            message.tool_calls = parsed_tool_calls
                            # Update finish_reason
                            choice.finish_reason = "tool_calls"
        except Exception as e:
            # Log but don't fail the request
            print(f"ToolCallHandler error: {e}")

        return response


# Create instance for LiteLLM to use
proxy_handler_instance = ToolCallHandler()
