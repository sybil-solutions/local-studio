"""FastAPI route modules for vLLM Studio controller."""

from .system import router as system_router
from .models import router as models_router
from .lifecycle import router as lifecycle_router
from .chats import router as chats_router
from .logs import router as logs_router
from .monitoring import router as monitoring_router
from .mcp import router as mcp_router
from .proxy import router as proxy_router
from .usage import router as usage_router

__all__ = [
    "system_router",
    "models_router",
    "lifecycle_router",
    "chats_router",
    "logs_router",
    "monitoring_router",
    "mcp_router",
    "proxy_router",
    "usage_router",
]
