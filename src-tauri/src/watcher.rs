use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Handle for an active file watcher, allowing it to be stopped.
struct WatcherHandle {
    _watcher: RecommendedWatcher,
    shutdown_tx: mpsc::Sender<()>,
    _thread: std::thread::JoinHandle<()>,
    repo_path: String,
}

/// Global watcher state — only one active watcher at a time.
static ACTIVE_WATCHER: Mutex<Option<WatcherHandle>> = Mutex::new(None);

/// Stop the currently active file watcher (if any).
/// 使用 unwrap_or_else 恢复中毒的 Mutex，避免 watcher 永久失效。
/// Join 线程确保资源完全释放。
pub fn stop_watching() {
    let mut guard = ACTIVE_WATCHER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(handle) = guard.take() {
        // Signal the event-forwarding thread to exit
        let _ = handle.shutdown_tx.send(());
        // Dropping handle._watcher stops the OS-level watch
        // 等待线程退出，确保资源完全释放（500ms recv_timeout 保证快速退出）
        let _ = handle._thread.join();
        log::info!("Stopped file watcher for: {}", handle.repo_path);
    }
}

/// Start watching a repository's .git directory for changes.
/// Stops any previously active watcher first.
/// Events are emitted to the frontend via `file-changed` Tauri event.
pub fn start_watching(app: AppHandle, repo_path: &str) -> Result<(), String> {
    let git_dir = PathBuf::from(repo_path).join(".git");
    if !git_dir.exists() {
        return Err(format!("Not a git repository: {}", repo_path));
    }

    // Stop the previous watcher before starting a new one
    stop_watching();

    let (event_tx, event_rx) = mpsc::channel::<Result<Event, notify::Error>>();
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = event_tx.send(event);
    })
    .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    watcher
        .watch(&git_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    // Spawn a thread to forward events to the Tauri app
    let thread = std::thread::spawn(move || {
        loop {
            // Check shutdown signal (non-blocking)
            if shutdown_rx.try_recv().is_ok() {
                break;
            }

            // Try to receive an event with a timeout so we can check shutdown
            match event_rx.recv_timeout(std::time::Duration::from_millis(500)) {
                Ok(Ok(event)) => {
                    let should_emit = matches!(
                        event.kind,
                        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                    );
                    if should_emit {
                        let _ = app.emit("file-changed", event.paths);
                    }
                }
                Ok(Err(e)) => {
                    log::error!("File watcher error: {}", e);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    let handle = WatcherHandle {
        _watcher: watcher,
        shutdown_tx,
        _thread: thread,
        repo_path: repo_path.to_string(),
    };

    {
        let mut guard = ACTIVE_WATCHER.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(handle);
    }

    log::info!("Started file watcher for: {}", repo_path);
    Ok(())
}
