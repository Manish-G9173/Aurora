"""Redis/Valkey cache with graceful in-memory fallback.

Zerops ships Valkey (Redis-compatible). When REDIS_URL is unreachable
(development without Redis), we fall back to a bounded in-memory dict
so the app keeps working.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections import OrderedDict
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger("aurora.cache")


class _MemoryCache:
    """Tiny LRU cache as a fallback when Redis is unavailable."""

    def __init__(self, maxsize: int = 1024):
        self._store: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self.maxsize = maxsize

    def get(self, key: str) -> Optional[str]:
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
                return self._store[key]
            return None

    async def set(self, key: str, value: str, ttl: int | None = None) -> None:
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self.maxsize:
                self._store.popitem(last=False)


class Cache:
    def __init__(self):
        self._redis = None
        self._memory = _MemoryCache()
        self._mode = "memory"
        self._connect_task = asyncio.create_task(self._connect()) if asyncio.get_event_loop().is_running() else None

    async def _connect(self):
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            await r.ping()
            self._redis = r
            self._mode = "redis"
            logger.info("cache connected to redis")
        except Exception as exc:  # noqa: BLE001
            logger.warning("redis unavailable (%s), using memory cache", exc)

    async def ensure(self):
        if self._redis is None and self._mode == "memory":
            await self._connect()

    async def get(self, key: str) -> Optional[Any]:
        await self.ensure()
        if self._redis is not None:
            raw = await self._redis.get(key)
            if raw is not None:
                return raw
        return self._memory.get(key)

    async def set(self, key: str, value: Any, ttl: int = 600) -> None:
        await self.ensure()
        text = json.dumps(value) if not isinstance(value, str) else value
        if self._redis is not None:
            await self._redis.set(key, text, ex=ttl)
        await self._memory.set(key, text)


cache = Cache()
