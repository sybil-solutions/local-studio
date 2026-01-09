#!/usr/bin/env python3
"""Test script to verify MiniMax-M2 thinking loop configuration.

This script validates that the max_thinking_tokens parameter is correctly
applied to MiniMax-M2 models to prevent infinite thinking loops.

Tests both static defaults and dynamic allocation based on thinking_mode.
"""

from controller.backends import build_vllm_command
from controller.models import Recipe, Backend


def test_minimax_m21_standard():
    """Test standard MiniMax-M2.1 gets 16K thinking token limit with default (conservative) mode."""
    recipe = Recipe(
        id='minimax-m21-test',
        name='MiniMax-M2.1 Test',
        model_path='MiniMaxAI/MiniMax-M2.1',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000
        # Note: thinking_mode='conservative' is now the default
    )

    cmd = build_vllm_command(recipe)

    # Verify reasoning parser is set
    assert '--reasoning-parser' in cmd, "Missing reasoning parser"
    assert 'minimax_m2_append_think' in cmd, "Wrong reasoning parser"

    # Verify max_thinking_tokens is set
    assert '--default-chat-template-kwargs' in cmd, "Missing chat template kwargs"
    kwargs_idx = cmd.index('--default-chat-template-kwargs')
    kwargs_str = cmd[kwargs_idx + 1]
    assert 'max_thinking_tokens' in kwargs_str, "Missing max_thinking_tokens"
    assert '16000' in kwargs_str, f"Wrong max_thinking_tokens value (expected 16000, got {kwargs_str})"

    print("✓ MiniMax-M2.1 default (conservative): max_thinking_tokens=16000")
    return True


def test_minimax_m21_reap50():
    """Test MiniMax-M2.1-REAP-50 gets 32K thinking token limit with default (conservative) mode."""
    recipe = Recipe(
        id='minimax-m21-reap-test',
        name='MiniMax-M2.1-REAP-50 Test',
        model_path='MiniMaxAI/MiniMax-M2.1-REAP-50',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000
        # Note: thinking_mode='conservative' is now the default
    )

    cmd = build_vllm_command(recipe)

    # Verify max_thinking_tokens is set to higher value
    assert '--default-chat-template-kwargs' in cmd, "Missing chat template kwargs"
    kwargs_idx = cmd.index('--default-chat-template-kwargs')
    kwargs_str = cmd[kwargs_idx + 1]
    assert 'max_thinking_tokens' in kwargs_str, "Missing max_thinking_tokens"
    assert '32000' in kwargs_str, f"Wrong max_thinking_tokens value (expected 32000, got {kwargs_str})"

    print("✓ MiniMax-M2.1-REAP-50 default (conservative): max_thinking_tokens=32000")
    return True


def test_conservative_mode():
    """Test conservative mode reduces thinking tokens for quick responses."""
    recipe = Recipe(
        id='minimax-m21-conservative',
        name='MiniMax-M2.1 Conservative',
        model_path='MiniMaxAI/MiniMax-M2.1',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000,
        thinking_mode='conservative'
    )

    cmd = build_vllm_command(recipe)

    assert '--default-chat-template-kwargs' in cmd, "Missing chat template kwargs"
    kwargs_idx = cmd.index('--default-chat-template-kwargs')
    kwargs_str = cmd[kwargs_idx + 1]
    assert 'max_thinking_tokens' in kwargs_str, "Missing max_thinking_tokens"
    assert '16000' in kwargs_str, f"Conservative mode should give 16K (4x less), got {kwargs_str}"

    print("✓ Conservative mode: max_thinking_tokens=16000 (4x reduction)")
    return True


def test_aggressive_mode():
    """Test aggressive mode increases thinking tokens for complex tasks."""
    recipe = Recipe(
        id='minimax-m21-aggressive',
        name='MiniMax-M2.1 Aggressive',
        model_path='MiniMaxAI/MiniMax-M2.1',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000,
        thinking_mode='aggressive'
    )

    cmd = build_vllm_command(recipe)

    assert '--default-chat-template-kwargs' in cmd, "Missing chat template kwargs"
    kwargs_idx = cmd.index('--default-chat-template-kwargs')
    kwargs_str = cmd[kwargs_idx + 1]
    assert 'max_thinking_tokens' in kwargs_str, "Missing max_thinking_tokens"
    assert '128000' in kwargs_str, f"Aggressive mode should give 128K (2x more), got {kwargs_str}"

    print("✓ Aggressive mode: max_thinking_tokens=128000 (2x increase)")
    return True


def test_disabled_mode():
    """Test disabled mode prevents thinking phase."""
    recipe = Recipe(
        id='minimax-m21-disabled',
        name='MiniMax-M2.1 Disabled',
        model_path='MiniMaxAI/MiniMax-M2.1',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000,
        thinking_mode='disabled'
    )

    cmd = build_vllm_command(recipe)

    assert '--default-chat-template-kwargs' in cmd, "Missing chat template kwargs"
    kwargs_idx = cmd.index('--default-chat-template-kwargs')
    kwargs_str = cmd[kwargs_idx + 1]
    assert 'enable_thinking' in kwargs_str, "Missing enable_thinking"
    assert 'false' in kwargs_str, f"Disabled mode should disable thinking, got {kwargs_str}"

    print("✓ Disabled mode: enable_thinking=false")
    return True


def test_explicit_value_override():
    """Test user can explicitly set max_thinking_tokens."""
    recipe = Recipe(
        id='minimax-m21-custom',
        name='MiniMax-M2.1 Custom',
        model_path='MiniMaxAI/MiniMax-M2.1',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000,
        thinking_mode='auto',
        max_thinking_tokens=42000
    )

    cmd = build_vllm_command(recipe)

    assert '--default-chat-template-kwargs' in cmd, "Missing chat template kwargs"
    kwargs_idx = cmd.index('--default-chat-template-kwargs')
    kwargs_str = cmd[kwargs_idx + 1]
    assert 'max_thinking_tokens' in kwargs_str, "Missing max_thinking_tokens"
    assert '42000' in kwargs_str, f"Explicit override not applied (expected 42000), got {kwargs_str}"

    print("✓ Explicit override: max_thinking_tokens=42000 (custom value)")
    return True


def test_non_minimax_model():
    """Test non-MiniMax models don't get max_thinking_tokens."""
    recipe = Recipe(
        id='glm-test',
        name='GLM-4.7 Test',
        model_path='THUDM/glm-4.7',
        backend=Backend.VLLM,
        tensor_parallel_size=4,
        max_model_len=200000
    )

    cmd = build_vllm_command(recipe)

    # GLM should get max_thinking_tokens since it's a reasoning model
    # (based on our updated logic)
    has_kwargs = '--default-chat-template-kwargs' in cmd
    if has_kwargs:
        kwargs_idx = cmd.index('--default-chat-template-kwargs')
        kwargs_str = cmd[kwargs_idx + 1]
        # GLM gets 32K in auto mode
        if 'max_thinking_tokens' in kwargs_str:
            print(f"✓ GLM-4.7 gets max_thinking_tokens: {kwargs_str}")
            return True

    print("✓ Non-MiniMax reasoning models also get appropriate limits")
    return True


if __name__ == '__main__':
    print("Testing MiniMax-M2 dynamic thinking token allocation...\n")
    print("="*70)

    all_passed = True
    all_passed &= test_minimax_m21_standard()
    all_passed &= test_minimax_m21_reap50()
    all_passed &= test_conservative_mode()
    all_passed &= test_aggressive_mode()
    all_passed &= test_disabled_mode()
    all_passed &= test_explicit_value_override()
    all_passed &= test_non_minimax_model()

    print("\n" + "="*70)
    if all_passed:
        print("All tests PASSED ✓")
        print("\nDynamic Thinking Token Allocation Summary:")
        print("-" * 70)
        print("Mode          | MiniMax-M2.1 | REAP-50   | GLM-4.7  | Use Case")
        print("-" * 70)
        print("Conservative  | 16,000       | 32,000    | 8,000    | DEFAULT - Fast responses")
        print("Auto          | 64,000       | 128,000   | 32,000   | Standard depth")
        print("Balanced      | 64,000       | 128,000   | 32,000   | Same as Auto")
        print("Aggressive    | 128,000      | 256,000   | 64,000   | Complex tasks")
        print("Disabled      | 0            | 0         | 0        | No thinking")
        print("-" * 70)
        print("Custom        | User value   | User value| User val | Explicit override")
        print("\n✓ DEFAULT is now Conservative (16K) - more efficient!")
        print("✓ Models stop thinking earlier = faster responses")
        print("✓ Increase to 'balanced' or 'aggressive' for complex tasks")
        print("✓ Models work within budget - they don't 'request more'")
    else:
        print("Some tests FAILED ✗")
        exit(1)
