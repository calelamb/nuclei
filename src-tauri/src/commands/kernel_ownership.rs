//! Ownership bookkeeping for the kernel child process.
//!
//! Nuclei records the PID and port of the kernel it spawns. On the next
//! launch it may reap a leftover kernel it started itself (e.g. after a crash
//! of the desktop app), but it never kills a process merely because that
//! process happens to hold the kernel port.

use std::fs;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const OWNER_FILE_NAME: &str = "kernel-owner.json";
const RUNTIME_DIR_ENV: &str = "NUCLEI_RUNTIME_DIR";
const PORT_PROBE_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OwnerRecord {
    pub pid: u32,
    pub port: u16,
}

/// Per-user runtime directory shared with the kernel's own runtime file.
pub fn runtime_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(RUNTIME_DIR_ENV) {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".nuclei").join("runtime"))
}

fn owner_path(dir: &Path) -> PathBuf {
    dir.join(OWNER_FILE_NAME)
}

pub fn parse_owner_record(text: &str) -> Option<OwnerRecord> {
    serde_json::from_str(text).ok()
}

pub fn read_owner_record(dir: &Path) -> Option<OwnerRecord> {
    parse_owner_record(&fs::read_to_string(owner_path(dir)).ok()?)
}

pub fn write_owner_record(dir: &Path, record: &OwnerRecord) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    let body = serde_json::to_string(record).map_err(io::Error::other)?;
    let path = owner_path(dir);
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(temp, path)
}

pub fn remove_owner_record(dir: &Path) {
    let _ = fs::remove_file(owner_path(dir));
}

/// True when a command line looks like `<python> .../kernel/server.py`.
pub fn is_nuclei_kernel_command(command_line: &str) -> bool {
    let normalized = command_line.replace('\\', "/");
    normalized.contains("/kernel/server.py")
}

/// Decide which PID (if any) is a stale kernel that Nuclei itself started.
///
/// A process is only eligible when ALL hold: a record exists for this port,
/// it is not this process, and its live command line is still the Nuclei
/// kernel script (guards against PID reuse by an unrelated program).
pub fn stale_kernel_to_kill(
    record: Option<&OwnerRecord>,
    port: u16,
    own_pid: u32,
    command_line_of: impl FnOnce(u32) -> Option<String>,
) -> Option<u32> {
    let record = record?;
    if record.port != port || record.pid == own_pid || record.pid == 0 {
        return None;
    }
    let command_line = command_line_of(record.pid)?;
    is_nuclei_kernel_command(&command_line).then_some(record.pid)
}

pub fn process_command_line(pid: u32) -> Option<String> {
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-CimInstance Win32_Process -Filter 'ProcessId={}').CommandLine",
                pid
            ),
        ])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !text.is_empty()).then_some(text)
}

pub fn terminate_process(pid: u32) {
    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    #[cfg(target_os = "windows")]
    let _ = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .status();
}

pub fn port_in_use(port: u16) -> bool {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&address, PORT_PROBE_TIMEOUT).is_ok()
}

/// Reap a leftover kernel recorded by a previous Nuclei run, if still ours.
pub fn reap_recorded_kernel(dir: Option<&Path>, port: u16) {
    let Some(dir) = dir else { return };
    let record = read_owner_record(dir);
    if let Some(pid) =
        stale_kernel_to_kill(record.as_ref(), port, std::process::id(), process_command_line)
    {
        terminate_process(pid);
    }
    remove_owner_record(dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    const KERNEL_CMD: &str = "/venv/bin/python /Apps/Nuclei/kernel/server.py";

    fn record(pid: u32, port: u16) -> OwnerRecord {
        OwnerRecord { pid, port }
    }

    #[test]
    fn kills_only_a_recorded_live_nuclei_kernel() {
        let rec = record(4242, 9742);
        let got = stale_kernel_to_kill(Some(&rec), 9742, 1, |_| Some(KERNEL_CMD.to_string()));
        assert_eq!(got, Some(4242));
    }

    #[test]
    fn never_kills_without_a_record() {
        let got = stale_kernel_to_kill(None, 9742, 1, |_| Some(KERNEL_CMD.to_string()));
        assert_eq!(got, None);
    }

    #[test]
    fn never_kills_a_foreign_process_even_if_recorded_pid_was_reused() {
        let rec = record(4242, 9742);
        let got = stale_kernel_to_kill(Some(&rec), 9742, 1, |_| {
            Some("/usr/bin/node /home/me/app/server.js".to_string())
        });
        assert_eq!(got, None);
    }

    #[test]
    fn never_kills_a_dead_process() {
        let rec = record(4242, 9742);
        assert_eq!(stale_kernel_to_kill(Some(&rec), 9742, 1, |_| None), None);
    }

    #[test]
    fn ignores_records_for_other_ports_and_self() {
        let cmd = |_| Some(KERNEL_CMD.to_string());
        assert_eq!(stale_kernel_to_kill(Some(&record(7, 9999)), 9742, 1, cmd), None);
        assert_eq!(stale_kernel_to_kill(Some(&record(1, 9742)), 9742, 1, cmd), None);
        assert_eq!(stale_kernel_to_kill(Some(&record(0, 9742)), 9742, 1, cmd), None);
    }

    #[test]
    fn recognizes_windows_style_kernel_command_lines() {
        assert!(is_nuclei_kernel_command(
            "C:\\venv\\Scripts\\python.exe C:\\Nuclei\\resources\\kernel\\server.py"
        ));
        assert!(!is_nuclei_kernel_command("python other/server.py"));
    }

    #[test]
    fn owner_record_roundtrips_and_rejects_garbage() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_owner_record(dir.path()), None);
        write_owner_record(dir.path(), &record(55, 9742)).unwrap();
        assert_eq!(read_owner_record(dir.path()), Some(record(55, 9742)));
        assert_eq!(parse_owner_record("not json"), None);
        remove_owner_record(dir.path());
        assert_eq!(read_owner_record(dir.path()), None);
    }

    #[cfg(unix)]
    #[test]
    fn owner_record_is_user_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("runtime");
        write_owner_record(&sub, &record(55, 9742)).unwrap();
        let file_mode = fs::metadata(owner_path(&sub)).unwrap().permissions().mode() & 0o777;
        let dir_mode = fs::metadata(&sub).unwrap().permissions().mode() & 0o777;
        assert_eq!((file_mode, dir_mode), (0o600, 0o700));
    }

    #[test]
    fn reap_with_no_record_leaves_foreign_listener_alone() {
        let dir = tempfile::tempdir().unwrap();
        // No record: nothing to do, and no panic even though the port may be busy.
        reap_recorded_kernel(Some(dir.path()), 9742);
        assert_eq!(read_owner_record(dir.path()), None);
    }
}
