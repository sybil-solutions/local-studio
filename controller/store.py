"""SQLite storage for recipes and metrics."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, List, Optional, Dict, Any

from .models import Recipe


class RecipeStore:
    """SQLite-backed recipe storage."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._conn() as conn:
            # Check if recipes table exists and has the expected schema
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'")
            table_exists = cursor.fetchone() is not None

            if table_exists:
                # Check column names
                cursor = conn.execute("PRAGMA table_info(recipes)")
                columns = {row[1] for row in cursor.fetchall()}

                # Legacy schema uses 'json', new schema uses 'data'
                if 'json' in columns and 'data' not in columns:
                    # Use legacy schema - set flag
                    self._use_json_column = True
                else:
                    self._use_json_column = 'data' not in columns
            else:
                # Create new table with 'data' column
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS recipes (
                        id TEXT PRIMARY KEY,
                        data TEXT NOT NULL,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                self._use_json_column = False

    def list(self) -> List[Recipe]:
        col = "json" if getattr(self, '_use_json_column', False) else "data"
        with self._conn() as conn:
            rows = conn.execute(f"SELECT {col} FROM recipes ORDER BY id").fetchall()
        recipes = []
        for row in rows:
            try:
                recipes.append(Recipe.model_validate_json(row[col]))
            except Exception:
                # Skip invalid recipes (e.g., unsupported backends)
                continue
        return recipes

    def get(self, recipe_id: str) -> Optional[Recipe]:
        col = "json" if getattr(self, '_use_json_column', False) else "data"
        with self._conn() as conn:
            row = conn.execute(f"SELECT {col} FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        if not row:
            return None
        return Recipe.model_validate_json(row[col])

    def save(self, recipe: Recipe) -> None:
        data = recipe.model_dump_json()
        col = "json" if getattr(self, '_use_json_column', False) else "data"
        with self._conn() as conn:
            if self._use_json_column:
                # Legacy schema
                conn.execute(
                    f"""
                    INSERT INTO recipes (id, {col}, created_at, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET {col} = excluded.{col}, updated_at = CURRENT_TIMESTAMP
                    """,
                    (recipe.id, data),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
                    """,
                    (recipe.id, data),
                )

    def delete(self, recipe_id: str) -> bool:
        with self._conn() as conn:
            cursor = conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        return cursor.rowcount > 0

    def import_from_json(self, json_path: Path) -> int:
        """Import recipes from a JSON file."""
        data = json.loads(json_path.read_text())
        recipes = data if isinstance(data, list) else [data]
        count = 0
        for r in recipes:
            try:
                recipe = Recipe.model_validate(r)
                self.save(recipe)
                count += 1
            except Exception:
                continue
        return count


class ChatStore:
    """SQLite-backed chat session storage."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT 'New Chat',
                    model TEXT,
                    parent_id TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT,
                    model TEXT,
                    tool_calls TEXT,
                    request_prompt_tokens INTEGER,
                    request_tools_tokens INTEGER,
                    request_total_input_tokens INTEGER,
                    request_completion_tokens INTEGER,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id)")

    def list_sessions(self) -> List[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_session(self, session_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions WHERE id = ?",
                (session_id,)
            ).fetchone()
            if not row:
                return None
            session = dict(row)
            messages = conn.execute(
                "SELECT id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at",
                (session_id,)
            ).fetchall()
            session["messages"] = []
            for msg in messages:
                m = dict(msg)
                if m.get("tool_calls"):
                    try:
                        m["tool_calls"] = json.loads(m["tool_calls"])
                    except Exception:
                        m["tool_calls"] = None
                session["messages"].append(m)
        return session

    def create_session(self, session_id: str, title: str = "New Chat", model: Optional[str] = None, parent_id: Optional[str] = None) -> dict:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO chat_sessions (id, title, model, parent_id) VALUES (?, ?, ?, ?)",
                (session_id, title, model, parent_id)
            )
            row = conn.execute(
                "SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions WHERE id = ?",
                (session_id,)
            ).fetchone()
        return dict(row)

    def update_session(self, session_id: str, title: Optional[str] = None, model: Optional[str] = None) -> bool:
        updates = []
        params = []
        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if model is not None:
            updates.append("model = ?")
            params.append(model)
        if not updates:
            return True
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(session_id)
        with self._conn() as conn:
            cursor = conn.execute(
                f"UPDATE chat_sessions SET {', '.join(updates)} WHERE id = ?",
                params
            )
        return cursor.rowcount > 0

    def delete_session(self, session_id: str) -> bool:
        with self._conn() as conn:
            conn.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
            cursor = conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        return cursor.rowcount > 0

    def add_message(self, session_id: str, message_id: str, role: str, content: Optional[str] = None,
                    model: Optional[str] = None, tool_calls: Optional[list] = None,
                    request_prompt_tokens: Optional[int] = None, request_tools_tokens: Optional[int] = None,
                    request_total_input_tokens: Optional[int] = None, request_completion_tokens: Optional[int] = None) -> dict:
        tool_calls_json = json.dumps(tool_calls) if tool_calls else None
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO chat_messages
                   (id, session_id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                   content = excluded.content, tool_calls = excluded.tool_calls,
                   request_prompt_tokens = excluded.request_prompt_tokens, request_tools_tokens = excluded.request_tools_tokens,
                   request_total_input_tokens = excluded.request_total_input_tokens, request_completion_tokens = excluded.request_completion_tokens""",
                (message_id, session_id, role, content, model, tool_calls_json,
                 request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens)
            )
            conn.execute("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
            row = conn.execute(
                "SELECT id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens, created_at FROM chat_messages WHERE id = ?",
                (message_id,)
            ).fetchone()
        result = dict(row)
        if result.get("tool_calls"):
            try:
                result["tool_calls"] = json.loads(result["tool_calls"])
            except Exception:
                result["tool_calls"] = None
        return result

    def get_usage(self, session_id: str) -> dict:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens FROM chat_messages WHERE session_id = ?",
                (session_id,)
            ).fetchall()
        prompt = 0
        completion = 0
        for row in rows:
            if row["request_total_input_tokens"]:
                prompt += row["request_total_input_tokens"]
            elif row["request_prompt_tokens"]:
                prompt += row["request_prompt_tokens"]
            if row["request_completion_tokens"]:
                completion += row["request_completion_tokens"]
        return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": prompt + completion}

    def fork_session(self, session_id: str, new_id: str, message_id: Optional[str] = None,
                     model: Optional[str] = None, title: Optional[str] = None) -> Optional[dict]:
        original = self.get_session(session_id)
        if not original:
            return None
        new_title = title or f"{original['title']} (fork)"
        new_model = model or original.get("model")
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO chat_sessions (id, title, model, parent_id) VALUES (?, ?, ?, ?)",
                (new_id, new_title, new_model, session_id)
            )
            # Copy messages up to (and including) message_id
            messages = original.get("messages", [])
            for msg in messages:
                tool_calls_json = json.dumps(msg.get("tool_calls")) if msg.get("tool_calls") else None
                new_msg_id = f"{new_id}_{msg['id']}"
                conn.execute(
                    """INSERT INTO chat_messages
                       (id, session_id, role, content, model, tool_calls, request_prompt_tokens, request_tools_tokens, request_total_input_tokens, request_completion_tokens)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (new_msg_id, new_id, msg["role"], msg.get("content"), msg.get("model"), tool_calls_json,
                     msg.get("request_prompt_tokens"), msg.get("request_tools_tokens"),
                     msg.get("request_total_input_tokens"), msg.get("request_completion_tokens"))
                )
                if message_id and msg["id"] == message_id:
                    break
            row = conn.execute(
                "SELECT id, title, model, parent_id, created_at, updated_at FROM chat_sessions WHERE id = ?",
                (new_id,)
            ).fetchone()
        return dict(row)


class PeakMetricsStore:
    """SQLite-backed storage for peak/best performance metrics per model."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS peak_metrics (
                    model_id TEXT PRIMARY KEY,
                    prefill_tps REAL,
                    generation_tps REAL,
                    ttft_ms REAL,
                    total_tokens INTEGER DEFAULT 0,
                    total_requests INTEGER DEFAULT 0,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def get(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get peak metrics for a model."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM peak_metrics WHERE model_id = ?",
                (model_id,)
            ).fetchone()
        if not row:
            return None
        return dict(row)

    def update_if_better(self, model_id: str, prefill_tps: float = None,
                         generation_tps: float = None, ttft_ms: float = None) -> Dict[str, Any]:
        """Update metrics only if new values are better (higher TPS, lower TTFT)."""
        current = self.get(model_id)

        updates = {}
        if current:
            # Only update if better (higher for TPS)
            if prefill_tps is not None and (current['prefill_tps'] is None or prefill_tps > current['prefill_tps']):
                updates['prefill_tps'] = prefill_tps
            if generation_tps is not None and (current['generation_tps'] is None or generation_tps > current['generation_tps']):
                updates['generation_tps'] = generation_tps
            # Lower TTFT is better
            if ttft_ms is not None and (current['ttft_ms'] is None or ttft_ms < current['ttft_ms']):
                updates['ttft_ms'] = ttft_ms
        else:
            # First entry - store all values
            updates = {
                'prefill_tps': prefill_tps,
                'generation_tps': generation_tps,
                'ttft_ms': ttft_ms
            }

        if updates:
            with self._conn() as conn:
                if current:
                    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
                    conn.execute(
                        f"UPDATE peak_metrics SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE model_id = ?",
                        (*updates.values(), model_id)
                    )
                else:
                    conn.execute(
                        """INSERT INTO peak_metrics (model_id, prefill_tps, generation_tps, ttft_ms)
                           VALUES (?, ?, ?, ?)""",
                        (model_id, updates.get('prefill_tps'), updates.get('generation_tps'), updates.get('ttft_ms'))
                    )

        return self.get(model_id) or {}

    def add_tokens(self, model_id: str, tokens: int, requests: int = 1) -> None:
        """Add to cumulative token/request counts."""
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO peak_metrics (model_id, total_tokens, total_requests)
                VALUES (?, ?, ?)
                ON CONFLICT(model_id) DO UPDATE SET
                    total_tokens = total_tokens + excluded.total_tokens,
                    total_requests = total_requests + excluded.total_requests,
                    updated_at = CURRENT_TIMESTAMP
            """, (model_id, tokens, requests))

    def get_all(self) -> List[Dict[str, Any]]:
        """Get all peak metrics."""
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM peak_metrics ORDER BY model_id").fetchall()
        return [dict(row) for row in rows]


class LifetimeMetricsStore:
    """SQLite-backed storage for lifetime/cumulative metrics across all sessions."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS lifetime_metrics (
                    key TEXT PRIMARY KEY,
                    value REAL NOT NULL DEFAULT 0,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Initialize default values if they don't exist
            defaults = [
                ('tokens_total', 0),
                ('prompt_tokens_total', 0),
                ('completion_tokens_total', 0),
                ('energy_wh', 0),
                ('uptime_seconds', 0),
                ('requests_total', 0),
                ('first_started_at', 0),
            ]
            for key, default in defaults:
                conn.execute("""
                    INSERT OR IGNORE INTO lifetime_metrics (key, value) VALUES (?, ?)
                """, (key, default))

    def get(self, key: str) -> float:
        """Get a lifetime metric value."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM lifetime_metrics WHERE key = ?", (key,)
            ).fetchone()
        return row['value'] if row else 0.0

    def get_all(self) -> Dict[str, float]:
        """Get all lifetime metrics."""
        with self._conn() as conn:
            rows = conn.execute("SELECT key, value FROM lifetime_metrics").fetchall()
        return {row['key']: row['value'] for row in rows}

    def set(self, key: str, value: float) -> None:
        """Set a lifetime metric value."""
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO lifetime_metrics (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            """, (key, value))

    def increment(self, key: str, delta: float) -> float:
        """Increment a lifetime metric and return new value."""
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO lifetime_metrics (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = value + excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            """, (key, delta))
            row = conn.execute(
                "SELECT value FROM lifetime_metrics WHERE key = ?", (key,)
            ).fetchone()
        return row['value'] if row else delta

    def add_energy(self, watt_hours: float) -> None:
        """Add energy consumption in Watt-hours."""
        self.increment('energy_wh', watt_hours)

    def add_tokens(self, tokens: int) -> None:
        """Add to lifetime token count."""
        self.increment('tokens_total', tokens)

    def add_prompt_tokens(self, tokens: int) -> None:
        """Add to lifetime prompt token count."""
        self.increment('prompt_tokens_total', tokens)

    def add_completion_tokens(self, tokens: int) -> None:
        """Add to lifetime completion token count."""
        self.increment('completion_tokens_total', tokens)

    def add_uptime(self, seconds: float) -> None:
        """Add to lifetime uptime."""
        self.increment('uptime_seconds', seconds)

    def add_requests(self, count: int = 1) -> None:
        """Add to lifetime request count."""
        self.increment('requests_total', count)

    def ensure_first_started(self) -> None:
        """Set first_started_at if not already set."""
        import time
        current = self.get('first_started_at')
        if current == 0:
            self.set('first_started_at', time.time())
