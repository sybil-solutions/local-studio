from __future__ import annotations

import asyncio
import os
import threading
import time
import uuid
from typing import Any, Literal

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_PATH = os.environ.get(
    "DEEPSEEK_MODEL_PATH", "/home/ser/models/DeepSeek-V3.2-REAP-345B-W3A16"
)
SERVED_MODEL_NAME = os.environ.get("DEEPSEEK_SERVED_MODEL_NAME", "deepseek-v3.2-reap-w3a16")
PORT = int(os.environ.get("DEEPSEEK_PORT", "8000"))
OFFLOAD_DIR = os.environ.get("DEEPSEEK_OFFLOAD_DIR", "/tmp/deepseek_w3a16_offload")
MAX_MEMORY_GIB = int(os.environ.get("DEEPSEEK_MAX_MEMORY_GIB", "18"))
MAX_CONTEXT_TOKENS = int(os.environ.get("DEEPSEEK_MAX_CONTEXT_TOKENS", "65536"))

app = FastAPI(title="DeepSeek W3A16 (Transformers)", version="0.1.0")


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"] = "user"
    content: str = ""


class ChatCompletionsRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)
    max_tokens: int | None = None
    temperature: float | None = 0.0
    top_p: float | None = 1.0
    stop: str | list[str] | None = None


_tok = None
_model = None
_load_lock = threading.Lock()
_load_event = threading.Event()
_load_started = False
_load_error: str | None = None


def _load_worker() -> None:
    global _load_error
    try:
        _load()
    except Exception as e:
        _load_error = repr(e)
    finally:
        _load_event.set()


def _load() -> tuple[Any, Any]:
    global _tok, _model
    with _load_lock:
        if _tok is not None and _model is not None:
            return _tok, _model

    os.makedirs(OFFLOAD_DIR, exist_ok=True)

    # Use all available GPU memory - no CPU offloading
    # 130GB model weights should fit in 192GB VRAM (8x24GB)
    max_memory: dict[Any, str] = {i: f"{MAX_MEMORY_GIB}GiB" for i in range(torch.cuda.device_count())}
    # Don't allocate CPU memory for offloading
    # max_memory["cpu"] = "0GiB"  # Commenting out to prevent any CPU offload

    start = time.time()
    tok = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        trust_remote_code=True,
        torch_dtype=torch.float16,
        device_map="balanced",  # Use balanced instead of auto for better distribution
        max_memory=max_memory,
        low_cpu_mem_usage=True,
        # REMOVED: offload settings that cause slow CPU<->GPU shuffling
        # offload_folder=OFFLOAD_DIR,
        # offload_state_dict=True,
        # offload_buffers=True,
    )

    # Some checkpoints omit g_idx tensors; ensure any present buffers are deterministic.
    fixed = 0
    for module in model.modules():
        if hasattr(module, "g_idx"):
            gi = getattr(module, "g_idx")
            if isinstance(gi, torch.Tensor) and gi.device.type != "meta":
                gi.zero_()
                fixed += 1
            elif isinstance(gi, torch.nn.Parameter) and gi.data.device.type != "meta":
                gi.data.zero_()
                fixed += 1

    load_s = round(time.time() - start, 1)
    print(
        f"[deepseek] loaded model in {load_s}s; zeroed g_idx tensors: {fixed}; serving as {SERVED_MODEL_NAME}",
        flush=True,
    )

    _tok, _model = tok, model
    return tok, model


def _ensure_loaded() -> tuple[Any, Any]:
    global _load_started
    if _tok is not None and _model is not None:
        return _tok, _model
    with _load_lock:
        if _tok is not None and _model is not None:
            return _tok, _model
        if not _load_started:
            _load_started = True
            threading.Thread(target=_load_worker, daemon=True).start()
    _load_event.wait()
    if _load_error is not None:
        raise RuntimeError(_load_error)
    assert _tok is not None and _model is not None
    return _tok, _model


def _render_prompt(tok: Any, messages: list[ChatMessage]) -> str:
    raw = [m.model_dump() for m in messages]
    if hasattr(tok, "apply_chat_template"):
        try:
            return tok.apply_chat_template(raw, tokenize=False, add_generation_prompt=True)
        except Exception:
            pass
    # Fallback: simple role/content concatenation.
    return "\n".join(f"{m.role}: {m.content}" for m in messages) + "\nassistant:"


DEFAULT_STOP_SEQS = (
    "\nuser:",
    "\nUser:",
    "\nuser",
    "\nUser",
    "\nassistant:",
    "\nAssistant:",
    "\nassistant",
    "\nAssistant",
    "<|user|>",
    "<|assistant|>",
    "\n### Human:",
    "\nHuman:",
)


def _apply_stop_seqs(text: str, stop: str | list[str] | None) -> str:
    stop_seqs: list[str] = list(DEFAULT_STOP_SEQS)
    if isinstance(stop, str) and stop:
        stop_seqs.insert(0, stop)
    elif isinstance(stop, list):
        stop_seqs = [s for s in stop if isinstance(s, str) and s] + stop_seqs

    earliest: int | None = None
    for s in stop_seqs:
        idx = text.find(s)
        if idx != -1 and (earliest is None or idx < earliest):
            earliest = idx
    if earliest is not None:
        return text[:earliest].rstrip()
    return text


@app.on_event("startup")
async def _startup() -> None:
    # Kick off model load in the background so /health can reflect real readiness.
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _ensure_loaded)


@app.get("/health")
def health() -> dict[str, Any]:
    if _load_error is not None:
        raise HTTPException(status_code=500, detail=_load_error)
    if _tok is None or _model is None:
        # Keep this fast; controller will poll until it's ready.
        return JSONResponse(
            {"status": "loading", "model": SERVED_MODEL_NAME},
            status_code=503,
        )
    return {"status": "ok", "model": SERVED_MODEL_NAME}


@app.get("/v1/models")
def v1_models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {
                "id": SERVED_MODEL_NAME,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "local",
            }
        ],
    }


@app.post("/v1/chat/completions")
def v1_chat_completions(req: ChatCompletionsRequest) -> dict[str, Any]:
    tok, model = _ensure_loaded()

    prompt = _render_prompt(tok, req.messages)
    inputs = tok(prompt, return_tensors="pt", truncation=False)
    prompt_len = int(inputs["input_ids"].shape[-1])
    if prompt_len > MAX_CONTEXT_TOKENS:
        input_ids = inputs["input_ids"][:, -MAX_CONTEXT_TOKENS:]
        attention_mask = inputs.get("attention_mask")
        if attention_mask is not None:
            attention_mask = attention_mask[:, -MAX_CONTEXT_TOKENS:]
        inputs = {"input_ids": input_ids, "attention_mask": attention_mask}
    inputs = {k: v.to("cuda:0") for k, v in inputs.items() if v is not None}
    input_len = int(inputs["input_ids"].shape[-1])

    max_new = req.max_tokens or 256
    temperature = float(req.temperature or 0.0)
    top_p = float(req.top_p or 1.0)
    do_sample = temperature > 0.0

    with torch.inference_mode():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new,
            do_sample=do_sample,
            temperature=temperature if do_sample else None,
            top_p=top_p if do_sample else None,
            pad_token_id=getattr(tok, "eos_token_id", None),
        )

    gen_ids = out[0][input_len:]
    text = tok.decode(gen_ids, skip_special_tokens=True).lstrip()
    text = _apply_stop_seqs(text, req.stop)

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": SERVED_MODEL_NAME,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
    }
