"""Windows Job Object for a run worker (design note section 2.7). Untested outside Windows CI.

POSIX kills a worker's whole process group; Windows has no process groups, so each worker (and every
child it starts) lives in a Job Object created with ``KILL_ON_JOB_CLOSE`` and a job-wide memory
ceiling.  ``ready.memory_ceiling`` reports ``"unavailable"`` when the Job cannot be created, and the
pool then enforces the wall clock only.
"""

from __future__ import annotations

import sys

JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
PROCESS_SET_QUOTA = 0x0100
PROCESS_TERMINATE = 0x0001


class WindowsJob:
    """A Job Object holding one worker; ``terminate()`` kills the worker and all its children."""

    def __init__(self, handle: int):
        self._handle = handle

    @classmethod
    def assign(cls, pid: int, memory_limit_bytes: int | None) -> "WindowsJob | None":
        if sys.platform != "win32":
            return None
        try:
            return cls._create(pid, memory_limit_bytes)
        except (OSError, AttributeError):
            return None

    @classmethod
    def _create(cls, pid: int, memory_limit_bytes: int | None) -> "WindowsJob | None":  # pragma: no cover - Windows only
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]

        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IoCounters),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None
        info = Extended()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if memory_limit_bytes:
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY
            info.JobMemoryLimit = memory_limit_bytes
        if not kernel32.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, ctypes.byref(info), ctypes.sizeof(info)):
            kernel32.CloseHandle(job)
            return None
        process = kernel32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, False, pid)
        ok = bool(process) and kernel32.AssignProcessToJobObject(job, process)
        if process:
            kernel32.CloseHandle(process)
        if not ok:
            kernel32.CloseHandle(job)
            return None
        return cls(job)

    def terminate(self) -> None:  # pragma: no cover - Windows only
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        kernel32.TerminateJobObject(self._handle, 1)
        kernel32.CloseHandle(self._handle)
