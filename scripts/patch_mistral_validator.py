#!/usr/bin/env python3
"""Patch mistral_common validator to accept any tool_call_id format.

This script patches the mistral_common library to normalize tool_call_ids
instead of rejecting non-standard formats like 'toolu_abc123'.

The patch extracts/generates a valid 9-char alphanumeric ID from any input.
"""
import hashlib
import re
import sys
from pathlib import Path


def normalize_tool_id(tool_id: str) -> str:
    """Convert any tool_call_id to 9-char alphanumeric format."""
    if not tool_id:
        return "a" * 9
    # If already valid, return as-is
    if re.match(r"^[a-zA-Z0-9]{9}$", tool_id):
        return tool_id
    # Extract alphanumeric chars
    clean = re.sub(r"[^a-zA-Z0-9]", "", tool_id)
    if len(clean) >= 9:
        return clean[-9:]  # Use last 9 chars
    # Hash to get consistent 9-char ID
    h = hashlib.md5(tool_id.encode()).hexdigest()
    return h[:9]


PATCH_CODE = '''
# PATCHED: Accept any tool_call_id format by normalizing
import hashlib as _hashlib
import re as _re

def _normalize_tool_id(tool_id: str) -> str:
    """Normalize tool_call_id to 9-char alphanumeric."""
    if not tool_id:
        return "a" * 9
    if _re.match(r"^[a-zA-Z0-9]{9}$", tool_id):
        return tool_id
    clean = _re.sub(r"[^a-zA-Z0-9]", "", tool_id)
    if len(clean) >= 9:
        return clean[-9:]
    h = _hashlib.md5(tool_id.encode()).hexdigest()
    return h[:9]

_orig_validate_tool_msg = MistralRequestValidator._validate_tool_message
_orig_validate_tool_call = MistralRequestValidator._validate_tool_call
_orig_validate_tool_msg_v3 = MistralRequestValidatorV3._validate_tool_message

def _patched_validate_tool_message(self, message):
    if hasattr(message, 'tool_call_id') and message.tool_call_id:
        object.__setattr__(message, 'tool_call_id', _normalize_tool_id(message.tool_call_id))
    return _orig_validate_tool_msg(self, message)

def _patched_validate_tool_message_v3(self, message):
    if hasattr(message, 'tool_call_id') and message.tool_call_id:
        object.__setattr__(message, 'tool_call_id', _normalize_tool_id(message.tool_call_id))
    return _orig_validate_tool_msg_v3(self, message)

def _patched_validate_tool_call(self, tool_call, is_last_message):
    if hasattr(tool_call, 'id') and tool_call.id and tool_call.id != "null":
        object.__setattr__(tool_call, 'id', _normalize_tool_id(tool_call.id))
    return _orig_validate_tool_call(self, tool_call, is_last_message)

MistralRequestValidator._validate_tool_message = _patched_validate_tool_message
MistralRequestValidator._validate_tool_call = _patched_validate_tool_call
MistralRequestValidatorV3._validate_tool_message = _patched_validate_tool_message_v3
# END PATCH
'''


def patch_validator(venv_path: str):
    """Apply the patch to mistral_common validator."""
    validator_path = Path(venv_path) / "lib" / "python3.12" / "site-packages" / "mistral_common" / "protocol" / "instruct" / "validator.py"

    if not validator_path.exists():
        print(f"ERROR: Validator not found at {validator_path}")
        sys.exit(1)

    content = validator_path.read_text()

    if "# PATCHED:" in content:
        print("Already patched!")
        return

    # Add patch at the end of the file
    patched = content + "\n" + PATCH_CODE

    validator_path.write_text(patched)
    print(f"Patched: {validator_path}")
    print("Restart vLLM for changes to take effect.")


if __name__ == "__main__":
    venv = "/opt/venvs/active/devstral-vllm-nightly"
    patch_validator(venv)
