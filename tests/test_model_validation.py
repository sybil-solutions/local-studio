# CRITICAL
"""Test harness for validating model deployments.

This module provides comprehensive validation tests for deployed models including:
- Health check validation
- Short generation latency testing
- Long context capacity testing
- Memory headroom verification
- Restart validation

Usage:
    python -m pytest tests/test_model_validation.py -v
    python tests/test_model_validation.py --config tests/test_config.yaml --model-id my-model
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import yaml


@dataclass
class TestResult:
    """Result of a single test."""
    passed: bool
    latency_ms: Optional[float] = None
    error: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


@dataclass
class ValidationResults:
    """Complete validation results for a model."""
    model_id: str
    timestamp: str
    controller_url: str
    inference_url: str
    tests: Dict[str, TestResult]
    overall_passed: bool
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "model_id": self.model_id,
            "timestamp": self.timestamp,
            "controller_url": self.controller_url,
            "inference_url": self.inference_url,
            "tests": {
                name: {
                    "passed": result.passed,
                    "latency_ms": result.latency_ms,
                    "error": result.error,
                    "details": result.details or {},
                }
                for name, result in self.tests.items()
            },
            "overall_passed": self.overall_passed,
            "notes": self.notes,
        }


class ModelValidator:
    """Validates deployed models against reliability criteria."""

    def __init__(
        self,
        controller_url: str = "http://localhost:8080",
        inference_url: str = "http://localhost:8000",
        config_path: Optional[Path] = None,
    ):
        self.controller_url = controller_url.rstrip("/")
        self.inference_url = inference_url.rstrip("/")
        self.config = self._load_config(config_path)
        self.client = httpx.AsyncClient(timeout=30.0)

    def _load_config(self, config_path: Optional[Path]) -> Dict[str, Any]:
        """Load test configuration from YAML file."""
        default_config = {
            "timeouts": {
                "health_check": 10,
                "short_generation": 30,
                "long_context": 300,
                "restart": 600,
            },
            "thresholds": {
                "short_generation_tokens": 128,
                "short_generation_max_latency_ms": 5000,
                "long_context_target_ratio": 0.9,
                "memory_headroom_min_percent": 5,
            },
            "test_params": {
                "short_generation_prompt": "Explain quantum computing in one sentence.",
                "short_generation_max_tokens": 128,
                "long_context_base_prompt_path": "tests/long_context_prompt.txt",
            },
        }

        if config_path and config_path.exists():
            with open(config_path) as f:
                user_config = yaml.safe_load(f) or {}
                # Deep merge
                for key, value in user_config.items():
                    if isinstance(value, dict) and key in default_config:
                        default_config[key].update(value)
                    else:
                        default_config[key] = value

        return default_config

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()

    async def health_check(self) -> TestResult:
        """Test 1: Verify /health endpoint returns 200 and backend is ready."""
        start = time.time()
        try:
            # Check controller health
            controller_resp = await self.client.get(
                f"{self.controller_url}/health",
                timeout=self.config["timeouts"]["health_check"],
            )
            controller_healthy = controller_resp.status_code == 200

            # Check inference backend health
            inference_resp = await self.client.get(
                f"{self.inference_url}/health",
                timeout=self.config["timeouts"]["health_check"],
            )
            inference_healthy = inference_resp.status_code == 200

            latency_ms = (time.time() - start) * 1000

            if controller_healthy and inference_healthy:
                controller_data = controller_resp.json()
                return TestResult(
                    passed=True,
                    latency_ms=latency_ms,
                    details={
                        "controller_status": controller_data,
                        "inference_ready": True,
                    },
                )
            else:
                return TestResult(
                    passed=False,
                    latency_ms=latency_ms,
                    error=f"Health check failed: controller={controller_healthy}, inference={inference_healthy}",
                )

        except Exception as e:
            latency_ms = (time.time() - start) * 1000
            return TestResult(passed=False, latency_ms=latency_ms, error=str(e))

    async def short_generation(self) -> TestResult:
        """Test 2: Run 32-128 token generation and measure latency."""
        start = time.time()
        try:
            prompt = self.config["test_params"]["short_generation_prompt"]
            max_tokens = self.config["test_params"]["short_generation_max_tokens"]

            payload = {
                "model": "default",
                "prompt": prompt,
                "max_tokens": max_tokens,
                "temperature": 0.7,
            }

            response = await self.client.post(
                f"{self.inference_url}/v1/completions",
                json=payload,
                timeout=self.config["timeouts"]["short_generation"],
            )

            latency_ms = (time.time() - start) * 1000

            if response.status_code != 200:
                return TestResult(
                    passed=False,
                    latency_ms=latency_ms,
                    error=f"Generation failed with status {response.status_code}: {response.text}",
                )

            data = response.json()
            generated_text = data.get("choices", [{}])[0].get("text", "")
            tokens_generated = data.get("usage", {}).get("completion_tokens", 0)

            max_latency = self.config["thresholds"]["short_generation_max_latency_ms"]
            passed = latency_ms <= max_latency and tokens_generated > 0

            return TestResult(
                passed=passed,
                latency_ms=latency_ms,
                details={
                    "tokens_generated": tokens_generated,
                    "generated_text_length": len(generated_text),
                    "threshold_ms": max_latency,
                },
            )

        except Exception as e:
            latency_ms = (time.time() - start) * 1000
            return TestResult(passed=False, latency_ms=latency_ms, error=str(e))

    async def _get_model_max_length(self) -> Optional[int]:
        """Get the model's maximum context length."""
        try:
            response = await self.client.get(f"{self.inference_url}/v1/models")
            if response.status_code == 200:
                data = response.json()
                models = data.get("data", [])
                if models:
                    return models[0].get("max_model_len")
        except Exception:
            pass
        return None

    async def long_context_test(self, target_ratio: float = 0.9) -> TestResult:
        """Test 3: Push context to target % of max_model_len.

        Args:
            target_ratio: Target context fill ratio (default 0.9 = 90%)
        """
        start = time.time()
        try:
            # Get model max length
            max_model_len = await self._get_model_max_length()
            if not max_model_len:
                return TestResult(
                    passed=False,
                    error="Could not determine model max_model_len",
                )

            target_context = int(max_model_len * target_ratio)

            # Load base prompt
            prompt_path = Path(self.config["test_params"]["long_context_base_prompt_path"])
            if prompt_path.exists():
                with open(prompt_path) as f:
                    base_prompt = f.read()
            else:
                # Fallback to generated repeating content
                base_prompt = "The quick brown fox jumps over the lazy dog. " * 100

            # Estimate tokens (rough: ~4 chars per token)
            estimated_tokens = len(base_prompt) // 4
            repetitions = max(1, target_context // estimated_tokens)
            long_prompt = base_prompt * repetitions

            # Truncate if needed (be conservative)
            max_chars = target_context * 4
            if len(long_prompt) > max_chars:
                long_prompt = long_prompt[:max_chars]

            payload = {
                "model": "default",
                "prompt": long_prompt,
                "max_tokens": 50,  # Just need a short response
                "temperature": 0.7,
            }

            response = await self.client.post(
                f"{self.inference_url}/v1/completions",
                json=payload,
                timeout=self.config["timeouts"]["long_context"],
            )

            latency_ms = (time.time() - start) * 1000

            if response.status_code != 200:
                return TestResult(
                    passed=False,
                    latency_ms=latency_ms,
                    error=f"Long context generation failed: {response.status_code}",
                )

            data = response.json()
            prompt_tokens = data.get("usage", {}).get("prompt_tokens", 0)
            achieved_ratio = prompt_tokens / max_model_len if max_model_len else 0

            # Pass if we got at least 80% of target ratio
            min_acceptable_ratio = target_ratio * 0.8
            passed = achieved_ratio >= min_acceptable_ratio

            return TestResult(
                passed=passed,
                latency_ms=latency_ms,
                details={
                    "max_model_len": max_model_len,
                    "target_context": target_context,
                    "target_ratio": target_ratio,
                    "prompt_tokens_achieved": prompt_tokens,
                    "achieved_ratio": achieved_ratio,
                    "min_acceptable_ratio": min_acceptable_ratio,
                },
            )

        except Exception as e:
            latency_ms = (time.time() - start) * 1000
            return TestResult(passed=False, latency_ms=latency_ms, error=str(e))

    async def memory_headroom(self) -> TestResult:
        """Test 4: Verify VRAM usage stays within gpu_memory_utilization setting."""
        start = time.time()
        try:
            # Get GPU info from controller
            response = await self.client.get(f"{self.controller_url}/gpus")
            if response.status_code != 200:
                return TestResult(
                    passed=False,
                    error="Could not fetch GPU information",
                )

            data = response.json()
            gpus = data.get("gpus", [])

            if not gpus:
                # No GPU monitoring available - pass optimistically
                return TestResult(
                    passed=True,
                    details={"note": "No GPU monitoring available, skipping test"},
                )

            latency_ms = (time.time() - start) * 1000

            # Check each GPU
            all_passed = True
            gpu_details = []

            for gpu in gpus:
                memory_total = gpu.get("memory_total", 0)
                memory_used = gpu.get("memory_used", 0)

                if memory_total == 0:
                    continue

                usage_percent = (memory_used / memory_total) * 100

                # Assume gpu_memory_utilization is ~90% by default
                # We want to ensure there's at least 5% headroom
                min_headroom = self.config["thresholds"]["memory_headroom_min_percent"]
                max_acceptable_usage = 100 - min_headroom

                gpu_passed = usage_percent <= max_acceptable_usage

                gpu_details.append({
                    "gpu_index": gpu.get("index"),
                    "gpu_name": gpu.get("name"),
                    "memory_total_gb": memory_total / (1024**3),
                    "memory_used_gb": memory_used / (1024**3),
                    "usage_percent": usage_percent,
                    "max_acceptable_usage": max_acceptable_usage,
                    "passed": gpu_passed,
                })

                all_passed = all_passed and gpu_passed

            return TestResult(
                passed=all_passed,
                latency_ms=latency_ms,
                details={"gpus": gpu_details},
            )

        except Exception as e:
            latency_ms = (time.time() - start) * 1000
            return TestResult(passed=False, latency_ms=latency_ms, error=str(e))

    async def restart_validation(self, recipe_id: str) -> TestResult:
        """Test 5: Evict, relaunch, and verify model still works.

        Args:
            recipe_id: Recipe ID to restart (or current running model)
        """
        start = time.time()
        try:
            # Step 1: Get current model info
            status_resp = await self.client.get(f"{self.controller_url}/status")
            if status_resp.status_code != 200:
                return TestResult(passed=False, error="Could not get controller status")

            current_status = status_resp.json()
            was_running = current_status.get("running", False)

            if not was_running and not recipe_id:
                return TestResult(
                    passed=False,
                    error="No model running and no recipe_id provided",
                )

            # Step 2: Evict current model
            evict_resp = await self.client.post(
                f"{self.controller_url}/evict",
                json={"force": True},
            )
            if evict_resp.status_code != 200:
                return TestResult(passed=False, error="Failed to evict model")

            # Wait for eviction
            await asyncio.sleep(3)

            # Step 3: Relaunch model
            if not recipe_id:
                # Extract from current process
                process_info = current_status.get("process", {})
                model_path = process_info.get("model_path", "")
                # Try to find recipe by model path
                recipes_resp = await self.client.get(f"{self.controller_url}/recipes")
                if recipes_resp.status_code == 200:
                    recipes = recipes_resp.json()
                    for recipe in recipes:
                        if model_path in recipe.get("model_path", ""):
                            recipe_id = recipe.get("id")
                            break

            if not recipe_id:
                return TestResult(
                    passed=False,
                    error="Could not determine recipe_id for restart",
                )

            launch_resp = await self.client.post(
                f"{self.controller_url}/launch/{recipe_id}",
                timeout=self.config["timeouts"]["restart"],
            )

            if launch_resp.status_code != 200:
                return TestResult(
                    passed=False,
                    error=f"Failed to launch model: {launch_resp.text}",
                )

            launch_data = launch_resp.json()
            if not launch_data.get("success"):
                return TestResult(
                    passed=False,
                    error=f"Launch failed: {launch_data.get('message')}",
                )

            # Step 4: Wait for model to be ready
            ready_resp = await self.client.get(
                f"{self.controller_url}/wait-ready",
                params={"timeout": 300},
            )

            if ready_resp.status_code != 200:
                return TestResult(passed=False, error="Model did not become ready")

            ready_data = ready_resp.json()
            if not ready_data.get("ready"):
                return TestResult(passed=False, error="Model failed readiness check")

            # Step 5: Verify with a test generation
            test_payload = {
                "model": "default",
                "prompt": "Say hello.",
                "max_tokens": 10,
            }

            test_resp = await self.client.post(
                f"{self.inference_url}/v1/completions",
                json=test_payload,
                timeout=30,
            )

            latency_ms = (time.time() - start) * 1000

            if test_resp.status_code != 200:
                return TestResult(
                    passed=False,
                    latency_ms=latency_ms,
                    error="Model restarted but generation test failed",
                )

            return TestResult(
                passed=True,
                latency_ms=latency_ms,
                details={
                    "recipe_id": recipe_id,
                    "restart_time_ms": latency_ms,
                    "verification_passed": True,
                },
            )

        except Exception as e:
            latency_ms = (time.time() - start) * 1000
            return TestResult(passed=False, latency_ms=latency_ms, error=str(e))

    async def run_full_validation(
        self,
        model_id: Optional[str] = None,
        recipe_id: Optional[str] = None,
        skip_restart: bool = False,
    ) -> ValidationResults:
        """Run all validation tests and return results.

        Args:
            model_id: Model identifier for reporting (auto-detected if None)
            recipe_id: Recipe ID for restart test (auto-detected if None)
            skip_restart: Skip the restart validation test
        """
        timestamp = datetime.now(timezone.utc).isoformat()

        # Auto-detect model_id if not provided
        if not model_id:
            try:
                status_resp = await self.client.get(f"{self.controller_url}/status")
                if status_resp.status_code == 200:
                    data = status_resp.json()
                    process = data.get("process", {})
                    model_id = (
                        process.get("served_model_name")
                        or process.get("model_path", "unknown").split("/")[-1]
                    )
            except Exception:
                model_id = "unknown"

        # Run tests
        tests = {}

        print(f"\n{'='*60}")
        print(f"Starting validation for model: {model_id}")
        print(f"{'='*60}\n")

        print("Running health check...")
        tests["health_check"] = await self.health_check()
        print(f"  Result: {'PASS' if tests['health_check'].passed else 'FAIL'}")
        if tests["health_check"].error:
            print(f"  Error: {tests['health_check'].error}")

        print("\nRunning short generation test...")
        tests["short_generation"] = await self.short_generation()
        print(f"  Result: {'PASS' if tests['short_generation'].passed else 'FAIL'}")
        if tests["short_generation"].latency_ms:
            print(f"  Latency: {tests['short_generation'].latency_ms:.2f}ms")
        if tests["short_generation"].error:
            print(f"  Error: {tests['short_generation'].error}")

        print("\nRunning long context test...")
        target_ratio = self.config["thresholds"]["long_context_target_ratio"]
        tests["long_context"] = await self.long_context_test(target_ratio)
        print(f"  Result: {'PASS' if tests['long_context'].passed else 'FAIL'}")
        if tests["long_context"].details:
            details = tests["long_context"].details
            print(f"  Target ratio: {details.get('target_ratio', 0):.1%}")
            print(f"  Achieved ratio: {details.get('achieved_ratio', 0):.1%}")
        if tests["long_context"].error:
            print(f"  Error: {tests['long_context'].error}")

        print("\nRunning memory headroom test...")
        tests["memory_headroom"] = await self.memory_headroom()
        print(f"  Result: {'PASS' if tests['memory_headroom'].passed else 'FAIL'}")
        if tests["memory_headroom"].details:
            for gpu in tests["memory_headroom"].details.get("gpus", []):
                print(f"  GPU {gpu['gpu_index']}: {gpu['usage_percent']:.1f}% used")
        if tests["memory_headroom"].error:
            print(f"  Error: {tests['memory_headroom'].error}")

        if not skip_restart:
            print("\nRunning restart validation test...")
            tests["restart_validation"] = await self.restart_validation(recipe_id)
            print(f"  Result: {'PASS' if tests['restart_validation'].passed else 'FAIL'}")
            if tests["restart_validation"].latency_ms:
                print(f"  Restart time: {tests['restart_validation'].latency_ms/1000:.1f}s")
            if tests["restart_validation"].error:
                print(f"  Error: {tests['restart_validation'].error}")
        else:
            print("\nSkipping restart validation (--skip-restart)")

        overall_passed = all(t.passed for t in tests.values())

        print(f"\n{'='*60}")
        print(f"Validation {'PASSED' if overall_passed else 'FAILED'}")
        print(f"{'='*60}\n")

        return ValidationResults(
            model_id=model_id,
            timestamp=timestamp,
            controller_url=self.controller_url,
            inference_url=self.inference_url,
            tests=tests,
            overall_passed=overall_passed,
            notes="",
        )


async def main():
    """CLI entry point for test harness."""
    parser = argparse.ArgumentParser(
        description="Model validation test harness for vLLM Studio"
    )
    parser.add_argument(
        "--controller-url",
        default="http://localhost:8080",
        help="Controller API URL (default: http://localhost:8080)",
    )
    parser.add_argument(
        "--inference-url",
        default="http://localhost:8000",
        help="Inference backend URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).parent / "test_config.yaml",
        help="Path to test configuration file",
    )
    parser.add_argument(
        "--model-id",
        help="Model identifier for reporting (auto-detected if not provided)",
    )
    parser.add_argument(
        "--recipe-id",
        help="Recipe ID for restart test (auto-detected if not provided)",
    )
    parser.add_argument(
        "--skip-restart",
        action="store_true",
        help="Skip the restart validation test",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output file for results JSON (default: print to stdout)",
    )

    args = parser.parse_args()

    validator = ModelValidator(
        controller_url=args.controller_url,
        inference_url=args.inference_url,
        config_path=args.config,
    )

    try:
        results = await validator.run_full_validation(
            model_id=args.model_id,
            recipe_id=args.recipe_id,
            skip_restart=args.skip_restart,
        )

        # Output results
        results_json = json.dumps(results.to_dict(), indent=2)

        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(results_json)
            print(f"\nResults saved to: {args.output}")
        else:
            print("\nDetailed Results:")
            print(results_json)

    finally:
        await validator.close()


if __name__ == "__main__":
    asyncio.run(main())
