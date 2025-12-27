"""GPU monitoring and model memory estimation."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class GPUInfo(BaseModel):
    """Information about a single GPU."""

    index: int
    name: str
    memory_total: int  # bytes
    memory_used: int  # bytes
    memory_free: int  # bytes
    utilization: float  # 0-100
    temperature: int = 0  # Celsius


# Try to import pynvml, fallback to None if not available
try:
    import pynvml

    PYNVML_AVAILABLE = True
except ImportError:
    PYNVML_AVAILABLE = False
    pynvml = None


def get_gpu_info() -> List[GPUInfo]:
    """
    Get information about all available GPUs.

    Returns:
        List of GPUInfo objects, or empty list if pynvml is not available
        or no GPUs are detected.
    """
    if not PYNVML_AVAILABLE:
        return []

    try:
        pynvml.nvmlInit()
        device_count = pynvml.nvmlDeviceGetCount()

        gpus = []
        for i in range(device_count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)

            # Get GPU name
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8")

            # Get memory info
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)

            # Get utilization
            try:
                util_rates = pynvml.nvmlDeviceGetUtilizationRates(handle)
                utilization = float(util_rates.gpu)
            except Exception:
                # Some GPUs don't support utilization query
                utilization = 0.0

            # Get temperature
            try:
                temperature = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            except Exception:
                temperature = 0

            gpus.append(
                GPUInfo(
                    index=i,
                    name=name,
                    memory_total=mem_info.total,
                    memory_used=mem_info.used,
                    memory_free=mem_info.free,
                    utilization=utilization,
                    temperature=temperature,
                )
            )

        pynvml.nvmlShutdown()
        return gpus

    except Exception:
        # If anything goes wrong, return empty list
        return []


def estimate_model_memory(
    model_size_gb: float,
    quantization: Optional[str] = None,
    dtype: Optional[str] = None,
    tensor_parallel: int = 1,
) -> float:
    """
    Estimate VRAM needed for a model in GB.

    Args:
        model_size_gb: Base model size in GB (e.g., 7 for a 7B parameter model)
        quantization: Quantization method (e.g., "awq", "gptq", "fp8")
        dtype: Data type (e.g., "float16", "bfloat16", "float32")
        tensor_parallel: Number of GPUs for tensor parallelism

    Returns:
        Estimated VRAM needed in GB per GPU
    """
    # Start with base model size
    memory_gb = model_size_gb

    # Apply quantization reduction
    if quantization:
        quant_lower = quantization.lower()
        if "int4" in quant_lower or "4bit" in quant_lower:
            memory_gb *= 0.25
        elif "int8" in quant_lower or "8bit" in quant_lower or quant_lower in ["awq", "gptq"]:
            memory_gb *= 0.5
        elif "fp8" in quant_lower:
            memory_gb *= 0.5

    # Apply dtype adjustment
    if dtype:
        dtype_lower = dtype.lower()
        if "float32" in dtype_lower or "fp32" in dtype_lower:
            memory_gb *= 2.0  # double from fp16 baseline
        elif "float16" in dtype_lower or "fp16" in dtype_lower or "bfloat16" in dtype_lower:
            pass  # baseline
        elif "int8" in dtype_lower:
            memory_gb *= 0.5

    # Divide by tensor parallel size
    if tensor_parallel > 1:
        memory_gb /= tensor_parallel

    # Add overhead for KV cache and activations (approximately 30%)
    memory_gb *= 1.3

    return memory_gb


def can_fit_model(
    model_size_gb: float,
    quantization: Optional[str] = None,
    dtype: Optional[str] = None,
    tensor_parallel: int = 1,
) -> bool:
    """
    Check if a model can fit on available GPUs.

    Args:
        model_size_gb: Base model size in GB
        quantization: Quantization method
        dtype: Data type
        tensor_parallel: Number of GPUs for tensor parallelism

    Returns:
        True if the model can fit, False otherwise.
        Returns True if pynvml is not available (optimistic fallback).
    """
    if not PYNVML_AVAILABLE:
        # Optimistic fallback: assume it fits
        return True

    gpus = get_gpu_info()
    if not gpus:
        # No GPUs detected, optimistic fallback
        return True

    # Calculate required memory per GPU
    required_memory_gb = estimate_model_memory(
        model_size_gb, quantization, dtype, tensor_parallel
    )
    required_memory_bytes = required_memory_gb * 1024**3

    # Need at least tensor_parallel GPUs
    if len(gpus) < tensor_parallel:
        return False

    # Check if each of the first tensor_parallel GPUs has enough free memory
    for i in range(tensor_parallel):
        if i >= len(gpus):
            return False
        if gpus[i].memory_free < required_memory_bytes:
            return False

    return True
