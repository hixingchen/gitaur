use super::GitOutput;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Default timeout for git commands (30 seconds).
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Timeout for long-running commands (clone, fetch, push, pull) — 5 minutes.
const LONG_TIMEOUT: Duration = Duration::from_secs(300);

/// Decode bytes using UTF-8, falling back to GBK for Windows Chinese systems.
fn decode_output(bytes: &[u8]) -> String {
    // Try UTF-8 first
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // Fallback to GBK (common on Windows Chinese systems)
    let (decoded, _, _) = encoding_rs::GBK.decode(bytes);
    decoded.into_owned()
}

/// Determine if a git command is long-running and needs a longer timeout.
fn is_long_running(args: &[&str]) -> bool {
    matches!(args.first(), Some(&"clone" | &"fetch" | &"pull" | &"push"))
}

/// Execute a git command in the given repository directory with timeout.
pub fn execute(repo_path: &str, args: &[&str]) -> Result<GitOutput, String> {
    let timeout = if is_long_running(args) {
        LONG_TIMEOUT
    } else {
        DEFAULT_TIMEOUT
    };

    let child = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    // Wait with timeout using a background thread
    let (tx, rx) = std::sync::mpsc::channel();
    let child_id = child.id();

    let thread_handle = std::thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(GitOutput {
            stdout: decode_output(&output.stdout),
            stderr: decode_output(&output.stderr),
            exit_code: output.status.code().unwrap_or(-1),
        }),
        Ok(Err(e)) => Err(format!("Git process error: {}", e)),
        Err(_) => {
            // Timeout — try to kill the process
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &child_id.to_string()])
                    .output();
            }
            #[cfg(not(windows))]
            {
                let _ = Command::new("kill")
                    .args(["-9", &child_id.to_string()])
                    .output();
            }
            // 等待线程退出（进程被 kill 后应该很快退出）
            let _ = thread_handle.join();
            Err(format!(
                "Git command timed out after {}s: git {}",
                timeout.as_secs(),
                args.join(" ")
            ))
        }
    }
}

