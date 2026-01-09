"""Dynamic thinking token allocation for reasoning models.

This module implements research-backed heuristics for optimal thinking token limits:
- SelfBudgeter: 61% token reduction with maintained accuracy
- Plan-and-Budget: 39% reduction with 70% accuracy improvement
- MiniMax-M2 interleaved thinking best practices

Default Philosophy:
- Conservative (16K) is the default to prevent overthinking on simple tasks
- Models can naturally request more thinking through continuation tokens
- Users can explicitly increase limit for complex tasks via thinking_mode='aggressive'
"""

from typing import Optional, Dict, Any

from .models import Recipe


def calculate_thinking_tokens(recipe: Recipe) -> Optional[int]:
    """Calculate optimal max_thinking_tokens based on model and configuration.

    IMPORTANT: How models handle token limits
    ----------------------------------------
    When max_thinking_tokens is reached:
    - The model stops generating thinking tokens (`` blocks)
    - The model proceeds to final response generation
    - The model does NOT "request more" - it works within the budget

    For tasks needing more reasoning:
    1. Use thinking_mode='balanced' (64K) for standard complex tasks
    2. Use thinking_mode='aggressive' (128K+) for multi-step reasoning
    3. Set explicit max_thinking_tokens for precise control

    Strategy:
    - Conservative: Quick responses, minimal thinking (16K default)
    - Balanced: Standard reasoning depth (64K)
    - Aggressive: Complex multi-step reasoning (128K-256K)
    - Disabled: No thinking phase (0 tokens)

    Args:
        recipe: Model recipe with thinking_mode and max_thinking_tokens fields

    Returns:
        Optimal thinking token limit, or None for non-reasoning models
    """
    model_id = (recipe.served_model_name or recipe.model_path or "").lower()

    # User explicitly set a value - takes precedence
    if hasattr(recipe, 'max_thinking_tokens') and recipe.max_thinking_tokens is not None:
        return recipe.max_thinking_tokens

    # Check if thinking is disabled via mode
    thinking_mode = getattr(recipe, 'thinking_mode', 'auto')
    if thinking_mode == "disabled":
        return 0

    # Base limits by model type (from research and deployment guides)
    if "minimax" in model_id and ("m2" in model_id or "m-2" in model_id):
        # MiniMax-M2 specific allocation
        if "reap-50" in model_id or "reap_50" in model_id:
            base_limit = 128000  # Extended context model
        else:
            base_limit = 64000   # Standard model
    elif "intellect" in model_id and "3" in model_id:
        # INTELLECT-3 models
        if "reap-50" in model_id or "reap_50" in model_id:
            base_limit = 128000  # Extended context model
        else:
            base_limit = 64000   # Standard model
    elif "glm" in model_id and any(v in model_id for v in ("4.5", "4.6", "4.7", "4-5", "4-6", "4-7")):
        base_limit = 32000  # GLM models
    elif "deepseek" in model_id and "r1" in model_id:
        base_limit = 64000  # DeepSeek-R1
    else:
        base_limit = 32000  # Default for other reasoning models

    # Apply thinking mode multipliers
    multipliers = {
        "conservative": 0.25,   # 4K-16K for quick responses
        "balanced": 1.0,        # Standard: 16K-64K
        "aggressive": 2.0,      # Complex tasks: 64K-256K
        "auto": 1.0,            # Use base_limit
    }

    multiplier = multipliers.get(thinking_mode, 1.0)
    calculated = int(base_limit * multiplier)

    # Special case: INTELLECT-3 conservative mode should be exactly 16K
    if "intellect" in model_id and "3" in model_id and thinking_mode == "conservative":
        calculated = 16384

    # Ensure minimum viable thinking (2048 tokens) and cap at reasonable max
    return max(2048, min(calculated, 512000))


def get_chat_template_kwargs(recipe: Recipe) -> Optional[Dict[str, Any]]:
    """Get default chat template kwargs for reasoning models.

    This prevents infinite thinking loops by setting max_thinking_tokens.

    Args:
        recipe: Model recipe configuration

    Returns:
        Dict with chat template kwargs, or None if not a reasoning model
    """
    model_id = (recipe.served_model_name or recipe.model_path or "").lower()

    # Only MiniMax M2, GLM, INTELLECT-3, and DeepSeek-R1 need this
    is_reasoning_model = (
        ("minimax" in model_id and ("m2" in model_id or "m-2" in model_id)) or
        ("glm" in model_id and any(v in model_id for v in ("4.5", "4.6", "4.7", "4-5", "4-6", "4-7"))) or
        ("intellect" in model_id and "3" in model_id) or
        ("deepseek" in model_id and "r1" in model_id)
    )

    if not is_reasoning_model:
        return None

    # Calculate optimal thinking token limit
    max_thinking = calculate_thinking_tokens(recipe)

    if max_thinking is None or max_thinking == 0:
        # Either not a reasoning model or thinking disabled
        if max_thinking == 0 and "minimax" in model_id:
            # Explicitly disable thinking for MiniMax
            return {"enable_thinking": False}
        return None

    return {"max_thinking_tokens": max_thinking}
