"""Short-lived, per-user, in-memory holding area for parsed datasets between preview and analysis.

Raw laboratory data is never written to disk: an entry disappears when it expires, when the user starts
another upload beyond their quota, or when the server restarts (the client then re-uploads the file).
"""

import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.models.base import utcnow
from app.services.labvision.parsing import ParsedDataset


@dataclass
class StoredDataset:
    id: str
    user_id: int
    name: str
    size_bytes: int
    sha256: str
    parsed: ParsedDataset
    created_at: datetime
    expires_at: datetime


class DatasetStore:
    def __init__(self, ttl_minutes: int, max_per_user: int):
        self.ttl = timedelta(minutes=ttl_minutes)
        self.max_per_user = max(1, max_per_user)
        self._items: dict[str, StoredDataset] = {}
        self._lock = threading.Lock()

    def put(self, user_id: int, name: str, size_bytes: int, sha256: str, parsed: ParsedDataset) -> StoredDataset:
        now = utcnow()
        entry = StoredDataset(
            id=secrets.token_urlsafe(18),
            user_id=user_id,
            name=name,
            size_bytes=size_bytes,
            sha256=sha256,
            parsed=parsed,
            created_at=now,
            expires_at=now + self.ttl,
        )
        with self._lock:
            self._purge_locked(now)
            own = sorted((d for d in self._items.values() if d.user_id == user_id), key=lambda d: d.created_at)
            for old in own[: max(0, len(own) - self.max_per_user + 1)]:
                del self._items[old.id]
            self._items[entry.id] = entry
        return entry

    def get(self, user_id: int, dataset_id: str) -> StoredDataset | None:
        """Another user's identifier behaves exactly like an unknown one."""
        with self._lock:
            self._purge_locked(utcnow())
            entry = self._items.get(dataset_id)
            return entry if entry is not None and entry.user_id == user_id else None

    def discard(self, user_id: int, dataset_id: str) -> bool:
        with self._lock:
            entry = self._items.get(dataset_id)
            if entry is None or entry.user_id != user_id:
                return False
            del self._items[dataset_id]
            return True

    def purge_expired(self) -> int:
        with self._lock:
            return self._purge_locked(utcnow())

    def _purge_locked(self, now: datetime) -> int:
        expired = [key for key, entry in self._items.items() if entry.expires_at <= now]
        for key in expired:
            del self._items[key]
        return len(expired)

    def __len__(self) -> int:
        return len(self._items)
