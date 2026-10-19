//! Shell-side kernel health check (PRD 15 R-7).
//!
//! `sys.exit()` in user code used to stop the kernel's event loop while the
//! process lingered: `try_wait` saw a live child, the port had no listener,
//! the editor retried a dead socket forever, and only quitting the app
//! recovered. The supervisor here polls the kernel Nuclei started and, when
//! the process has exited or its port stopped listening, restarts it with
//! exponential backoff and tells the webview through a `kernel-restarted`
//! event (the frontend shows the toast and re-fetches the auth token, which
//! changes with every kernel process).
//!
//! The decision logic is a pure state machine over a [`Host`], so the restart,
//! backoff and give-up behaviour is unit-tested without a Tauri app or Python.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::sync::TryLockError;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::{start_kernel_inner, KernelState, StartMode, StartOutcome, KERNEL_PORT};

/// How often the supervisor looks at the kernel.
pub(super) const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Consecutive polls with no listener before a live process counts as wedged.
/// Two, so one slow poll during a legitimate restart never triggers a second.
const PORT_MISS_THRESHOLD: u32 = 2;
/// Restarts attempted in a row before the supervisor stops and reports failure.
pub(super) const MAX_RESTART_ATTEMPTS: u32 = 5;
const BACKOFF_BASE: Duration = Duration::from_secs(1);
const BACKOFF_CAP: Duration = Duration::from_secs(30);
/// A kernel that stays healthy this long resets the consecutive-attempt count,
/// so a crash loop is bounded while an occasional crash is not.
const STABLE_AFTER: Duration = Duration::from_secs(60);

/// Tauri event emitted after a successful automatic restart.
pub const RESTARTED_EVENT: &str = "kernel-restarted";
/// Tauri event emitted when an automatic restart failed.
pub const RESTART_FAILED_EVENT: &str = "kernel-restart-failed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RestartReason {
    /// The child process exited (crash, kill, `os._exit`).
    ProcessExited,
    /// The process is alive but nothing listens on the port (`sys.exit()`).
    PortClosed,
    /// Nuclei started a kernel but holds no process for it any more.
    NotRunning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KernelRestarted {
    pub reason: RestartReason,
    /// 1-based count of consecutive automatic restarts.
    pub attempt: u32,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KernelRestartFailed {
    pub reason: RestartReason,
    pub attempt: u32,
    pub error: String,
    /// False once [`MAX_RESTART_ATTEMPTS`] is spent: the user must restart.
    pub will_retry: bool,
}

/// What the supervisor sees of the child process on one poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProcessState {
    Running,
    Exited,
    /// No child handle although a kernel was started.
    Absent,
    /// A start is in progress (the process lock is held); do not interfere.
    Starting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RestartOutcome {
    Restarted {
        pid: u32,
    },
    /// The kernel was healthy (or no longer wanted) once the lock was held.
    NotNeeded,
}

/// Everything the supervisor touches, so tests can fake it.
pub(super) trait Host {
    /// True between a successful start and an intentional stop.
    fn supervised(&self) -> bool;
    fn process_state(&self) -> ProcessState;
    fn port_listening(&self) -> bool;
    fn restart(&self, reason: RestartReason) -> Result<RestartOutcome, String>;
    fn notify_restarted(&self, event: KernelRestarted);
    fn notify_failed(&self, event: KernelRestartFailed);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Tick {
    /// Not supervising, or a start is in flight.
    Idle,
    Healthy,
    /// Unhealthy but inside the backoff window or below the miss threshold.
    Waiting,
    Restarted,
    RestartFailed,
    /// Attempts exhausted; nothing more will be tried until the kernel is healthy.
    GaveUp,
}

/// Backoff before restart attempt `attempt` (1-based) may run after the previous
/// one: 1 s, 2 s, 4 s ... capped at 30 s.
pub(super) fn backoff_after(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(16);
    BACKOFF_BASE
        .saturating_mul(1u32 << exponent)
        .min(BACKOFF_CAP)
}

/// True when something is listening on `port` on a loopback address. Binds
/// instead of connecting: a bare connect-and-close makes the kernel's
/// websocket server log a handshake traceback on every poll.
pub(super) fn port_is_listening(port: u16) -> bool {
    let addresses = [
        SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
    ];
    addresses.iter().any(|address| {
        matches!(
            TcpListener::bind(address),
            Err(ref e) if e.kind() == std::io::ErrorKind::AddrInUse
        )
    })
}

pub(super) struct Supervisor<H: Host> {
    host: H,
    port_misses: u32,
    attempts: u32,
    next_attempt_at: Option<Instant>,
    healthy_since: Option<Instant>,
    gave_up: bool,
}

impl<H: Host> Supervisor<H> {
    pub(super) fn new(host: H) -> Self {
        Self {
            host,
            port_misses: 0,
            attempts: 0,
            next_attempt_at: None,
            healthy_since: None,
            gave_up: false,
        }
    }

    /// One supervision step. Pure apart from the [`Host`] calls and `now`.
    pub(super) fn tick(&mut self, now: Instant) -> Tick {
        if !self.host.supervised() {
            self.reset();
            return Tick::Idle;
        }
        let reason = match self.host.process_state() {
            ProcessState::Starting => return Tick::Idle,
            ProcessState::Exited => RestartReason::ProcessExited,
            ProcessState::Absent => RestartReason::NotRunning,
            ProcessState::Running => {
                if self.host.port_listening() {
                    return self.on_healthy(now);
                }
                self.port_misses += 1;
                if self.port_misses < PORT_MISS_THRESHOLD {
                    return Tick::Waiting;
                }
                RestartReason::PortClosed
            }
        };
        self.on_unhealthy(reason, now)
    }

    fn reset(&mut self) {
        self.port_misses = 0;
        self.attempts = 0;
        self.next_attempt_at = None;
        self.healthy_since = None;
        self.gave_up = false;
    }

    fn on_healthy(&mut self, now: Instant) -> Tick {
        self.port_misses = 0;
        if self.gave_up {
            // Someone (the user) restarted the kernel by hand: start afresh.
            self.reset();
        }
        let since = *self.healthy_since.get_or_insert(now);
        if now.saturating_duration_since(since) >= STABLE_AFTER {
            self.attempts = 0;
            self.next_attempt_at = None;
        }
        Tick::Healthy
    }

    fn on_unhealthy(&mut self, reason: RestartReason, now: Instant) -> Tick {
        self.healthy_since = None;
        if self.gave_up {
            return Tick::GaveUp;
        }
        if self.attempts >= MAX_RESTART_ATTEMPTS {
            // Every restart "worked" yet the kernel keeps stopping: a crash loop.
            self.gave_up = true;
            self.host.notify_failed(KernelRestartFailed {
                reason,
                attempt: self.attempts,
                error: "The kernel keeps stopping right after it starts.".to_string(),
                will_retry: false,
            });
            return Tick::GaveUp;
        }
        if self.next_attempt_at.is_some_and(|at| now < at) {
            return Tick::Waiting;
        }
        self.attempts += 1;
        self.next_attempt_at = Some(now + backoff_after(self.attempts));
        self.port_misses = 0;
        match self.host.restart(reason) {
            Ok(RestartOutcome::Restarted { pid }) => {
                self.host.notify_restarted(KernelRestarted {
                    reason,
                    attempt: self.attempts,
                    pid,
                });
                Tick::Restarted
            }
            Ok(RestartOutcome::NotNeeded) => {
                self.attempts -= 1;
                self.next_attempt_at = None;
                Tick::Healthy
            }
            Err(error) => {
                let will_retry = self.attempts < MAX_RESTART_ATTEMPTS;
                self.gave_up = !will_retry;
                self.host.notify_failed(KernelRestartFailed {
                    reason,
                    attempt: self.attempts,
                    error,
                    will_retry,
                });
                Tick::RestartFailed
            }
        }
    }
}

/// What the supervisor sees of the child behind `state`. `try_lock`: a start in
/// progress holds the process lock for as long as the kernel takes to become
/// ready, and the supervisor must neither wait on it nor second-guess it.
pub(super) fn state_process_state(state: &KernelState) -> ProcessState {
    let mut guard = match state.process.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::WouldBlock) => return ProcessState::Starting,
        Err(TryLockError::Poisoned(_)) => return ProcessState::Absent,
    };
    match guard.as_mut() {
        None => ProcessState::Absent,
        Some(child) => match child.try_wait() {
            Ok(None) => ProcessState::Running,
            Ok(Some(_)) | Err(_) => ProcessState::Exited,
        },
    }
}

/// The real [`Host`]: the managed [`KernelState`] and the webview event bus.
struct AppHost {
    app: AppHandle,
}

impl Host for AppHost {
    fn supervised(&self) -> bool {
        self.app.state::<KernelState>().is_supervised()
    }

    fn process_state(&self) -> ProcessState {
        state_process_state(&self.app.state::<KernelState>())
    }

    fn port_listening(&self) -> bool {
        port_is_listening(KERNEL_PORT)
    }

    fn restart(&self, reason: RestartReason) -> Result<RestartOutcome, String> {
        log::warn!("Kernel unhealthy ({reason:?}); restarting it");
        let state = self.app.state::<KernelState>();
        match start_kernel_inner(&state, &self.app, StartMode::IfUnhealthy)? {
            StartOutcome::Started { pid, .. } => Ok(RestartOutcome::Restarted { pid }),
            StartOutcome::Skipped => Ok(RestartOutcome::NotNeeded),
        }
    }

    fn notify_restarted(&self, event: KernelRestarted) {
        log::info!("Kernel restarted automatically: {event:?}");
        if let Err(e) = self.app.emit(RESTARTED_EVENT, event) {
            log::warn!("Could not emit {RESTARTED_EVENT}: {e}");
        }
    }

    fn notify_failed(&self, event: KernelRestartFailed) {
        log::error!("Automatic kernel restart failed: {event:?}");
        if let Err(e) = self.app.emit(RESTART_FAILED_EVENT, event) {
            log::warn!("Could not emit {RESTART_FAILED_EVENT}: {e}");
        }
    }
}

/// Start the background supervisor. Call once, from the Tauri `setup` hook.
pub fn spawn_monitor(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("kernel-health".to_string())
        .spawn(move || {
            let mut supervisor = Supervisor::new(AppHost { app });
            loop {
                std::thread::sleep(POLL_INTERVAL);
                supervisor.tick(Instant::now());
            }
        });
    if let Err(e) = spawned {
        log::error!("Could not start the kernel health monitor: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    struct FakeHost {
        supervised: Cell<bool>,
        process: Cell<ProcessState>,
        listening: Cell<bool>,
        restart_result: RefCell<Result<RestartOutcome, String>>,
        restarts: RefCell<Vec<RestartReason>>,
        restarted: RefCell<Vec<KernelRestarted>>,
        failed: RefCell<Vec<KernelRestartFailed>>,
    }

    impl FakeHost {
        fn new() -> Self {
            Self {
                supervised: Cell::new(true),
                process: Cell::new(ProcessState::Running),
                listening: Cell::new(true),
                restart_result: RefCell::new(Ok(RestartOutcome::Restarted { pid: 4242 })),
                restarts: RefCell::new(Vec::new()),
                restarted: RefCell::new(Vec::new()),
                failed: RefCell::new(Vec::new()),
            }
        }
    }

    impl Host for &FakeHost {
        fn supervised(&self) -> bool {
            self.supervised.get()
        }
        fn process_state(&self) -> ProcessState {
            self.process.get()
        }
        fn port_listening(&self) -> bool {
            self.listening.get()
        }
        fn restart(&self, reason: RestartReason) -> Result<RestartOutcome, String> {
            self.restarts.borrow_mut().push(reason);
            self.restart_result.borrow().clone()
        }
        fn notify_restarted(&self, event: KernelRestarted) {
            self.restarted.borrow_mut().push(event);
        }
        fn notify_failed(&self, event: KernelRestartFailed) {
            self.failed.borrow_mut().push(event);
        }
    }

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let delays: Vec<u64> = (1..=8).map(|n| backoff_after(n).as_secs()).collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 16, 30, 30, 30]);
        assert_eq!(backoff_after(0).as_secs(), 1);
        assert_eq!(backoff_after(u32::MAX).as_secs(), 30);
    }

    #[test]
    fn a_healthy_kernel_is_left_alone() {
        let host = FakeHost::new();
        let mut sup = Supervisor::new(&host);
        let t0 = Instant::now();
        for i in 0..5 {
            assert_eq!(sup.tick(t0 + secs(i * 2)), Tick::Healthy);
        }
        assert!(host.restarts.borrow().is_empty());
    }

    #[test]
    fn nothing_happens_when_the_kernel_is_not_supervised_or_is_starting() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        host.supervised.set(false);
        let mut sup = Supervisor::new(&host);
        assert_eq!(sup.tick(Instant::now()), Tick::Idle);
        host.supervised.set(true);
        host.process.set(ProcessState::Starting);
        assert_eq!(sup.tick(Instant::now()), Tick::Idle);
        assert!(host.restarts.borrow().is_empty());
    }

    #[test]
    fn an_exited_process_is_restarted_at_once_and_announced() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        let mut sup = Supervisor::new(&host);
        assert_eq!(sup.tick(Instant::now()), Tick::Restarted);
        assert_eq!(*host.restarts.borrow(), vec![RestartReason::ProcessExited]);
        assert_eq!(
            *host.restarted.borrow(),
            vec![KernelRestarted {
                reason: RestartReason::ProcessExited,
                attempt: 1,
                pid: 4242
            }]
        );
    }

    #[test]
    fn a_missing_child_handle_is_restarted_as_not_running() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Absent);
        let mut sup = Supervisor::new(&host);
        assert_eq!(sup.tick(Instant::now()), Tick::Restarted);
        assert_eq!(*host.restarts.borrow(), vec![RestartReason::NotRunning]);
    }

    #[test]
    fn a_live_process_with_a_closed_port_is_restarted_after_two_misses() {
        // The sys.exit() wedge: kill -0 succeeds, nothing listens.
        let host = FakeHost::new();
        host.listening.set(false);
        let mut sup = Supervisor::new(&host);
        let t0 = Instant::now();
        assert_eq!(sup.tick(t0), Tick::Waiting);
        assert!(host.restarts.borrow().is_empty());
        assert_eq!(sup.tick(t0 + secs(2)), Tick::Restarted);
        assert_eq!(*host.restarts.borrow(), vec![RestartReason::PortClosed]);
    }

    #[test]
    fn one_missed_poll_followed_by_a_listener_does_not_restart() {
        let host = FakeHost::new();
        let mut sup = Supervisor::new(&host);
        let t0 = Instant::now();
        host.listening.set(false);
        assert_eq!(sup.tick(t0), Tick::Waiting);
        host.listening.set(true);
        assert_eq!(sup.tick(t0 + secs(2)), Tick::Healthy);
        host.listening.set(false);
        assert_eq!(
            sup.tick(t0 + secs(4)),
            Tick::Waiting,
            "miss count must have reset"
        );
        assert!(host.restarts.borrow().is_empty());
    }

    #[test]
    fn a_kernel_that_dies_again_waits_out_the_backoff() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        let mut sup = Supervisor::new(&host);
        let t0 = Instant::now();
        assert_eq!(sup.tick(t0), Tick::Restarted); // attempt 1, next allowed t0+1s
        assert_eq!(sup.tick(t0), Tick::Waiting);
        assert_eq!(sup.tick(t0 + Duration::from_millis(900)), Tick::Waiting);
        assert_eq!(sup.tick(t0 + secs(1)), Tick::Restarted); // attempt 2, next t+2s
        assert_eq!(sup.tick(t0 + secs(2)), Tick::Waiting);
        assert_eq!(sup.tick(t0 + secs(3)), Tick::Restarted); // attempt 3
        let attempts: Vec<u32> = host.restarted.borrow().iter().map(|e| e.attempt).collect();
        assert_eq!(attempts, vec![1, 2, 3]);
    }

    #[test]
    fn failed_restarts_are_reported_and_give_up_after_the_limit() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        *host.restart_result.borrow_mut() = Err("python missing".to_string());
        let mut sup = Supervisor::new(&host);
        let mut now = Instant::now();
        for _ in 0..MAX_RESTART_ATTEMPTS {
            assert_eq!(sup.tick(now), Tick::RestartFailed);
            now += secs(60);
        }
        assert_eq!(sup.tick(now), Tick::GaveUp);
        assert_eq!(sup.tick(now + secs(600)), Tick::GaveUp, "stays given up");
        assert_eq!(host.restarts.borrow().len(), MAX_RESTART_ATTEMPTS as usize);
        let failed = host.failed.borrow();
        assert_eq!(failed.len(), MAX_RESTART_ATTEMPTS as usize);
        assert!(failed[..MAX_RESTART_ATTEMPTS as usize - 1]
            .iter()
            .all(|f| f.will_retry));
        assert!(!failed[MAX_RESTART_ATTEMPTS as usize - 1].will_retry);
        assert_eq!(failed[0].error, "python missing");
    }

    #[test]
    fn a_healthy_kernel_re_arms_a_supervisor_that_gave_up() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        *host.restart_result.borrow_mut() = Err("boom".to_string());
        let mut sup = Supervisor::new(&host);
        let mut now = Instant::now();
        for _ in 0..=MAX_RESTART_ATTEMPTS {
            sup.tick(now);
            now += secs(60);
        }
        assert_eq!(sup.tick(now), Tick::GaveUp);
        // The user restarts the kernel by hand.
        host.process.set(ProcessState::Running);
        assert_eq!(sup.tick(now), Tick::Healthy);
        host.process.set(ProcessState::Exited);
        *host.restart_result.borrow_mut() = Ok(RestartOutcome::Restarted { pid: 7 });
        assert_eq!(sup.tick(now + secs(120)), Tick::Restarted);
    }

    #[test]
    fn a_crash_loop_is_not_reset_by_brief_health_but_a_stable_kernel_is() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        let mut sup = Supervisor::new(&host);
        let t0 = Instant::now();
        assert_eq!(sup.tick(t0), Tick::Restarted); // attempt 1
        host.process.set(ProcessState::Running);
        assert_eq!(sup.tick(t0 + secs(2)), Tick::Healthy);
        host.process.set(ProcessState::Exited);
        assert_eq!(sup.tick(t0 + secs(4)), Tick::Restarted);
        assert_eq!(host.restarted.borrow().last().unwrap().attempt, 2);
        // Healthy for over a minute: the next failure starts counting again.
        host.process.set(ProcessState::Running);
        assert_eq!(sup.tick(t0 + secs(10)), Tick::Healthy);
        assert_eq!(sup.tick(t0 + secs(80)), Tick::Healthy);
        host.process.set(ProcessState::Exited);
        assert_eq!(sup.tick(t0 + secs(82)), Tick::Restarted);
        assert_eq!(host.restarted.borrow().last().unwrap().attempt, 1);
    }

    #[test]
    fn a_restart_that_finds_the_kernel_already_healthy_is_not_announced() {
        let host = FakeHost::new();
        host.process.set(ProcessState::Exited);
        *host.restart_result.borrow_mut() = Ok(RestartOutcome::NotNeeded);
        let mut sup = Supervisor::new(&host);
        assert_eq!(sup.tick(Instant::now()), Tick::Healthy);
        assert!(host.restarted.borrow().is_empty());
        assert!(host.failed.borrow().is_empty());
    }

    #[test]
    fn port_probe_sees_a_listener_and_a_free_port() {
        // Other tests bind ephemeral ports in parallel and may be handed the one
        // just released, so accept the first round in which the port really frees up.
        for _ in 0..20 {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            assert!(port_is_listening(port), "a bound listener must be seen");
            drop(listener);
            if !port_is_listening(port) {
                return;
            }
        }
        panic!("a released port never read as free");
    }

    #[test]
    fn events_serialize_with_snake_case_reasons() {
        let json = serde_json::to_value(KernelRestarted {
            reason: RestartReason::PortClosed,
            attempt: 2,
            pid: 9,
        })
        .unwrap();
        assert_eq!(json["reason"], "port_closed");
        assert_eq!(json["attempt"], 2);
        assert_eq!(json["pid"], 9);
    }

    // ── the real KernelState, real child processes ──

    fn spawn(script: &str) -> std::process::Child {
        std::process::Command::new("sh")
            .args(["-c", script])
            .spawn()
            .unwrap()
    }

    fn wait_exited(state: &KernelState) {
        for _ in 0..200 {
            if state_process_state(state) == ProcessState::Exited {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("child never reported exit");
    }

    #[test]
    fn state_process_state_tells_running_exited_absent_and_starting_apart() {
        let state = KernelState::new();
        assert_eq!(state_process_state(&state), ProcessState::Absent);

        *state.process.lock().unwrap() = Some(spawn("sleep 30"));
        assert_eq!(state_process_state(&state), ProcessState::Running);
        {
            let _starting = state.process.lock().unwrap();
            assert_eq!(state_process_state(&state), ProcessState::Starting);
        }

        let mut child = state.process.lock().unwrap().take().unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
        *state.process.lock().unwrap() = Some(spawn("exit 3"));
        wait_exited(&state);
        state.stop();
    }

    /// Host over a real `KernelState`: the port probe is scripted, and "restart"
    /// really installs a fresh child the way `start_kernel_inner` does.
    struct StateHost<'a> {
        state: &'a KernelState,
        listening: Cell<bool>,
        restarts: Cell<u32>,
    }

    impl Host for &StateHost<'_> {
        fn supervised(&self) -> bool {
            self.state.is_supervised()
        }
        fn process_state(&self) -> ProcessState {
            state_process_state(self.state)
        }
        fn port_listening(&self) -> bool {
            self.listening.get()
        }
        fn restart(&self, _reason: RestartReason) -> Result<RestartOutcome, String> {
            self.restarts.set(self.restarts.get() + 1);
            let child = spawn("sleep 30");
            let pid = child.id();
            let mut guard = self.state.process.lock().unwrap();
            if let Some(old) = guard.as_mut() {
                let _ = old.kill();
                let _ = old.wait();
            }
            *guard = Some(child);
            self.listening.set(true);
            Ok(RestartOutcome::Restarted { pid })
        }
        fn notify_restarted(&self, _event: KernelRestarted) {}
        fn notify_failed(&self, _event: KernelRestartFailed) {}
    }

    #[test]
    fn a_kernel_process_that_exits_is_restarted_and_a_wedged_one_too() {
        let state = KernelState::new();
        *state.process.lock().unwrap() = Some(spawn("exit 0"));
        state.set_supervised(true);
        wait_exited(&state);
        let host = StateHost {
            state: &state,
            listening: Cell::new(true),
            restarts: Cell::new(0),
        };
        let mut sup = Supervisor::new(&host);
        let t0 = Instant::now();

        // The child died: replaced on the first poll.
        assert_eq!(sup.tick(t0), Tick::Restarted);
        assert_eq!(state_process_state(&state), ProcessState::Running);
        assert_eq!(sup.tick(t0 + secs(2)), Tick::Healthy);

        // sys.exit() wedge: the process is alive, the port has no listener.
        host.listening.set(false);
        assert_eq!(sup.tick(t0 + secs(4)), Tick::Waiting);
        assert_eq!(sup.tick(t0 + secs(6)), Tick::Restarted);
        assert_eq!(host.restarts.get(), 2);
        assert_eq!(sup.tick(t0 + secs(8)), Tick::Healthy);

        // An intentional stop ends supervision: no restart after Quit.
        state.stop();
        assert!(!state.is_supervised());
        assert_eq!(sup.tick(t0 + secs(10)), Tick::Idle);
        assert_eq!(host.restarts.get(), 2);
    }
}
