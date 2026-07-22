"""Start the real QEC Data Engine for Playwright with Tauri-equivalent identity env."""

from __future__ import annotations

import os
from pathlib import Path

from kernel.qec_data.server_entrypoint import (
    PROJECT_ENVIRONMENT_VARIABLE,
    main,
)
from kernel.qec_data.source_security import (
    PROJECT_DEVICE_ENVIRONMENT_VARIABLE,
    PROJECT_FILE_INDEX_ENVIRONMENT_VARIABLE,
    PROJECT_INODE_ENVIRONMENT_VARIABLE,
    PROJECT_VOLUME_ENVIRONMENT_VARIABLE,
)


def _install_project_identity(project_root: Path) -> None:
    if os.name == "nt":
        from kernel.qec_data.source_security_windows import _open_directory

        capability = _open_directory(project_root)
        try:
            volume, file_index = capability.identity
        finally:
            capability.close()
        os.environ[PROJECT_VOLUME_ENVIRONMENT_VARIABLE] = str(volume)
        os.environ[PROJECT_FILE_INDEX_ENVIRONMENT_VARIABLE] = str(file_index)
        return
    identity = project_root.stat()
    os.environ[PROJECT_DEVICE_ENVIRONMENT_VARIABLE] = str(identity.st_dev)
    os.environ[PROJECT_INODE_ENVIRONMENT_VARIABLE] = str(identity.st_ino)


if __name__ == "__main__":
    project = Path(os.environ[PROJECT_ENVIRONMENT_VARIABLE]).resolve(strict=True)
    _install_project_identity(project)
    raise SystemExit(main())
