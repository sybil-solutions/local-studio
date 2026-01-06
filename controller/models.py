"""Pydantic models for vLLM Studio."""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class Backend(str, Enum):
    """Supported inference backends."""

    VLLM = "vllm"
    SGLANG = "sglang"
    TRANSFORMERS = "transformers"


class Recipe(BaseModel):
    """Model launch configuration."""

    id: str = Field(..., description="Unique identifier")
    name: str = Field(..., description="Display name")
    model_path: str = Field(..., description="Path to model")
    backend: Backend = Field(default=Backend.VLLM)

    # Environment variables to set for the backend process
    env_vars: Optional[Dict[str, str]] = Field(default=None)

    # Parallelism
    tensor_parallel_size: int = Field(default=1, alias="tp")
    pipeline_parallel_size: int = Field(default=1, alias="pp")

    # Memory
    max_model_len: int = Field(default=32768)
    gpu_memory_utilization: float = Field(default=0.9)
    kv_cache_dtype: str = Field(default="auto")

    # Batching
    max_num_seqs: int = Field(default=256)

    # Features
    trust_remote_code: bool = Field(default=True)
    tool_call_parser: Optional[str] = Field(default=None)
    reasoning_parser: Optional[str] = Field(default=None)
    enable_auto_tool_choice: bool = Field(default=False)

    # Quantization
    quantization: Optional[str] = Field(default=None)
    dtype: Optional[str] = Field(default=None)

    # Networking
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    served_model_name: Optional[str] = Field(default=None)

    # Custom Python
    python_path: Optional[str] = Field(default=None)

    # Extra CLI args
    extra_args: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        # Legacy: engine -> backend
        if "backend" not in d and "engine" in d:
            d["backend"] = d.pop("engine")

        # Normalize env_vars: allow legacy env-vars/envVars keys and legacy storage in extra_args.
        extra = dict(d.get("extra_args") or {})
        if d.get("env_vars") in (None, {}, ""):
            env_candidate = None
            for key in ("env_vars", "env-vars", "envVars"):
                if key in d and d.get(key) not in (None, "", {}):
                    env_candidate = d.pop(key)
                    break
            if env_candidate is None:
                for key in ("env_vars", "env-vars", "envVars"):
                    if key in extra and extra.get(key) not in (None, "", {}):
                        env_candidate = extra.pop(key)
                        break
            if env_candidate is not None:
                d["env_vars"] = env_candidate

        # Fold unknown keys into extra_args
        known = set(cls.model_fields.keys()) | {"tp", "pp", "engine", "extra_args"}
        for k in list(d.keys()):
            if k not in known:
                extra[k] = d.pop(k)
        d["extra_args"] = extra
        return d

    model_config = {"populate_by_name": True}

    @field_validator("env_vars", mode="before")
    @classmethod
    def normalize_env_vars(cls, value: Any) -> Any:
        """Coerce env var values to strings for process environments."""
        if value is None:
            return None
        if isinstance(value, dict):
            normalized: Dict[str, str] = {}
            for k, v in value.items():
                if v is None:
                    continue
                normalized[str(k)] = str(v)
            return normalized
        return value


class ProcessInfo(BaseModel):
    """Running inference process."""

    pid: int
    backend: str
    model_path: Optional[str] = None
    port: int
    served_model_name: Optional[str] = None


class LaunchResult(BaseModel):
    """Result of launching a model."""

    success: bool
    pid: Optional[int] = None
    message: str
    log_file: Optional[str] = None


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    inference_ready: bool = False
    # Frontend compatibility: UI expects `backend_reachable`.
    backend_reachable: bool = False
    running_model: Optional[str] = None


class OpenAIModelInfo(BaseModel):
    """OpenAI-compatible model info."""

    id: str
    object: str = "model"
    created: int
    owned_by: str = "vllm-studio"
    active: bool = False
    max_model_len: Optional[int] = None


class OpenAIModelList(BaseModel):
    """OpenAI-compatible model list response."""

    object: str = "list"
    data: List[OpenAIModelInfo]
