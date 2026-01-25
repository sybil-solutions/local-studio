# CRITICAL
from __future__ import annotations

import os

from controller.backends import build_vllm_command
from controller.models import Recipe
from controller.process import _build_env


def test_vllm_uses_venv_path_and_does_not_pass_venv_flag(tmp_path):
    venv_dir = tmp_path / "venv"
    python_bin = venv_dir / "bin" / "python"
    vllm_bin = venv_dir / "bin" / "vllm"
    python_bin.parent.mkdir(parents=True)
    python_bin.write_text("#!/usr/bin/env python\n")
    python_bin.chmod(0o755)
    vllm_bin.write_text("#!/usr/bin/env python\n")
    vllm_bin.chmod(0o755)

    recipe = Recipe(
        id="r1",
        name="Recipe 1",
        model_path="/models/foo",
        tool_call_parser="mistral",
        extra_args={
            "venv-path": str(venv_dir),
            "cuda_visible_devices": "0",
            "enable_auto_tool_choice": True,
        },
    )

    cmd = build_vllm_command(recipe)

    assert cmd[0] == str(vllm_bin)
    assert cmd[1:3] == ["serve", "/models/foo"]
    assert "--venv-path" not in cmd
    assert "--cuda-visible-devices" not in cmd

    # tool_call_parser implies --enable-auto-tool-choice; extra_args should not duplicate it.
    assert cmd.count("--enable-auto-tool-choice") == 1


def test_build_env_applies_env_vars_and_cuda_visible_devices(monkeypatch):
    monkeypatch.setenv("EXISTING", "1")
    monkeypatch.delenv("FOO", raising=False)

    recipe = Recipe(
        id="r1",
        name="Recipe 1",
        model_path="/models/foo",
        extra_args={
            "env-vars": {"FOO": "bar", "NUM": 123},
            "cuda_visible_devices": "0,1",
        },
    )

    env = _build_env(recipe)

    assert env["EXISTING"] == os.environ["EXISTING"]
    assert env["FOO"] == "bar"
    assert env["NUM"] == "123"
    assert env["CUDA_VISIBLE_DEVICES"] == "0,1"
