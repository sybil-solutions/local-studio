"""System endpoints: health, status, config, gpus."""

from __future__ import annotations

import asyncio

import httpx
from fastapi import APIRouter

from .. import __version__
from ..config import settings
from ..gpu import get_gpu_info
from ..models import (
    HealthResponse, SystemConfigResponse, ServiceInfo, SystemConfig, EnvironmentInfo
)
from ..process import find_inference_process

router = APIRouter(tags=["System"])


@router.get("/health", response_model=HealthResponse)
async def health():
    """Health check."""
    current = find_inference_process(settings.inference_port)
    inference_ready = False

    if current:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                inference_ready = r.status_code == 200
        except Exception:
            pass

    return HealthResponse(
        status="ok",
        version=__version__,
        inference_ready=inference_ready,
        backend_reachable=inference_ready,
        running_model=current.served_model_name or current.model_path if current else None,
    )


# Global launching state (shared with lifecycle routes)
_launching_recipe_id: str | None = None


def get_launching_recipe_id() -> str | None:
    """Get the currently launching recipe ID."""
    return _launching_recipe_id


def set_launching_recipe_id(recipe_id: str | None) -> None:
    """Set the currently launching recipe ID."""
    global _launching_recipe_id
    _launching_recipe_id = recipe_id


@router.get("/status")
async def status():
    """Detailed status including launch-in-progress info."""
    current = find_inference_process(settings.inference_port)
    return {
        "running": current is not None,
        "process": current.model_dump() if current else None,
        "inference_port": settings.inference_port,
        "launching": _launching_recipe_id,
    }


@router.get("/gpus")
async def gpus():
    """Get GPU information."""
    gpu_list = get_gpu_info()
    return {
        "count": len(gpu_list),
        "gpus": [gpu.model_dump() for gpu in gpu_list],
    }


@router.get("/config", response_model=SystemConfigResponse)
async def get_config():
    """Get system configuration and service topology."""
    import os
    import socket

    async def check_service(host: str, port: int, timeout: float = 1.0) -> bool:
        try:
            _, _, _ = await asyncio.get_event_loop().getaddrinfo(host, port)
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=timeout
            )
            writer.close()
            await writer.wait_closed()
            return True
        except Exception:
            return False

    hostname = socket.gethostname()
    services = []

    # Controller service
    services.append(ServiceInfo(
        name="Controller",
        port=settings.port,
        internal_port=settings.port,
        protocol="http",
        status="running",
        description="FastAPI model lifecycle manager"
    ))

    # Inference backend (vLLM/SGLang)
    inference_status = "unknown"
    try:
        current = find_inference_process(settings.inference_port)
        if current:
            async with httpx.AsyncClient(timeout=2) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                inference_status = "running" if r.status_code == 200 else "error"
        else:
            inference_status = "stopped"
    except Exception:
        inference_status = "stopped"

    services.append(ServiceInfo(
        name="vLLM/SGLang",
        port=settings.inference_port,
        internal_port=settings.inference_port,
        protocol="http",
        status=inference_status,
        description="Inference backend (vLLM or SGLang)"
    ))

    # LiteLLM
    litellm_status = "unknown"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            master_key = os.environ.get("LITELLM_MASTER_KEY", "sk-master")
            headers = {"Authorization": f"Bearer {master_key}"}
            r = await client.get("http://localhost:4100/health", headers=headers)
            if r.status_code == 200:
                data = r.json()
                healthy_count = data.get("healthy_count", 0)
                litellm_status = "running" if healthy_count > 0 else "degraded"
            else:
                litellm_status = "error"
    except Exception:
        litellm_status = "stopped"

    services.append(ServiceInfo(
        name="LiteLLM",
        port=4100,
        internal_port=4000,
        protocol="http",
        status=litellm_status,
        description="API gateway and load balancer"
    ))

    # PostgreSQL
    is_postgres_reachable = await check_service("localhost", 5432)
    services.append(ServiceInfo(
        name="PostgreSQL",
        port=5432,
        internal_port=5432,
        protocol="tcp",
        status="running" if is_postgres_reachable else "stopped",
        description="Database for LiteLLM"
    ))

    # Redis
    is_redis_reachable = await check_service("localhost", 6379)
    services.append(ServiceInfo(
        name="Redis",
        port=6379,
        internal_port=6379,
        protocol="tcp",
        status="running" if is_redis_reachable else "stopped",
        description="Cache and rate limiting"
    ))

    # Prometheus
    prometheus_status = "unknown"
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            r = await client.get("http://localhost:9090/-/healthy")
            prometheus_status = "running" if r.status_code == 200 else "error"
    except Exception:
        prometheus_status = "stopped"
    services.append(ServiceInfo(
        name="Prometheus",
        port=9090,
        internal_port=9090,
        protocol="http",
        status=prometheus_status,
        description="Metrics collection"
    ))

    # Grafana
    grafana_status = "unknown"
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            r = await client.get("http://localhost:3001/api/health")
            grafana_status = "running" if r.status_code == 200 else "error"
    except Exception:
        grafana_status = "stopped"
    services.append(ServiceInfo(
        name="Grafana",
        port=3001,
        internal_port=3000,
        protocol="http",
        status=grafana_status,
        description="Metrics dashboards"
    ))

    # Frontend
    is_frontend_reachable = await check_service("localhost", 3000)
    services.append(ServiceInfo(
        name="Frontend",
        port=3000,
        internal_port=3000,
        protocol="http",
        status="running" if is_frontend_reachable else "stopped",
        description="Next.js web UI"
    ))

    config = SystemConfig(
        host=settings.host,
        port=settings.port,
        inference_port=settings.inference_port,
        api_key_configured=settings.api_key is not None,
        models_dir=str(settings.models_dir),
        data_dir=str(settings.data_dir),
        db_path=str(settings.db_path),
        sglang_python=settings.sglang_python,
        tabby_api_dir=settings.tabby_api_dir,
    )

    environment = EnvironmentInfo(
        controller_url=f"http://{hostname}:{settings.port}",
        inference_url=f"http://{hostname}:{settings.inference_port}",
        litellm_url=f"http://{hostname}:4100",
        frontend_url=f"http://{hostname}:3000",
    )

    return SystemConfigResponse(
        config=config,
        services=services,
        environment=environment
    )
