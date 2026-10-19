from dataclasses import dataclass, asdict


@dataclass
class KernelError:
    code: str
    message: str
    traceback: str | None = None
    framework: str | None = None
    dependency: str | None = None
    # PRD 15 R-B: structured detail for the new safety errors (``exit_code``, ``estimate``,
    # ``actions``, ``limit_s``, ``rss_bytes``, ...).  Merged into the top level of the wire error
    # and omitted entirely when empty, so every existing error keeps its exact shape.
    extra: dict | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        extra = data.pop("extra", None)
        if extra:
            data.update(extra)
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "KernelError":
        """Rebuild an error from its wire form (``to_dict``): unknown keys become ``extra``."""
        known = {"code", "message", "traceback", "framework", "dependency"}
        extra = {k: v for k, v in data.items() if k not in known and k != "extra"}
        extra.update(data.get("extra") or {})
        return cls(
            code=str(data.get("code", "error")), message=str(data.get("message", "")),
            traceback=data.get("traceback"), framework=data.get("framework"),
            dependency=data.get("dependency"), extra=extra or None,
        )
