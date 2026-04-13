from dataclasses import dataclass, asdict


@dataclass
class KernelError:
    code: str
    message: str
    traceback: str | None = None
    framework: str | None = None
    dependency: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)
