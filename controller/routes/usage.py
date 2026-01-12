"""Usage analytics endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["Analytics"])
logger = logging.getLogger(__name__)


@router.get("/usage")
async def get_usage_stats():
    """Get comprehensive usage statistics from LiteLLM spend logs.

    Returns detailed analytics including:
    - Summary totals with success/failure breakdown
    - Latency percentiles (p50, p95, p99) and TTFT stats
    - Per-model performance metrics (tokens/sec, latency, TTFT)
    - Daily and hourly breakdowns
    - Week-over-week comparisons
    - Cache efficiency stats
    - Session and user counts
    - Peak usage periods
    """
    import asyncpg
    from decimal import Decimal

    db_url = "postgresql://postgres:postgres@127.0.0.1:5432/litellm"

    def to_float(val):
        """Convert Decimal/None to float for JSON serialization."""
        if val is None:
            return None
        return float(val) if isinstance(val, Decimal) else val

    try:
        conn = await asyncpg.connect(db_url)

        # === SUMMARY TOTALS ===
        totals = await conn.fetchrow('''
            SELECT
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_requests,
                SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failed_requests,
                COUNT(DISTINCT session_id) as unique_sessions,
                COUNT(DISTINCT "user") as unique_users
            FROM "LiteLLM_SpendLogs"
        ''')

        # === LATENCY STATS (successful requests only) ===
        latency_stats = await conn.fetchrow('''
            SELECT
                AVG(EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000) as avg_latency_ms,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000) as p50_latency_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000) as p95_latency_ms,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000) as p99_latency_ms,
                MIN(EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000) as min_latency_ms,
                MAX(EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000) as max_latency_ms
            FROM "LiteLLM_SpendLogs"
            WHERE status = 'success' AND "endTime" IS NOT NULL AND "startTime" IS NOT NULL
        ''')

        # === TIME TO FIRST TOKEN ===
        ttft_stats = await conn.fetchrow('''
            SELECT
                AVG(EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) * 1000) as avg_ttft_ms,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) * 1000) as p50_ttft_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) * 1000) as p95_ttft_ms,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) * 1000) as p99_ttft_ms
            FROM "LiteLLM_SpendLogs"
            WHERE status = 'success' AND "completionStartTime" IS NOT NULL AND "startTime" IS NOT NULL
        ''')

        # === TOKENS PER REQUEST STATS ===
        token_stats = await conn.fetchrow('''
            SELECT
                AVG(total_tokens) as avg_tokens_per_request,
                AVG(prompt_tokens) as avg_prompt_tokens,
                AVG(completion_tokens) as avg_completion_tokens,
                MAX(total_tokens) as max_tokens_single_request,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_tokens) as p50_tokens,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_tokens) as p95_tokens
            FROM "LiteLLM_SpendLogs"
            WHERE status = 'success' AND total_tokens IS NOT NULL
        ''')

        # === CACHE STATS ===
        cache_stats = await conn.fetch('''
            SELECT
                cache_hit,
                COUNT(*) as count,
                COALESCE(SUM(total_tokens), 0) as tokens
            FROM "LiteLLM_SpendLogs"
            GROUP BY cache_hit
        ''')

        # === BY MODEL (with performance metrics) ===
        by_model = await conn.fetch('''
            SELECT
                model,
                COUNT(*) as requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                AVG(CASE WHEN status = 'success' THEN total_tokens END) as avg_tokens,
                AVG(CASE WHEN status = 'success' THEN EXTRACT(EPOCH FROM ("endTime" - "startTime")) END) as avg_latency_sec,
                AVG(CASE WHEN status = 'success' THEN EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) END) as avg_ttft_sec,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN status = 'success' THEN EXTRACT(EPOCH FROM ("endTime" - "startTime")) END) as p50_latency_sec
            FROM "LiteLLM_SpendLogs"
            WHERE model != '' AND model IS NOT NULL
            GROUP BY model
            ORDER BY total_tokens DESC
            LIMIT 25
        ''')

        # === DAILY BREAKDOWN (last 14 days) ===
        daily = await conn.fetch('''
            SELECT
                DATE("startTime") as date,
                COUNT(*) as requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
                COALESCE(SUM(total_tokens), 0) as total_tokens,
                COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) as completion_tokens,
                AVG(CASE WHEN status = 'success' THEN EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000 END) as avg_latency_ms
            FROM "LiteLLM_SpendLogs"
            WHERE "startTime" >= CURRENT_DATE - INTERVAL '14 days'
            GROUP BY DATE("startTime")
            ORDER BY date DESC
        ''')

        # === HOURLY PATTERN (aggregated across all days) ===
        hourly = await conn.fetch('''
            SELECT
                EXTRACT(HOUR FROM "startTime")::int as hour,
                COUNT(*) as requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
                COALESCE(SUM(total_tokens), 0) as total_tokens
            FROM "LiteLLM_SpendLogs"
            WHERE "startTime" IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM "startTime")
            ORDER BY hour
        ''')

        # === WEEK OVER WEEK ===
        wow = await conn.fetchrow('''
            SELECT
                SUM(CASE WHEN "startTime" >= CURRENT_DATE - INTERVAL '7 days' THEN 1 ELSE 0 END) as this_week_requests,
                SUM(CASE WHEN "startTime" >= CURRENT_DATE - INTERVAL '14 days' AND "startTime" < CURRENT_DATE - INTERVAL '7 days' THEN 1 ELSE 0 END) as last_week_requests,
                SUM(CASE WHEN "startTime" >= CURRENT_DATE - INTERVAL '7 days' AND status = 'success' THEN total_tokens ELSE 0 END) as this_week_tokens,
                SUM(CASE WHEN "startTime" >= CURRENT_DATE - INTERVAL '14 days' AND "startTime" < CURRENT_DATE - INTERVAL '7 days' AND status = 'success' THEN total_tokens ELSE 0 END) as last_week_tokens,
                SUM(CASE WHEN "startTime" >= CURRENT_DATE - INTERVAL '7 days' AND status = 'success' THEN 1 ELSE 0 END) as this_week_successful,
                SUM(CASE WHEN "startTime" >= CURRENT_DATE - INTERVAL '14 days' AND "startTime" < CURRENT_DATE - INTERVAL '7 days' AND status = 'success' THEN 1 ELSE 0 END) as last_week_successful
            FROM "LiteLLM_SpendLogs"
        ''')

        # === PEAK DAYS ===
        peak_days = await conn.fetch('''
            SELECT
                DATE("startTime") as date,
                COUNT(*) as requests,
                COALESCE(SUM(total_tokens), 0) as tokens
            FROM "LiteLLM_SpendLogs"
            WHERE status = 'success'
            GROUP BY DATE("startTime")
            ORDER BY requests DESC
            LIMIT 5
        ''')

        # === PEAK HOURS (most active hours) ===
        peak_hours = await conn.fetch('''
            SELECT
                EXTRACT(HOUR FROM "startTime")::int as hour,
                COUNT(*) as requests
            FROM "LiteLLM_SpendLogs"
            WHERE "startTime" >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY EXTRACT(HOUR FROM "startTime")
            ORDER BY requests DESC
            LIMIT 5
        ''')

        # === RECENT ACTIVITY (last 24h vs previous 24h) ===
        recent = await conn.fetchrow('''
            SELECT
                SUM(CASE WHEN "startTime" >= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as last_24h_requests,
                SUM(CASE WHEN "startTime" >= NOW() - INTERVAL '48 hours' AND "startTime" < NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as prev_24h_requests,
                SUM(CASE WHEN "startTime" >= NOW() - INTERVAL '24 hours' AND status = 'success' THEN total_tokens ELSE 0 END) as last_24h_tokens,
                SUM(CASE WHEN "startTime" >= NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END) as last_hour_requests
            FROM "LiteLLM_SpendLogs"
        ''')

        await conn.close()

        # Format cache stats
        cache_formatted = {"hits": 0, "misses": 0, "hit_tokens": 0, "miss_tokens": 0, "hit_rate": 0.0}
        for row in cache_stats:
            if row["cache_hit"] == "True":
                cache_formatted["hits"] = row["count"]
                cache_formatted["hit_tokens"] = row["tokens"]
            elif row["cache_hit"] == "False":
                cache_formatted["misses"] = row["count"]
                cache_formatted["miss_tokens"] = row["tokens"]
        total_cache = cache_formatted["hits"] + cache_formatted["misses"]
        if total_cache > 0:
            cache_formatted["hit_rate"] = round(cache_formatted["hits"] / total_cache * 100, 2)

        # Calculate week-over-week changes
        def calc_change(current, previous):
            if not previous or previous == 0:
                return None
            return round((current - previous) / previous * 100, 1)

        wow_data = {
            "this_week": {
                "requests": wow["this_week_requests"] or 0,
                "tokens": wow["this_week_tokens"] or 0,
                "successful": wow["this_week_successful"] or 0
            },
            "last_week": {
                "requests": wow["last_week_requests"] or 0,
                "tokens": wow["last_week_tokens"] or 0,
                "successful": wow["last_week_successful"] or 0
            },
            "change_pct": {
                "requests": calc_change(wow["this_week_requests"], wow["last_week_requests"]),
                "tokens": calc_change(wow["this_week_tokens"], wow["last_week_tokens"])
            }
        }

        # Format model data with computed metrics
        models_formatted = []
        for row in by_model:
            avg_latency = to_float(row["avg_latency_sec"])
            completion_tokens = row["completion_tokens"] or 0
            tokens_per_sec = None
            if avg_latency and avg_latency > 0 and row["successful"] and row["successful"] > 0:
                avg_completion = completion_tokens / row["successful"]
                tokens_per_sec = round(avg_completion / avg_latency, 1) if avg_completion else None

            models_formatted.append({
                "model": row["model"],
                "requests": row["requests"],
                "successful": row["successful"],
                "success_rate": round(row["successful"] / row["requests"] * 100, 1) if row["requests"] else 0,
                "total_tokens": row["total_tokens"],
                "prompt_tokens": row["prompt_tokens"],
                "completion_tokens": completion_tokens,
                "avg_tokens": round(to_float(row["avg_tokens"]) or 0),
                "avg_latency_ms": round((to_float(row["avg_latency_sec"]) or 0) * 1000),
                "p50_latency_ms": round((to_float(row["p50_latency_sec"]) or 0) * 1000),
                "avg_ttft_ms": round((to_float(row["avg_ttft_sec"]) or 0) * 1000),
                "tokens_per_sec": tokens_per_sec
            })

        success_rate = round(totals["successful_requests"] / totals["total_requests"] * 100, 2) if totals["total_requests"] else 0

        return {
            "totals": {
                "total_tokens": totals["total_tokens"],
                "prompt_tokens": totals["prompt_tokens"],
                "completion_tokens": totals["completion_tokens"],
                "total_requests": totals["total_requests"],
                "successful_requests": totals["successful_requests"],
                "failed_requests": totals["failed_requests"],
                "success_rate": success_rate,
                "unique_sessions": totals["unique_sessions"],
                "unique_users": totals["unique_users"]
            },
            "latency": {
                "avg_ms": round(to_float(latency_stats["avg_latency_ms"]) or 0),
                "p50_ms": round(to_float(latency_stats["p50_latency_ms"]) or 0),
                "p95_ms": round(to_float(latency_stats["p95_latency_ms"]) or 0),
                "p99_ms": round(to_float(latency_stats["p99_latency_ms"]) or 0),
                "min_ms": round(to_float(latency_stats["min_latency_ms"]) or 0),
                "max_ms": round(to_float(latency_stats["max_latency_ms"]) or 0)
            },
            "ttft": {
                "avg_ms": round(to_float(ttft_stats["avg_ttft_ms"]) or 0),
                "p50_ms": round(to_float(ttft_stats["p50_ttft_ms"]) or 0),
                "p95_ms": round(to_float(ttft_stats["p95_ttft_ms"]) or 0),
                "p99_ms": round(to_float(ttft_stats["p99_ttft_ms"]) or 0)
            },
            "tokens_per_request": {
                "avg": round(to_float(token_stats["avg_tokens_per_request"]) or 0),
                "avg_prompt": round(to_float(token_stats["avg_prompt_tokens"]) or 0),
                "avg_completion": round(to_float(token_stats["avg_completion_tokens"]) or 0),
                "max": token_stats["max_tokens_single_request"] or 0,
                "p50": round(to_float(token_stats["p50_tokens"]) or 0),
                "p95": round(to_float(token_stats["p95_tokens"]) or 0)
            },
            "cache": cache_formatted,
            "week_over_week": wow_data,
            "recent_activity": {
                "last_hour_requests": recent["last_hour_requests"] or 0,
                "last_24h_requests": recent["last_24h_requests"] or 0,
                "prev_24h_requests": recent["prev_24h_requests"] or 0,
                "last_24h_tokens": recent["last_24h_tokens"] or 0,
                "change_24h_pct": calc_change(recent["last_24h_requests"], recent["prev_24h_requests"])
            },
            "peak_days": [
                {"date": row["date"].isoformat(), "requests": row["requests"], "tokens": row["tokens"]}
                for row in peak_days
            ],
            "peak_hours": [
                {"hour": row["hour"], "requests": row["requests"]}
                for row in peak_hours
            ],
            "by_model": models_formatted,
            "daily": [
                {
                    "date": row["date"].isoformat(),
                    "requests": row["requests"],
                    "successful": row["successful"],
                    "success_rate": round(row["successful"] / row["requests"] * 100, 1) if row["requests"] else 0,
                    "total_tokens": row["total_tokens"],
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "avg_latency_ms": round(to_float(row["avg_latency_ms"]) or 0)
                }
                for row in daily
            ],
            "hourly_pattern": [
                {
                    "hour": row["hour"],
                    "requests": row["requests"],
                    "successful": row["successful"],
                    "tokens": row["total_tokens"]
                }
                for row in hourly
            ]
        }
    except Exception as e:
        logger.error(f"Failed to fetch usage stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))
