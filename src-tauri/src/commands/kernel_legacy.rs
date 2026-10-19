//! Reaping of kernels that predate the owner record (Nuclei <= 0.14.0).
//!
//! 0.14.0 kernels outlive the app and never wrote `kernel-owner.json`, so on
//! the first launch of a newer build the canonical port is held by an
//! unauthenticated kernel that nothing recorded. When the port is busy and no
//! record explains it, the listener is identified from the OS socket table and
//! reaped only if it belongs to the current user AND its command line is the
//! Nuclei kernel script. Anything else keeps the port and is refused.

use std::process::Command;
use std::time::Duration;

use super::kernel_ownership::{
    is_nuclei_kernel_command, port_in_use, process_command_line, wait_until,
};

/// Grace between SIGTERM / graceful close and the forced kill.
const LEGACY_TERM_GRACE: Duration = Duration::from_millis(2000);
/// Time for the killed kernel to release the port.
const LEGACY_PORT_DEADLINE: Duration = Duration::from_secs(3);
const POLL: Duration = Duration::from_millis(50);

/// Parse `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` output: one PID per line.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub fn parse_lsof_pids(output: &str) -> Vec<u32> {
    let mut pids: Vec<u32> = output
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| *pid != 0)
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

/// Parse `netstat -ano` output for LISTENING sockets on exactly `port`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn parse_netstat_pids(output: &str, port: u16) -> Vec<u32> {
    let suffix = format!(":{port}");
    let mut pids: Vec<u32> = output
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 5 || !fields[0].eq_ignore_ascii_case("TCP") {
                return None;
            }
            if !fields[3].eq_ignore_ascii_case("LISTENING") || !fields[1].ends_with(&suffix) {
                return None;
            }
            fields[4].parse::<u32>().ok().filter(|pid| *pid != 0)
        })
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

/// True when the process owner equals the current user.
pub fn owned_by_current_user(owner: Option<&str>, current: Option<&str>) -> bool {
    match (owner, current) {
        (Some(owner), Some(current)) => {
            let (owner, current) = (owner.trim(), current.trim());
            !owner.is_empty() && owner.eq_ignore_ascii_case(current)
        }
        _ => false,
    }
}

/// Decide which listeners to reap. Returns the PIDs only when EVERY listener
/// is ours (current user, not this process, Nuclei kernel command line); if
/// any listener fails a check the answer is empty so nothing is killed.
pub fn legacy_listeners_to_kill(
    listeners: &[u32],
    own_pid: u32,
    current_user: Option<&str>,
    owner_of: impl Fn(u32) -> Option<String>,
    command_line_of: impl Fn(u32) -> Option<String>,
) -> Vec<u32> {
    if listeners.is_empty() {
        return Vec::new();
    }
    let all_ours = listeners.iter().all(|pid| {
        *pid != own_pid
            && owned_by_current_user(owner_of(*pid).as_deref(), current_user)
            && command_line_of(*pid).is_some_and(|cmd| is_nuclei_kernel_command(&cmd))
    });
    if all_ours {
        listeners.to_vec()
    } else {
        Vec::new()
    }
}

#[cfg(not(target_os = "windows"))]
fn listening_pids(port: u16) -> Vec<u32> {
    Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
        .map(|out| parse_lsof_pids(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn listening_pids(port: u16) -> Vec<u32> {
    Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .map(|out| parse_netstat_pids(&String::from_utf8_lossy(&out.stdout), port))
        .unwrap_or_default()
}

#[cfg(not(target_os = "windows"))]
fn current_user() -> Option<String> {
    let out = Command::new("id").arg("-u").output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn current_user() -> Option<String> {
    std::env::var("USERNAME").ok()
}

#[cfg(not(target_os = "windows"))]
fn process_owner(pid: u32) -> Option<String> {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "uid="])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

#[cfg(target_os = "windows")]
fn process_owner(pid: u32) -> Option<String> {
    let script = format!(
        "(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}' | \
         Invoke-CimMethod -MethodName GetOwner).User"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn request_exit(pid: u32) {
    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
    #[cfg(target_os = "windows")]
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status();
}

fn force_exit(pid: u32) {
    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .status();
    #[cfg(target_os = "windows")]
    let _ = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .status();
}

/// SIGTERM, wait `grace` for the process to go away, then SIGKILL.
fn terminate_with_grace(pid: u32, grace: Duration) {
    request_exit(pid);
    if wait_until(grace, POLL, || process_command_line(pid).is_none()) {
        return;
    }
    force_exit(pid);
    wait_until(grace, POLL, || process_command_line(pid).is_none());
}

/// Reap an unrecorded (pre-0.14.1) Nuclei kernel holding `port`. Returns the
/// PIDs that were terminated; empty when the port is free or the listener is
/// not a Nuclei kernel owned by this user (the caller then refuses).
pub fn reap_legacy_listener(port: u16) -> Vec<u32> {
    if !port_in_use(port) {
        return Vec::new();
    }
    let listeners = listening_pids(port);
    let victims = legacy_listeners_to_kill(
        &listeners,
        std::process::id(),
        current_user().as_deref(),
        process_owner,
        process_command_line,
    );
    for pid in &victims {
        log::warn!("Reaping legacy Nuclei kernel pid {pid} found on port {port}");
        terminate_with_grace(*pid, LEGACY_TERM_GRACE);
    }
    if !victims.is_empty() {
        wait_until(LEGACY_PORT_DEADLINE, POLL, || !port_in_use(port));
    }
    victims
}

#[cfg(test)]
mod tests {
    use super::*;

    const KERNEL_CMD: &str = "/venv/bin/python /Apps/Nuclei/kernel/server.py";

    #[test]
    fn parses_lsof_output_deduplicating_dual_stack_listeners() {
        assert_eq!(parse_lsof_pids("4242\n4242\n"), vec![4242]);
        assert_eq!(parse_lsof_pids("  17 \n9\n\nnoise\n0\n"), vec![9, 17]);
        assert!(parse_lsof_pids("").is_empty());
    }

    #[test]
    fn parses_netstat_listening_rows_for_the_exact_port() {
        let out = "\
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:9742         0.0.0.0:0              LISTENING       4242
  TCP    [::1]:9742             [::]:0                 LISTENING       4242
  TCP    127.0.0.1:19742        0.0.0.0:0              LISTENING       99
  TCP    127.0.0.1:50000        127.0.0.1:9742         ESTABLISHED     77
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       5
";
        assert_eq!(parse_netstat_pids(out, 9742), vec![4242]);
        assert!(parse_netstat_pids("garbage", 9742).is_empty());
    }

    #[test]
    fn ownership_requires_an_exact_known_match() {
        assert!(owned_by_current_user(Some("501"), Some("501\n")));
        assert!(!owned_by_current_user(Some("0"), Some("501")));
        assert!(!owned_by_current_user(None, Some("501")));
        assert!(!owned_by_current_user(Some("501"), None));
        assert!(!owned_by_current_user(Some(""), Some("")));
    }

    fn decide(listeners: &[u32], owner: &'static str, cmd: &'static str) -> Vec<u32> {
        legacy_listeners_to_kill(
            listeners,
            1,
            Some("501"),
            |_| Some(owner.to_string()),
            |_| Some(cmd.to_string()),
        )
    }

    #[test]
    fn reaps_a_same_user_nuclei_kernel() {
        assert_eq!(decide(&[4242], "501", KERNEL_CMD), vec![4242]);
    }

    #[test]
    fn refuses_a_foreign_application() {
        assert!(decide(&[4242], "501", "/usr/bin/node /app/server.js").is_empty());
    }

    #[test]
    fn refuses_another_users_kernel() {
        assert!(decide(&[4242], "0", KERNEL_CMD).is_empty());
    }

    #[test]
    fn refuses_itself_and_unknown_processes() {
        assert!(decide(&[1], "501", KERNEL_CMD).is_empty());
        let unknown = legacy_listeners_to_kill(&[4242], 1, Some("501"), |_| None, |_| None);
        assert!(unknown.is_empty());
        assert!(decide(&[], "501", KERNEL_CMD).is_empty());
    }

    #[test]
    fn kills_nothing_when_any_listener_is_foreign() {
        let got = legacy_listeners_to_kill(
            &[4242, 5000],
            1,
            Some("501"),
            |_| Some("501".to_string()),
            |pid| {
                Some(if pid == 4242 {
                    KERNEL_CMD.to_string()
                } else {
                    "/usr/bin/python3 -m http.server".to_string()
                })
            },
        );
        assert!(got.is_empty());
    }

    #[cfg(unix)]
    mod live {
        use super::super::*;
        use std::io::{BufRead, BufReader};
        use std::process::Stdio;

        fn spawn_fake_kernel(
            dir: &std::path::Path,
            script_dir: &str,
        ) -> (std::process::Child, u16) {
            let kernel_dir = dir.join(script_dir);
            std::fs::create_dir_all(&kernel_dir).unwrap();
            let script = kernel_dir.join("server.py");
            std::fs::write(
                &script,
                "import socket,sys,time\ns=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\n\
                 s.bind(('127.0.0.1',0));s.listen(5)\nprint(s.getsockname()[1],flush=True)\ntime.sleep(60)\n",
            )
            .unwrap();
            let mut child = Command::new("python3")
                .arg(&script)
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let mut line = String::new();
            BufReader::new(child.stdout.take().unwrap())
                .read_line(&mut line)
                .unwrap();
            (child, line.trim().parse().unwrap())
        }

        #[test]
        fn reaps_a_real_orphan_kernel_listener_and_frees_the_port() {
            let dir = tempfile::tempdir().unwrap();
            let (mut child, port) = spawn_fake_kernel(dir.path(), "kernel");
            assert!(port_in_use(port));
            let killed = reap_legacy_listener(port);
            assert_eq!(killed, vec![child.id()]);
            assert!(!port_in_use(port));
            let _ = child.wait();
        }

        #[test]
        fn leaves_a_real_foreign_listener_running() {
            let dir = tempfile::tempdir().unwrap();
            let (mut child, port) = spawn_fake_kernel(dir.path(), "notkernel");
            let killed = reap_legacy_listener(port);
            assert!(killed.is_empty());
            assert!(
                child.try_wait().unwrap().is_none(),
                "foreign process was killed"
            );
            assert!(port_in_use(port));
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
