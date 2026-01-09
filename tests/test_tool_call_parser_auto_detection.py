"""Test auto-detection of tool call and reasoning parsers for different models."""

from controller.backends import build_vllm_command
from controller.models import Recipe


def test_intellect_3_auto_detects_hermes_tool_call_parser():
    """INTELLECT-3 should auto-detect hermes tool call parser.

    INTELLECT-3 outputs JSON inside <tool_call> tags like:
    <tool_call>{"name": "func", "arguments": {...}}</tool_call>

    This requires the hermes parser, NOT glm45 which expects:
    <tool_call>func_name
    <arg_key>key</arg_key><arg_value>value</arg_value>
    </tool_call>
    """
    recipe = Recipe(
        id="intellect-3-test",
        name="INTELLECT-3",
        model_path="/mnt/llm_models/INTELLECT-3-REAP-50-W4A16",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--tool-call-parser" in cmd
    parser_index = cmd.index("--tool-call-parser")
    assert cmd[parser_index + 1] == "hermes"
    assert "--enable-auto-tool-choice" in cmd


def test_intellect_3_awq_auto_detects_hermes_tool_call_parser():
    """INTELLECT-3-AWQ should auto-detect hermes tool call parser."""
    recipe = Recipe(
        id="intellect-3-awq-test",
        name="INTELLECT-3-AWQ-8BIT",
        model_path="/mnt/llm_models/INTELLECT-3-AWQ-8bit",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--tool-call-parser" in cmd
    parser_index = cmd.index("--tool-call-parser")
    assert cmd[parser_index + 1] == "hermes"
    assert "--enable-auto-tool-choice" in cmd


def test_glm47_auto_detects_glm45_tool_call_parser():
    """GLM-4.7 should auto-detect glm45 tool call parser."""
    recipe = Recipe(
        id="glm47-test",
        name="glm-4.7",
        model_path="/mnt/llm_models/glm-4.7",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--tool-call-parser" in cmd
    parser_index = cmd.index("--tool-call-parser")
    assert cmd[parser_index + 1] == "glm45"
    assert "--enable-auto-tool-choice" in cmd


def test_glm47_reasoning_parser_auto_detection():
    """GLM-4.7 should auto-detect glm45 reasoning parser."""
    recipe = Recipe(
        id="glm47-test",
        name="glm-4.7",
        model_path="/mnt/llm_models/glm-4.7",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--reasoning-parser" in cmd
    parser_index = cmd.index("--reasoning-parser")
    assert cmd[parser_index + 1] == "glm45"


def test_intellect_3_reasoning_parser_auto_detection():
    """INTELLECT-3 should auto-detect deepseek_r1 reasoning parser."""
    recipe = Recipe(
        id="intellect-3-test",
        name="INTELLECT-3",
        model_path="/mnt/llm_models/INTELLECT-3-REAP-50-W4A16",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--reasoning-parser" in cmd
    parser_index = cmd.index("--reasoning-parser")
    assert cmd[parser_index + 1] == "deepseek_r1"


def test_explicit_tool_call_parser_overrides_auto_detection():
    """Explicitly set tool_call_parser should override auto-detection."""
    recipe = Recipe(
        id="intellect-3-test",
        name="INTELLECT-3",
        model_path="/mnt/llm_models/INTELLECT-3-REAP-50-W4A16",
        backend="vllm",
        tool_call_parser="pythonic",  # Explicit override
    )

    cmd = build_vllm_command(recipe)

    assert "--tool-call-parser" in cmd
    parser_index = cmd.index("--tool-call-parser")
    assert cmd[parser_index + 1] == "pythonic"  # Should use explicit value


def test_model_without_auto_detection_no_tool_call_parser():
    """Models without auto-detection should not get tool call parser by default."""
    recipe = Recipe(
        id="llama-test",
        name="llama-3.1",
        model_path="/mnt/llm_models/llama-3.1",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--tool-call-parser" not in cmd
    assert "--enable-auto-tool-choice" not in cmd


def test_minimax_m2_auto_detection():
    """MiniMax M2 should auto-detect minimax_m2_append_think reasoning parser."""
    recipe = Recipe(
        id="minimax-test",
        name="MiniMax-M2.1",
        model_path="/mnt/llm_models/minimax-m2.1",
        backend="vllm",
    )

    cmd = build_vllm_command(recipe)

    assert "--reasoning-parser" in cmd
    parser_index = cmd.index("--reasoning-parser")
    assert cmd[parser_index + 1] == "minimax_m2_append_think"
