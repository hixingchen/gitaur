use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter};

/// Start watching a repository's .git directory for changes.
/// Events are emitted to the frontend via `file-changed` Tauri event.
pub fn start_watching(app: AppHandle, repo_path: &str) -> Result<(), String> {
    let git_dir = PathBuf::from(repo_path).join(".git");
    if !git_dir.exists() {
        return Err(format!("Not a git repository: {}", repo_path));
    }

    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })
    .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    watcher
        .watch(&git_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    // Spawn a thread to forward events to the Tauri app
    std::thread::spawn(move || {
        for event in rx {
            match event {
                Ok(event) => {
                    // Only emit for meaningful changes
                    let should_emit = matches!(
                        event.kind,
                        EventKind::Modify(_)
                            | EventKind::Create(_)
                            | EventKind::Remove(_)
                    );
                    if should_emit {
                        let _ = app.emit("file-changed", event.paths);
                    }
                }
                Err(e) => {
                    log::error!("File watcher error: {}", e);
                }
            }
        }
    });

    // Leak the watcher to keep it alive (it lives until the app exits)
    std::mem::forget(watcher);

    Ok(())
}
