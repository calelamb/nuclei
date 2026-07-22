use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use serde::Serialize;
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use tauri::WebviewWindow;
use tauri_plugin_fs::FsExt;

const STUDIES_DIRECTORY: &str = "studies";
const YAML_SUFFIX: &str = ".qec-study.yaml";
const YML_SUFFIX: &str = ".qec-study.yml";

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QecStudyCreateResult {
    Created,
    Exists,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QecStudyManifestFile {
    file_name: String,
    content: Option<String>,
    error: Option<String>,
}

fn validate_file_name(file_name: &str) -> Result<(), String> {
    let id = file_name
        .strip_suffix(YAML_SUFFIX)
        .or_else(|| file_name.strip_suffix(YML_SUFFIX))
        .ok_or_else(|| "Study manifests must use the .qec-study.yaml suffix.".to_string())?;
    let valid = id.chars().enumerate().all(|(index, character)| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || (index > 0 && character == '-')
    });
    if id.is_empty() || !valid {
        return Err("Study manifest names must contain a lowercase Study id only.".to_string());
    }
    Ok(())
}

fn authorize_project_access(
    project_root: &Path,
    file_name: Option<&str>,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<(), String> {
    let studies = project_root.join(STUDIES_DIRECTORY);
    let manifest = file_name.map(|name| studies.join(name));
    let manifest_is_allowed = match manifest.as_deref() {
        Some(path) => is_allowed(path),
        None => true,
    };
    let authorized = is_allowed(project_root) && is_allowed(&studies) && manifest_is_allowed;
    if authorized {
        Ok(())
    } else {
        Err("The selected project is not authorized for QEC Study access.".to_string())
    }
}

fn open_studies_directory(project: &Dir) -> Result<Dir, String> {
    match project.create_dir(STUDIES_DIRECTORY) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("Could not create the Studies folder: {error}")),
    }
    project
        .open_dir_nofollow(STUDIES_DIRECTORY)
        .map_err(|error| format!("Could not securely open the Studies folder: {error}"))
}

fn write_new_manifest(
    studies: &Dir,
    file_name: &str,
    content: &str,
) -> Result<QecStudyCreateResult, String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = match studies.open_with(file_name, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            return Ok(QecStudyCreateResult::Exists);
        }
        Err(error) => return Err(format!("Could not create the Study manifest: {error}")),
    };
    if let Err(error) = file
        .write_all(content.as_bytes())
        .and_then(|()| file.sync_all())
    {
        drop(file);
        let _ = studies.remove_file(file_name);
        return Err(format!("Could not write the Study manifest: {error}"));
    }
    Ok(QecStudyCreateResult::Created)
}

fn create_study_manifest_file(
    project_root: &Path,
    file_name: &str,
    content: &str,
) -> Result<QecStudyCreateResult, String> {
    validate_file_name(file_name)?;
    let project = Dir::open_ambient_dir(project_root, ambient_authority())
        .map_err(|error| format!("Could not securely open the project: {error}"))?;
    let studies = open_studies_directory(&project)?;
    write_new_manifest(&studies, file_name, content)
}

fn read_manifest_entry(
    entry: cap_std::fs::DirEntry,
) -> Result<Option<QecStudyManifestFile>, String> {
    let file_name = entry.file_name().to_string_lossy().to_string();
    if !file_name.ends_with(YAML_SUFFIX) && !file_name.ends_with(YML_SUFFIX) {
        return Ok(None);
    }
    let file_type = entry
        .file_type()
        .map_err(|error| format!("Could not inspect {file_name}: {error}"))?;
    if file_type.is_dir() {
        return Ok(None);
    }
    if file_type.is_symlink() {
        return Ok(Some(QecStudyManifestFile {
            file_name,
            content: None,
            error: Some("Study manifests cannot be symbolic links.".to_string()),
        }));
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = match entry.open_with(&options) {
        Ok(file) => file,
        Err(error) => {
            return Ok(Some(QecStudyManifestFile {
                file_name,
                content: None,
                error: Some(format!("Could not securely open this Study: {error}")),
            }));
        }
    };
    let mut content = String::new();
    let error = file
        .read_to_string(&mut content)
        .err()
        .map(|error| format!("Could not read this Study: {error}"));
    Ok(Some(QecStudyManifestFile {
        file_name,
        content: error.is_none().then_some(content),
        error,
    }))
}

fn read_study_manifest_files(project_root: &Path) -> Result<Vec<QecStudyManifestFile>, String> {
    let project = Dir::open_ambient_dir(project_root, ambient_authority())
        .map_err(|error| format!("Could not securely open the project: {error}"))?;
    let studies = match project.open_dir_nofollow(STUDIES_DIRECTORY) {
        Ok(directory) => directory,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "Could not securely open the Studies folder: {error}"
            ))
        }
    };
    studies
        .entries()
        .map_err(|error| format!("Could not read the Studies folder: {error}"))?
        .map(|entry| {
            entry
                .map_err(|error| format!("Could not inspect a Study entry: {error}"))
                .and_then(read_manifest_entry)
        })
        .filter_map(Result::transpose)
        .collect()
}

#[tauri::command]
pub fn qec_create_study_manifest(
    window: WebviewWindow,
    project_root: String,
    file_name: String,
    content: String,
) -> Result<QecStudyCreateResult, String> {
    validate_file_name(&file_name)?;
    let scope = window.fs_scope();
    authorize_project_access(Path::new(&project_root), Some(&file_name), |path| {
        scope.is_allowed(path)
    })?;
    create_study_manifest_file(Path::new(&project_root), &file_name, &content)
}

#[tauri::command]
pub fn qec_read_study_manifests(
    window: WebviewWindow,
    project_root: String,
) -> Result<Vec<QecStudyManifestFile>, String> {
    let scope = window.fs_scope();
    authorize_project_access(Path::new(&project_root), None, |path| {
        scope.is_allowed(path)
    })?;
    read_study_manifest_files(Path::new(&project_root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_once_inside_the_project() {
        let project = tempdir().expect("project tempdir");

        let first =
            create_study_manifest_file(project.path(), "decoder.qec-study.yaml", "schema: 1\n");
        let second =
            create_study_manifest_file(project.path(), "decoder.qec-study.yaml", "replacement\n");

        assert_eq!(first.expect("first create"), QecStudyCreateResult::Created);
        assert_eq!(
            second.expect("exclusive collision"),
            QecStudyCreateResult::Exists
        );
        assert_eq!(
            fs::read_to_string(project.path().join("studies/decoder.qec-study.yaml"))
                .expect("created manifest"),
            "schema: 1\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_studies_symlink_without_writing_to_its_target() {
        use std::os::unix::fs::symlink;

        let project = tempdir().expect("project tempdir");
        let outside = tempdir().expect("outside tempdir");
        symlink(outside.path(), project.path().join("studies")).expect("studies symlink");

        let result =
            create_study_manifest_file(project.path(), "escaped.qec-study.yaml", "schema: 1\n");

        assert!(result.is_err());
        assert!(!outside.path().join("escaped.qec-study.yaml").exists());
    }

    #[test]
    fn rejects_non_manifest_file_names() {
        let project = tempdir().expect("project tempdir");
        let result = create_study_manifest_file(project.path(), "../escaped.yaml", "bad");

        assert!(result.is_err());
        assert!(!project.path().join("escaped.yaml").exists());
    }

    #[test]
    fn rejects_a_project_outside_the_invoking_window_scope() {
        let allowed = Path::new("/allowed/project");
        let requested = Path::new("/outside/project");

        let result = authorize_project_access(requested, Some("new.qec-study.yaml"), |path| {
            path.starts_with(allowed)
        });

        assert!(result.is_err());
    }

    #[test]
    fn authorizes_a_manifest_inside_the_invoking_window_scope() {
        let allowed = Path::new("/allowed/project");

        let result = authorize_project_access(allowed, Some("new.qec-study.yaml"), |path| {
            path.starts_with(allowed)
        });

        assert!(result.is_ok());
    }

    #[test]
    fn reads_only_direct_manifest_files_from_the_project_handle() {
        let project = tempdir().expect("project tempdir");
        fs::create_dir(project.path().join("studies")).expect("studies directory");
        fs::write(
            project.path().join("studies/good.qec-study.yaml"),
            "schema: 1\n",
        )
        .expect("manifest");
        fs::write(project.path().join("studies/notes.txt"), "ignore").expect("notes");

        let files = read_study_manifest_files(project.path()).expect("secure discovery");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_name, "good.qec-study.yaml");
        assert_eq!(files[0].content.as_deref(), Some("schema: 1\n"));
        assert!(files[0].error.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn quarantines_a_manifest_symlink_without_reading_its_target() {
        use std::os::unix::fs::symlink;

        let project = tempdir().expect("project tempdir");
        let outside = tempdir().expect("outside tempdir");
        fs::create_dir(project.path().join("studies")).expect("studies directory");
        fs::write(outside.path().join("secret"), "outside secret").expect("secret");
        symlink(
            outside.path().join("secret"),
            project.path().join("studies/linked.qec-study.yaml"),
        )
        .expect("manifest symlink");

        let files = read_study_manifest_files(project.path()).expect("secure discovery");

        assert_eq!(files.len(), 1);
        assert!(files[0].content.is_none());
        assert!(files[0]
            .error
            .as_deref()
            .is_some_and(|message| message.contains("symbolic link")));
    }
}
