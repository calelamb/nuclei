"""Per-connection asynchronous job ownership and cancellation."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Hashable
from dataclasses import dataclass

from .protocol import ProtocolError


JobFactory = Callable[[], Awaitable[None]]
CancelCallback = Callable[[], None]


@dataclass(frozen=True, slots=True)
class _Job:
    owner: Hashable
    job_id: str
    task: asyncio.Task[None]
    cancel_callback: CancelCallback | None


class JobRegistry:
    """Track bounded jobs; only the creating connection may cancel them."""

    def __init__(self, *, max_jobs_per_owner: int = 8) -> None:
        if type(max_jobs_per_owner) is not int or max_jobs_per_owner < 1:
            raise ValueError("max_jobs_per_owner must be positive")
        self._maximum = max_jobs_per_owner
        self._jobs: dict[tuple[Hashable, str], _Job] = {}

    def start(
        self,
        owner: Hashable,
        job_id: str,
        factory: JobFactory,
        *,
        cancel_callback: CancelCallback | None = None,
    ) -> asyncio.Task[None]:
        key = (owner, job_id)
        if key in self._jobs:
            raise ProtocolError("job_already_active", "Job ID is already active.")
        if self.active_count(owner) >= self._maximum:
            raise ProtocolError("job_limit_exceeded", "Connection job limit exceeded.")
        task = asyncio.create_task(factory(), name=f"qec-data:{job_id}")
        job = _Job(owner, job_id, task, cancel_callback)
        self._jobs[key] = job
        task.add_done_callback(lambda completed: self._remove(key, completed))
        return task

    def cancel(self, owner: Hashable, job_id: str) -> bool:
        job = self._jobs.get((owner, job_id))
        if job is None:
            return False
        if job.cancel_callback is not None:
            job.cancel_callback()
        job.task.cancel()
        return True

    def cancel_owner(self, owner: Hashable) -> int:
        owned = tuple(job for job in self._jobs.values() if job.owner == owner)
        for job in owned:
            if job.cancel_callback is not None:
                job.cancel_callback()
            job.task.cancel()
        return len(owned)

    async def wait_owner(self, owner: Hashable) -> None:
        owned = tuple(job for job in self._jobs.values() if job.owner == owner)
        tasks = tuple(job.task for job in owned)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for job in owned:
            self._remove((job.owner, job.job_id), job.task)

    def active_count(self, owner: Hashable) -> int:
        return sum(job.owner == owner for job in self._jobs.values())

    def _remove(self, key: tuple[Hashable, str], completed: asyncio.Task[None]) -> None:
        current = self._jobs.get(key)
        if current is not None and current.task is completed:
            del self._jobs[key]
