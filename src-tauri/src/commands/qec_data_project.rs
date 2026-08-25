use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::sync::Arc;

use super::qec_data::QecDataError;

#[cfg(unix)]
const PROJECT_DEVICE_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_DEVICE";
#[cfg(unix)]
const PROJECT_INODE_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_INODE";
#[cfg(windows)]
const PROJECT_VOLUME_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_VOLUME";
#[cfg(windows)]
const PROJECT_FILE_INDEX_ENV: &str = "NUCLEI_QEC_DATA_PROJECT_FILE_INDEX";

#[derive(Clone, Debug)]
pub struct AuthorizedProjectRoot {
    path: PathBuf,
    identity: ProjectFileIdentity,
    lock: ProjectDirectoryLock,
}

#[cfg(unix)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity {
    volume: u32,
    file_index: u64,
}

#[cfg(not(any(unix, windows)))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectFileIdentity;

#[derive(Clone, Debug)]
struct ProjectDirectoryLock {
    #[cfg(windows)]
    file: Arc<fs::File>,
}

impl AuthorizedProjectRoot {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn verify(&self) -> Result<PathBuf, QecDataError> {
        verify_project_identity(&self.path, &self.lock, self.identity)?;
        Ok(self.path.clone())
    }

    pub fn configure_child(&self, command: &mut Command) -> Result<(), QecDataError> {
        self.verify()?;
        configure_identity_environment(command, self.identity);
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
    let lock = project_lock(&project_root)?;
    let metadata = locked_metadata(&lock, &project_root)?;
    if !valid_project_metadata(&metadata) {
        return Err(invalid_project());
    }
    Ok(AuthorizedProjectRoot {
        path: project_root,
        identity: locked_identity(&lock, &metadata)?,
        lock,
    })
}

fn canonical_project(path: &Path) -> Result<PathBuf, QecDataError> {
    let canonical = path.canonicalize().map_err(|_| invalid_project())?;
    if !canonical.is_dir() {
        return Err(invalid_project());
    }
    Ok(canonical)
}

#[cfg(windows)]
fn valid_project_metadata(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.is_dir() && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
}

#[cfg(not(windows))]
fn valid_project_metadata(metadata: &fs::Metadata) -> bool {
    metadata.is_dir()
}

#[cfg(unix)]
fn project_identity(metadata: &fs::Metadata) -> Result<ProjectFileIdentity, QecDataError> {
    use std::os::unix::fs::MetadataExt;
    Ok(ProjectFileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(any(unix, windows)))]
fn project_identity(_metadata: &fs::Metadata) -> Result<ProjectFileIdentity, QecDataError> {
    Err(invalid_project())
}

#[cfg(unix)]
fn project_lock(_path: &Path) -> Result<ProjectDirectoryLock, QecDataError> {
    Ok(ProjectDirectoryLock {})
}

#[cfg(windows)]
fn project_lock(path: &Path) -> Result<ProjectDirectoryLock, QecDataError> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x02000000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
    let file = fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| invalid_project())?;
    Ok(ProjectDirectoryLock {
        file: Arc::new(file),
    })
}

#[cfg(not(any(unix, windows)))]
fn project_lock(_path: &Path) -> Result<ProjectDirectoryLock, QecDataError> {
    Err(invalid_project())
}

#[cfg(windows)]
fn locked_metadata(
    lock: &ProjectDirectoryLock,
    _path: &Path,
) -> Result<fs::Metadata, QecDataError> {
    lock.file.metadata().map_err(|_| identity_changed())
}

#[cfg(unix)]
fn locked_identity(
    _lock: &ProjectDirectoryLock,
    metadata: &fs::Metadata,
) -> Result<ProjectFileIdentity, QecDataError> {
    project_identity(metadata)
}

#[cfg(windows)]
fn locked_identity(
    lock: &ProjectDirectoryLock,
    _metadata: &fs::Metadata,
) -> Result<ProjectFileIdentity, QecDataError> {
    windows_handle_identity(&lock.file)
}

#[cfg(not(any(unix, windows)))]
fn locked_identity(
    _lock: &ProjectDirectoryLock,
    _metadata: &fs::Metadata,
) -> Result<ProjectFileIdentity, QecDataError> {
    Err(invalid_project())
}

#[cfg(unix)]
fn verify_project_identity(
    path: &Path,
    _lock: &ProjectDirectoryLock,
    identity: ProjectFileIdentity,
) -> Result<(), QecDataError> {
    let metadata = fs::metadata(path).map_err(|_| identity_changed())?;
    if !valid_project_metadata(&metadata) || project_identity(&metadata)? != identity {
        return Err(identity_changed());
    }
    Ok(())
}

#[cfg(windows)]
fn verify_project_identity(
    path: &Path,
    lock: &ProjectDirectoryLock,
    identity: ProjectFileIdentity,
) -> Result<(), QecDataError> {
    let current = project_lock(path).map_err(|_| identity_changed())?;
    let current_metadata = locked_metadata(&current, path)?;
    let retained_metadata = locked_metadata(lock, path)?;
    let valid = valid_project_metadata(&current_metadata)
        && valid_project_metadata(&retained_metadata)
        && windows_handle_identity(&current.file)? == identity
        && windows_handle_identity(&lock.file)? == identity;
    if !valid {
        return Err(identity_changed());
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn verify_project_identity(
    _path: &Path,
    _lock: &ProjectDirectoryLock,
    _identity: ProjectFileIdentity,
) -> Result<(), QecDataError> {
    Err(identity_changed())
}

#[cfg(windows)]
#[repr(C)]
struct ByHandleFileInformation {
    file_attributes: u32,
    creation_time_low: u32,
    creation_time_high: u32,
    access_time_low: u32,
    access_time_high: u32,
    write_time_low: u32,
    write_time_high: u32,
    volume_serial_number: u32,
    file_size_high: u32,
    file_size_low: u32,
    number_of_links: u32,
    file_index_high: u32,
    file_index_low: u32,
}

#[cfg(windows)]
fn windows_handle_identity(file: &fs::File) -> Result<ProjectFileIdentity, QecDataError> {
    use std::mem::MaybeUninit;
    use std::os::windows::io::AsRawHandle;

    extern "system" {
        fn GetFileInformationByHandle(
            file: *mut std::ffi::c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;
    }
    let mut information = MaybeUninit::<ByHandleFileInformation>::uninit();
    let success =
        unsafe { GetFileInformationByHandle(file.as_raw_handle(), information.as_mut_ptr()) };
    if success == 0 {
        return Err(identity_changed());
    }
    let information = unsafe { information.assume_init() };
    Ok(ProjectFileIdentity {
        volume: information.volume_serial_number,
        file_index: (u64::from(information.file_index_high) << 32)
            | u64::from(information.file_index_low),
    })
}

#[cfg(not(windows))]
fn locked_metadata(
    _lock: &ProjectDirectoryLock,
    path: &Path,
) -> Result<fs::Metadata, QecDataError> {
    fs::metadata(path).map_err(|_| identity_changed())
}

#[cfg(unix)]
fn configure_identity_environment(command: &mut Command, identity: ProjectFileIdentity) {
    command
        .env(PROJECT_DEVICE_ENV, identity.device.to_string())
        .env(PROJECT_INODE_ENV, identity.inode.to_string());
}

#[cfg(windows)]
fn configure_identity_environment(command: &mut Command, identity: ProjectFileIdentity) {
    command
        .env(PROJECT_VOLUME_ENV, identity.volume.to_string())
        .env(PROJECT_FILE_INDEX_ENV, identity.file_index.to_string());
}

#[cfg(not(any(unix, windows)))]
fn configure_identity_environment(_command: &mut Command, _identity: ProjectFileIdentity) {}

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

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn retained_project_handle_blocks_namespace_rename() {
        let root = TempDir::new().expect("project root");
        let project = authorized_project(root.path().to_path_buf()).expect("project lock");
        let moved = root.path().with_extension("moved");

        assert!(fs::rename(root.path(), &moved).is_err());
        drop(project);
        fs::rename(root.path(), &moved).expect("rename after releasing lock");
        fs::rename(moved, root.path()).expect("restore tempdir");
    }
}
