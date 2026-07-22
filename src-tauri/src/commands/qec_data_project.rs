use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::qec_data::QecDataError;

const PROJECT_DEVICE_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_DEVICE";
const PROJECT_INODE_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_INODE";

#[derive(Clone, Debug)]
pub struct AuthorizedProjectRoot {
    path: PathBuf,
    identity: ProjectFileIdentity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity {
    device: u64,
    inode: u64,
}

impl AuthorizedProjectRoot {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn verify(&self) -> Result<PathBuf, QecDataError> {
        let metadata = fs::metadata(&self.path).map_err(|_| identity_changed())?;
        if !metadata.is_dir() || project_identity(&metadata)? != self.identity {
            return Err(identity_changed());
        }
        Ok(self.path.clone())
    }

    pub fn configure_child(&self, command: &mut Command) -> Result<(), QecDataError> {
        self.verify()?;
        command
            .env(PROJECT_DEVICE_ENV, self.identity.device.to_string())
            .env(PROJECT_INODE_ENV, self.identity.inode.to_string());
        Ok(())
    }
}

pub fn authorize_project_access(
    project_root: &Path,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<AuthorizedProjectRoot, QecDataError> {
    let project_root = canonical_project(project_root)?;
    let qec_data = project_root.join("qec-data");
    let authorized = [
        project_root.to_path_buf(),
        qec_data.clone(),
        qec_data.join("sessions"),
        qec_data.join("sources"),
    ]
    .iter()
    .all(|path| is_allowed(path));
    if !authorized {
        return Err(QecDataError::new(
            "project_not_authorized",
            "The selected project is not authorized for QEC Data Engine access.",
        ));
    }
    authorized_project(project_root)
}

pub fn authorized_project(project_root: PathBuf) -> Result<AuthorizedProjectRoot, QecDataError> {
    let metadata = fs::metadata(&project_root).map_err(|_| invalid_project())?;
    Ok(AuthorizedProjectRoot {
        path: project_root,
        identity: project_identity(&metadata)?,
    })
}

fn canonical_project(path: &Path) -> Result<PathBuf, QecDataError> {
    let canonical = path.canonicalize().map_err(|_| invalid_project())?;
    if !canonical.is_dir() {
        return Err(invalid_project());
    }
    Ok(canonical)
}

#[cfg(unix)]
fn project_identity(metadata: &fs::Metadata) -> Result<ProjectFileIdentity, QecDataError> {
    use std::os::unix::fs::MetadataExt;
    Ok(ProjectFileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn project_identity(_metadata: &fs::Metadata) -> Result<ProjectFileIdentity, QecDataError> {
    Err(QecDataError::new(
        "project_identity_unavailable",
        "Secure project identity is unavailable on this platform.",
    ))
}

fn identity_changed() -> QecDataError {
    QecDataError::new(
        "project_identity_changed",
        "Authorized project identity changed before the QEC Data Engine started.",
    )
}

fn invalid_project() -> QecDataError {
    QecDataError::new(
        "invalid_project_root",
        "Authorized project identity is unavailable.",
    )
}
