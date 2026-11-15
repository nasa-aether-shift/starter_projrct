"""Simple in-memory rate limit: at most `limit` requests per `window` seconds per (endpoint, client IP).

One process only (the demo runs one API worker); counts reset on restart. Behind a proxy, start uvicorn with
--proxy-headers so the client IP is the visitor's, not the proxy's.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Callable


class RateLimiter:
    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, endpoint: str, client: str) -> int | None:
        """Record a request; return None if allowed, else the whole seconds to wait before retrying."""
        now = self.clock()
        with self._lock:
            hits = self._hits.setdefault((endpoint, client), deque())
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(1, math.ceil(hits[0] + self.window - now))
            hits.append(now)
            if len(self._hits) > 10_000:  # forget idle clients so memory stays bounded
                self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > now - self.window}
            return None
