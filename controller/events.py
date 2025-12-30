"""Server-Sent Events manager for real-time updates.

This module provides a centralized event manager for broadcasting
real-time updates to connected clients via SSE.
"""

import asyncio
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


@dataclass
class Event:
    """SSE Event with type, data, and timestamp."""

    type: str
    data: Dict[str, Any]
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    id: str = field(default_factory=lambda: str(int(datetime.utcnow().timestamp() * 1000)))

    def to_sse(self) -> str:
        """Convert to SSE wire format.

        SSE format:
        id: <event_id>
        event: <event_type>
        data: <json_payload>

        (blank line to delimit event)
        """
        payload = {"data": self.data, "timestamp": self.timestamp}
        lines = [f"id: {self.id}", f"event: {self.type}", f"data: {json.dumps(payload)}", "", ""]
        return "\n".join(lines)


class EventManager:
    """Manages SSE connections and broadcasts events to subscribers.

    Supports multiple channels for targeted broadcasting.
    Thread-safe for async operations.
    """

    def __init__(self):
        self._subscribers: Dict[str, Set[asyncio.Queue]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._event_count = 0

    async def subscribe(self, channel: str = "default") -> AsyncIterator[Event]:
        """Subscribe to events on a specific channel.

        Args:
            channel: Channel name to subscribe to (default: "default")

        Yields:
            Event objects as they're published to the channel
        """
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=100)

        async with self._lock:
            self._subscribers[channel].add(queue)
            logger.info(
                f"New subscriber to channel '{channel}' (total: {len(self._subscribers[channel])})"
            )

        try:
            while True:
                event = await queue.get()
                yield event
        except asyncio.CancelledError:
            logger.debug(f"Subscriber cancelled on channel '{channel}'")
        except Exception as e:
            logger.error(f"Error in subscriber loop: {e}")
        finally:
            async with self._lock:
                self._subscribers[channel].discard(queue)
                logger.info(
                    f"Subscriber left channel '{channel}' (remaining: {len(self._subscribers[channel])})"
                )

    async def publish(self, event: Event, channel: str = "default"):
        """Publish event to all subscribers on a channel.

        Handles queue full errors gracefully by dropping events.

        Args:
            event: Event to publish
            channel: Channel to publish to (default: "default")
        """
        async with self._lock:
            subscribers = self._subscribers[channel]
            if not subscribers:
                return  # No subscribers, skip

            self._event_count += 1
            dead_queues = set()

            for queue in subscribers:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning(
                        f"Queue full for channel '{channel}', dropping event (type: {event.type})"
                    )
                    dead_queues.add(queue)
                except Exception as e:
                    logger.error(f"Error publishing to subscriber: {e}")
                    dead_queues.add(queue)

            # Clean up dead queues
            self._subscribers[channel] -= dead_queues

    async def publish_status(self, status_data: Dict[str, Any]):
        """Publish status update event."""
        await self.publish(Event(type="status", data=status_data))

    async def publish_gpu(self, gpu_data: List[Dict[str, Any]]):
        """Publish GPU metrics event."""
        await self.publish(Event(type="gpu", data={"gpus": gpu_data, "count": len(gpu_data)}))

    async def publish_metrics(self, metrics_data: Dict[str, Any]):
        """Publish vLLM performance metrics event."""
        await self.publish(Event(type="metrics", data=metrics_data))

    async def publish_log_line(self, session_id: str, line: str):
        """Publish individual log line to session-specific channel."""
        await self.publish(
            Event(type="log", data={"session_id": session_id, "line": line}),
            channel=f"logs:{session_id}",
        )

    async def publish_launch_progress(
        self, recipe_id: str, stage: str, message: str, progress: Optional[float] = None
    ):
        """Publish model launch progress event.

        Stages: evicting, launching, waiting, ready, error
        """
        data = {"recipe_id": recipe_id, "stage": stage, "message": message}
        if progress is not None:
            data["progress"] = progress

        await self.publish(Event(type="launch_progress", data=data))

    def get_stats(self) -> Dict[str, Any]:
        """Get event manager statistics."""
        return {
            "total_events_published": self._event_count,
            "channels": {channel: len(subs) for channel, subs in self._subscribers.items()},
            "total_subscribers": sum(len(subs) for subs in self._subscribers.values()),
        }


# Global singleton event manager
event_manager = EventManager()
