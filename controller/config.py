"""Configuration settings."""

from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Controller settings."""

    # API
    host: str = "0.0.0.0"
    port: int = 8080

    # Authentication
    api_key: Optional[str] = Field(default=None, description="Bearer token for API access")

    # Inference backend
    inference_port: int = Field(default=8000, description="Port where vLLM/SGLang runs")

    # Storage
    data_dir: Path = Field(default=Path("./data"))
    db_path: Path = Field(default=Path("./data/controller.db"))

    # Models
    models_dir: Path = Field(default=Path("/models"), description="Directory containing model weights")

    # SGLang (optional - only needed if using SGLang backend)
    sglang_python: Optional[str] = Field(
        default=None,
        description="Python path for SGLang (e.g., /path/to/sglang/venv/bin/python)",
    )

    # TabbyAPI (optional - only needed if using TabbyAPI/ExLlamaV3 backend)
    tabby_api_dir: Optional[str] = Field(
        default=None,
        description="TabbyAPI installation directory",
    )

    model_config = {
        "env_prefix": "VLLM_STUDIO_",
        "env_file": ".env",
        "extra": "ignore",
    }


settings = Settings()
