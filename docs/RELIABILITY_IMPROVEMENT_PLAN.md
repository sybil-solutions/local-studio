# vLLM Studio Reliability Improvement Plan

**Created**: 2026-01-04
**Status**: Research & Planning Phase
**Priority**: Critical

---

## Problem Analysis

### Current Issues Identified

1. **Controller Shutdown Fragility**
   - When controller process is killed (`SIGKILL`), background tasks terminate without cleanup
   - No graceful shutdown handling for in-flight operations
   - Running inference processes orphaned when controller dies
   - SSE connections not properly closed

2. **State Loss on Restart**
   - `_last_launched_recipe_id` stored only in memory
   - No persistent record of which model was running
   - Auto-restart only works if controller was shut down gracefully
   - Launch progress state lost

3. **Process Orphaning**
   - Inference processes (vLLM/SGLang) continue running after controller death
   - No cleanup of stale processes on controller restart
   - Port conflicts when trying to restart
   - PID tracking lost

4. **Cache Staleness**
   - Recipe changes not reflected until controller restart
   - No cache invalidation mechanism
   - Generated commands cached in memory

5. **Health Check Gaps**
   - Watchdog only checks every 10 seconds
   - No detection of zombie processes
   - No validation that process matches expected configuration
   - Limited retry logic with exponential backoff

6. **Resource Cleanup**
   - SQLite connections not always closed on exceptions
   - File handles potentially leaked
   - GPU state not validated on restart

---

## Reliability Requirements

### Functional Requirements

1. **Graceful Shutdown**
   - Handle `SIGTERM`, `SIGINT` properly
   - Complete in-flight operations before exit
   - Clean shutdown of inference processes or handoff to new controller
   - Close all database connections and file handles

2. **State Persistence**
   - Record running model state to disk
   - Track PIDs and configuration
   - Save launch progress
   - Persist across controller restarts

3. **Automatic Recovery**
   - Detect orphaned processes on startup
   - Resume interrupted launches
   - Validate process health beyond just "is it running?"
   - Exponential backoff for failed restarts

4. **Configuration Hot-Reload**
   - Detect recipe changes without restart
   - Invalidate stale command caches
   - Apply configuration updates safely

5. **Observability**
   - Track controller lifecycle events
   - Monitor inference process health
   - Alert on abnormal conditions
   - Provide diagnostics for troubleshooting

### Non-Functional Requirements

1. **Availability**: 99.9% uptime target
2. **Recovery Time**: < 30 seconds to recover from crash
3. **Data Loss**: Zero loss of chat sessions or metrics
4. **Scalability**: Support multiple concurrent model switches
5. **Performance**: < 100ms overhead for health checks

---

## Proposed Solution Architecture

### 1. Persistent State Management

#### State File Structure
```yaml
# data/controller_state.yaml
controller:
  pid: 12345
  started_at: "2026-01-04T20:00:00Z"
  last_heartbeat: "2026-01-04T20:50:00Z"
  version: "0.2.0"

running_model:
  recipe_id: "glm-4.7-reap-50"
  pid: 54321
  launched_at: "2026-01-04T20:10:00Z"
  configuration:
    tensor_parallel_size: 4
    pipeline_parallel_size: 2
    max_model_len: 200000
    tool_call_parser: "glm47"
    # ... full config snapshot

launch_progress:
  stage: "loading_weights"
  started_at: "2026-01-04T20:09:50Z"
  log_file: "/tmp/vllm_glm-4.7-reap-50.log"
  last_position: 12345
```

#### State Manager Class
```python
class ControllerStateManager:
    """Manages persistent controller state across restarts."""

    def __init__(self, state_path: Path):
        self.state_path = state_path
        self.state = self._load_state()
        self._register_signal_handlers()

    def _load_state(self) -> dict:
        """Load state from disk or create new."""
        if self.state_path.exists():
            return yaml.safe_load(self.state_path.read_text())
        return {"controller": {}, "running_model": None, "launch_progress": None}

    def save_state(self):
        """Atomically save state to disk."""
        tmp_path = self.state_path.with_suffix('.tmp')
        tmp_path.write_text(yaml.safe_dump(self.state))
        tmp_path.replace(self.state_path)

    def update_running_model(self, recipe: Recipe, pid: int):
        """Update running model state."""
        self.state["running_model"] = {
            "recipe_id": recipe.id,
            "pid": pid,
            "launched_at": datetime.now(timezone.utc).isoformat(),
            "configuration": recipe.model_dump(),
        }
        self.save_state()

    def clear_running_model(self):
        """Clear running model state."""
        self.state["running_model"] = None
        self.save_state()

    def get_orphaned_process(self) -> Optional[ProcessInfo]:
        """Check for orphaned inference process from previous run."""
        if not self.state.get("running_model"):
            return None

        # Check if process still exists
        pid = self.state["running_model"]["pid"]
        try:
            proc = psutil.Process(pid)
            if proc.is_running():
                # Validate it's actually our inference process
                cmdline = proc.cmdline()
                if _is_inference_process(cmdline):
                    return ProcessInfo(pid=pid, ...)
        except psutil.NoSuchProcess:
            pass

        # Process died, clear state
        self.clear_running_model()
        return None

    def _register_signal_handlers(self):
        """Register signal handlers for graceful shutdown."""
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")

        # Save state
        self.save_state()

        # Shutdown inference process (optional, configurable)
        if settings.shutdown_inference_on_exit:
            self._shutdown_inference()

        # Close SSE connections
        event_manager.shutdown()

        # Give time for cleanup
        asyncio.get_event_loop().run_until_complete(asyncio.sleep(2))

        # Exit
        sys.exit(0)
```

### 2. Startup Recovery Process

#### Recovery Flow
```python
async def startup_recovery(state_manager: ControllerStateManager):
    """Recover from previous controller instance."""

    # 1. Check for orphaned processes
    orphan = state_manager.get_orphaned_process()
    if orphan:
        logger.warning(f"Found orphaned inference process (pid={orphan.pid})")

        # Validate configuration matches
        stored_config = state_manager.state["running_model"]["configuration"]
        running_config = _infer_process_config(orphan)

        if stored_config == running_config:
            logger.info("Orphaned process matches expected config, adopting it")
            _last_launched_recipe_id = stored_config["id"]
        else:
            logger.warning("Orphaned process config mismatch, killing it")
            await evict_model(force=True)

    # 2. Resume interrupted launch
    if state_manager.state.get("launch_progress"):
        progress = state_manager.state["launch_progress"]
        logger.info(f"Resuming interrupted launch from stage: {progress['stage']}")

        # Check if launch actually completed
        if find_inference_process(settings.inference_port):
            logger.info("Launch completed while controller was down")
            state_manager.state["launch_progress"] = None
            state_manager.save_state()
        else:
            # Restart the launch
            logger.info("Restarting interrupted launch")
            recipe = get_store().get(progress["recipe_id"])
            if recipe:
                await launch_model(recipe)

    # 3. Auto-restart if enabled
    elif settings.auto_restart_last_model:
        last_recipe_id = state_manager.state.get("running_model", {}).get("recipe_id")
        if last_recipe_id:
            logger.info(f"Auto-restoring last model: {last_recipe_id}")
            recipe = get_store().get(last_recipe_id)
            if recipe:
                await launch_model(recipe)
```

### 3. Process Lifecycle Management

#### Enhanced Launch Wrapper
```python
async def launch_model_with_tracking(
    recipe: Recipe,
    state_manager: ControllerStateManager
) -> LaunchResult:
    """Launch model with comprehensive state tracking."""

    # Update launch progress
    state_manager.state["launch_progress"] = {
        "recipe_id": recipe.id,
        "stage": "starting",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "log_file": get_recipe_log_path(recipe.id),
    }
    state_manager.save_state()

    try:
        # Launch the model
        success, pid, message = await launch_model(recipe)

        if success:
            # Update running model state
            state_manager.update_running_model(recipe, pid)
            state_manager.state["launch_progress"] = None
            state_manager.save_state()

            # Wait for health check with timeout
            await wait_for_ready(timeout=300)

            return LaunchResult(success=True, pid=pid, message="Launched successfully")

        else:
            # Launch failed
            state_manager.state["launch_progress"] = None
            state_manager.save_state()
            return LaunchResult(success=False, message=message)

    except Exception as e:
        # Launch crashed
        state_manager.state["launch_progress"] = None
        state_manager.save_state()
        logger.error(f"Launch failed with exception: {e}")
        raise
```

#### Process Validation
```python
async def validate_process_health(pid: int, expected_config: dict) -> bool:
    """Validate that process matches expected configuration."""

    try:
        proc = psutil.Process(pid)

        # Check it's still running
        if not proc.is_running():
            return False

        # Check it's responding to health checks
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                if r.status_code != 200:
                    return False
        except Exception:
            return False

        # Validate configuration (check command line args)
        cmdline = proc.cmdline()
        actual_config = {
            "tensor_parallel_size": _extract_flag(cmdline, "--tensor-parallel-size"),
            "pipeline_parallel_size": _extract_flag(cmdline, "--pipeline-parallel-size"),
            "max_model_len": _extract_flag(cmdline, "--max-model-len"),
            "tool_call_parser": _extract_flag(cmdline, "--tool-call-parser"),
        }

        for key, expected_value in expected_config.items():
            if actual_config.get(key) != expected_value:
                logger.warning(f"Config mismatch: {key} expected={expected_value} actual={actual_config.get(key)}")
                return False

        return True

    except Exception as e:
        logger.error(f"Process validation error: {e}")
        return False
```

### 4. Configuration Cache Invalidation

#### Cache Manager
```python
class RecipeConfigCache:
    """Manage recipe configuration cache with invalidation."""

    def __init__(self, store: RecipeStore):
        self.store = store
        self._cache: Dict[str, tuple[List[str], float]] = {}
        self._watch_thread = None
        self._start_file_watcher()

    def get_command(self, recipe_id: str) -> List[str]:
        """Get cached command or build new one."""
        if recipe_id in self._cache:
            cmd, mtime = self._cache[recipe_id]
            current_mtime = self._get_recipe_mtime(recipe_id)
            if current_mtime == mtime:
                return cmd

        # Cache miss or stale, rebuild
        recipe = self.store.get(recipe_id)
        cmd = build_vllm_command(recipe)
        self._cache[recipe_id] = (cmd, self._get_recipe_mtime(recipe_id))
        return cmd

    def invalidate(self, recipe_id: str):
        """Invalidate cache entry."""
        if recipe_id in self._cache:
            del self._cache[recipe_id]

    def _get_recipe_mtime(self, recipe_id: str) -> float:
        """Get recipe modification time from database."""
        # SQLite stores created_at/updated_at
        # We can use this for cache invalidation
        pass

    def _start_file_watcher(self):
        """Watch for recipe changes and invalidate cache."""
        # Use watchdog library to monitor database file
        pass
```

### 5. Enhanced Health Monitoring

#### Multi-Level Health Checks
```python
class HealthMonitor:
    """Comprehensive health monitoring with multiple levels."""

    async def check_health(self) -> HealthStatus:
        """Perform comprehensive health check."""

        status = HealthStatus(healthy=True, issues=[])

        # Level 1: Process existence
        proc = find_inference_process(settings.inference_port)
        if not proc:
            status.healthy = False
            status.issues.append("No inference process running")
            return status

        # Level 2: Process responsiveness
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                if r.status_code != 200:
                    status.healthy = False
                    status.issues.append(f"Health check failed: HTTP {r.status_code}")
        except Exception as e:
            status.healthy = False
            status.issues.append(f"Health check error: {e}")
            return status

        # Level 3: GPU utilization (should be > 0 if serving requests)
        gpu_info = get_gpu_info()
        if any(gpu.utilization == 0 for gpu in gpu_info):
            status.issues.append("Some GPUs have 0% utilization")

        # Level 4: Memory health (check for OOM risk)
        for gpu in gpu_info:
            if gpu.memory_used / gpu.memory_total > 0.95:
                status.issues.append(f"GPU {gpu.id} near OOM: {gpu.memory_used}/{gpu.memory_total} MB")

        # Level 5: Configuration validation
        expected_config = state_manager.state.get("running_model", {}).get("configuration")
        if expected_config:
            if not await validate_process_health(proc.pid, expected_config):
                status.healthy = False
                status.issues.append("Process configuration mismatch")

        return status
```

### 6. Improved Watchdog

#### Enhanced Watchdog with Backoff
```python
async def enhanced_backend_watchdog(state_manager: ControllerStateManager):
    """Enhanced watchdog with exponential backoff and smarter recovery."""

    consecutive_failures = 0
    base_cooldown = 10
    max_cooldown = 300  # 5 minutes

    while True:
        try:
            health = await health_monitor.check_health()

            if not health.healthy:
                logger.warning(f"Health check failed: {', '.join(health.issues)}")

                # Check if we should restart
                if state_manager.state.get("running_model"):
                    consecutive_failures += 1

                    # Exponential backoff
                    cooldown = min(base_cooldown * (2 ** consecutive_failures), max_cooldown)

                    if consecutive_failures <= 3:  # Max 3 restart attempts
                        logger.info(f"Attempting restart (attempt {consecutive_failures}/3)")
                        recipe_id = state_manager.state["running_model"]["recipe_id"]
                        recipe = get_store().get(recipe_id)

                        if recipe:
                            await evict_model(force=True)
                            success, pid, msg = await launch_model_with_tracking(recipe, state_manager)

                            if success:
                                logger.info(f"Watchdog restart successful (pid={pid})")
                                consecutive_failures = 0
                                cooldown = base_cooldown
                            else:
                                logger.error(f"Watchdog restart failed: {msg}")
                    else:
                        logger.error("Max restart attempts reached, giving up")
                        state_manager.clear_running_model()
                        consecutive_failures = 0

                await asyncio.sleep(cooldown)
            else:
                # Healthy, reset failures
                consecutive_failures = 0
                await asyncio.sleep(10)

        except Exception as e:
            logger.error(f"Watchdog error: {e}")
            await asyncio.sleep(30)
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Priority: Critical**

1. **State Persistence System**
   - Create `ControllerStateManager` class
   - Implement YAML-based state file
   - Add signal handlers for graceful shutdown
   - Add state saving to launch/evict operations

**Files to Create/Modify**:
- `controller/state_manager.py` (new)
- `controller/__init__.py` (export state_manager)
- `controller/app.py` (integrate state_manager)

**Success Criteria**:
- Controller state survives restarts
- Graceful shutdown cleans up properly
- Orphaned processes detected on startup

### Phase 2: Startup Recovery (Week 1-2)

**Priority: Critical**

1. **Orphan Process Detection**
   - Implement `get_orphaned_process()`
   - Add configuration validation
   - Handle config mismatches (kill vs adopt)

2. **Launch Resumption**
   - Track launch progress to disk
   - Resume interrupted launches
   - Detect completed launches

**Files to Create/Modify**:
- `controller/recovery.py` (new)
- `controller/app.py` (add startup_recovery)
- `controller/process.py` (add config inference)

**Success Criteria**:
- Orphaned processes properly handled
- Interrupted launches resume automatically
- No manual intervention needed

### Phase 3: Cache Invalidation (Week 2)

**Priority: High**

1. **Recipe Config Cache**
   - Implement `RecipeConfigCache`
   - Add mtime-based invalidation
   - Watch database for changes

2. **Command Builder Updates**
   - Use cache manager in launch flow
   - Invalidate on recipe updates
   - Add cache statistics endpoint

**Files to Create/Modify**:
- `controller/cache.py` (new)
- `controller/backends.py` (use cache)
- `controller/app.py` (add cache endpoints)

**Success Criteria**:
- Recipe changes reflected immediately
- No controller restart needed
- Cache hit rate > 90%

### Phase 4: Enhanced Monitoring (Week 2-3)

**Priority: High**

1. **Multi-Level Health Checks**
   - Implement `HealthMonitor` class
   - Add GPU utilization checks
   - Add memory health checks
   - Add configuration validation

2. **Improved Watchdog**
   - Exponential backoff
   - Smarter restart logic
   - Better error handling

**Files to Create/Modify**:
- `controller/health.py` (new)
- `controller/app.py` (enhance watchdog)

**Success Criteria**:
- Health issues detected within 10 seconds
- False positives < 1%
- Recovery success rate > 95%

### Phase 5: Observability (Week 3)

**Priority: Medium**

1. **Metrics & Logging**
   - Track controller lifecycle events
   - Monitor restart success rate
   - Alert on abnormal conditions

2. **Diagnostics Endpoints**
   - `/debug/state` - show controller state
   - `/debug/health` - detailed health info
   - `/debug/cache` - cache statistics

**Files to Create/Modify**:
- `controller/metrics.py` (enhance)
- `controller/app.py` (add debug endpoints)

**Success Criteria**:
- All lifecycle events logged
- Debug endpoints useful for troubleshooting
- Metrics available in Prometheus

### Phase 6: Testing & Validation (Week 4)

**Priority: Critical**

1. **Unit Tests**
   - State manager tests
   - Recovery logic tests
   - Health check tests
   - Cache invalidation tests

2. **Integration Tests**
   - Crash recovery scenarios
   - Orphan process handling
   - Launch interruption
   - Config changes during runtime

3. **Chaos Testing**
   - Random SIGKILL during operations
   - Network partition simulation
   - Disk I/O failures
   - GPU crashes

**Files to Create**:
- `tests/test_state_manager.py`
- `tests/test_recovery.py`
- `tests/test_health_monitor.py`
- `tests/test_cache.py`
- `tests/integration/test_crash_recovery.py`
- `tests/chaos/test_chaos_monkey.py`

**Success Criteria**:
- > 95% test coverage
- All chaos tests pass
- Zero data loss scenarios

---

## Risk Mitigation

### Potential Risks

1. **State File Corruption**
   - **Mitigation**: Atomic writes with rename()
   - **Backup**: Keep last 3 versions
   - **Recovery**: Validate YAML on load

2. **Orphan Process Misidentification**
   - **Mitigation**: Validate PID is actually our process
   - **Check**: Verify command line matches
   - **Fallback**: Require manual confirmation

3. **Race Conditions During Recovery**
   - **Mitigation**: Use file locks
   - **Synchronization**: Single recovery thread
   - **Timeout**: Fail after 30 seconds

4. **Cache Stampede**
   - **Mitigation**: Single cache update thread
   - **Locking**: Per-recipe locks
   - **Rate Limit**: Max 1 update per second

5. **Watchdog Over-Recovery**
   - **Mitigation**: Max restart attempts
   - **Backoff**: Exponential cooldown
   - **Manual Override**: Disable auto-restart flag

---

## Success Metrics

### Reliability Metrics

- **Mean Time Between Failures (MTBF)**: > 72 hours
- **Mean Time To Recovery (MTTR)**: < 30 seconds
- **Data Loss Incidents**: 0
- **Manual Interventions**: < 1 per week

### Performance Metrics

- **Health Check Overhead**: < 100ms
- **State Save Latency**: < 10ms
- **Cache Hit Rate**: > 90%
- **Startup Recovery Time**: < 5 seconds

### Quality Metrics

- **Test Coverage**: > 95%
- **Critical Bugs**: 0
- **False Positive Rate**: < 1%

---

## Rollout Plan

### Phase 1: Alpha (Internal Testing)
- Deploy to development environment
- Test with controlled failures
- Fix critical issues
- Duration: 1 week

### Phase 2: Beta (Limited Production)
- Deploy to single production instance
- Monitor metrics closely
- Gather feedback
- Duration: 1 week

### Phase 3: General Availability
- Deploy to all instances
- Enable auto-restart by default
- Monitor for 2 weeks
- Be ready to rollback

### Phase 4: Optimization
- Analyze production metrics
- Tune thresholds and timeouts
- Add additional checks
- Continuous improvement

---

## Maintenance & Operations

### Runbooks

1. **Manual Recovery**
   - If auto-recovery fails, follow these steps...
   - How to identify orphaned processes
   - How to manually restart models

2. **State File Management**
   - How to edit state file safely
   - How to reset corrupt state
   - Backup/restore procedures

3. **Emergency Shutdown**
   - How to gracefully shutdown everything
   - How to force kill if needed
   - What to check before restarting

### Monitoring

**Key Metrics to Monitor**:
- Controller uptime
- Model restart frequency
- Recovery success rate
- Health check failure rate
- State file size/age

**Alerts**:
- Controller down for > 1 minute
- > 3 restart attempts in 10 minutes
- Health check failures > 50% for 1 minute
- State file corrupted or missing

---

## Conclusion

This plan addresses all identified reliability issues through:

1. **Persistent state** for crash recovery
2. **Graceful shutdown** for clean exits
3. **Orphan detection** for startup cleanup
4. **Cache invalidation** for config updates
5. **Enhanced monitoring** for early detection
6. **Comprehensive testing** for quality assurance

Implementation will be phased over 4 weeks, with each phase building on the previous. The end result will be a production-grade system capable of surviving failures without data loss or manual intervention.

---

## Appendix: Code Snippets

### Signal Handler Registration
```python
import signal
import sys
import asyncio

def setup_signal_handlers(state_manager: ControllerStateManager):
    """Register signal handlers for graceful shutdown."""

    def handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        asyncio.create_task(graceful_shutdown(state_manager))

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)

async def graceful_shutdown(state_manager: ControllerStateManager):
    """Perform graceful shutdown."""

    # Stop accepting new requests
    logger.info("Stopping new requests...")

    # Save state
    state_manager.save_state()
    logger.info("State saved")

    # Close SSE connections
    await event_manager.shutdown()
    logger.info("SSE connections closed")

    # Optional: Shutdown inference
    if settings.shutdown_inference_on_exit:
        await evict_model(force=True)
        logger.info("Inference shutdown")

    # Give time for in-flight requests
    await asyncio.sleep(2)

    # Exit
    sys.exit(0)
```

### Atomic State Save
```python
import tempfile
from pathlib import Path

def save_state_atomic(state: dict, path: Path):
    """Atomically save state to avoid corruption."""

    # Write to temp file
    tmp_path = path.with_suffix('.tmp')
    tmp_path.write_text(yaml.safe_dump(state))

    # Sync to disk
    tmp_path.flush()
    os.fsync(tmp_path.fileno())

    # Atomic rename
    tmp_path.replace(path)

    # Cleanup old backups
    for i in range(3, 0, -1):
        backup = path.with_suffix(f'.{i}')
        if backup.exists():
            if i == 3:
                backup.unlink()  # Delete oldest
            else:
                backup.rename(path.with_suffix(f'.{i+1}'))

    # Keep backup of current state
    if path.exists():
        path.rename(path.with_suffix('.1'))
```

### Process Configuration Inference
```python
def infer_process_config(pid: int) -> dict:
    """Infer process configuration from command line."""

    proc = psutil.Process(pid)
    cmdline = proc.cmdline()

    return {
        "tensor_parallel_size": int(_extract_flag(cmdline, "--tensor-parallel-size") or 1),
        "pipeline_parallel_size": int(_extract_flag(cmdline, "--pipeline-parallel-size") or 1),
        "max_model_len": int(_extract_flag(cmdline, "--max-model-len") or 32768),
        "tool_call_parser": _extract_flag(cmdline, "--tool-call-parser"),
        "enable_auto_tool_choice": "--enable-auto-tool-choice" in cmdline,
        "kv_cache_dtype": _extract_flag(cmdline, "--kv-cache-dtype") or "auto",
        "gpu_memory_utilization": float(_extract_flag(cmdline, "--gpu-memory-utilization") or 0.9),
    }
```
