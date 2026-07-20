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

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo_path)
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")      // 禁止交互式提示（密码等）
        .env("GIT_EDITOR", "true")             // 编辑器设为 no-op，防止等待输入
        .env("GIT_MERGE_AUTOEDIT", "no")       // 合并不打开编辑器
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows: 抑制 cmd 窗口弹出
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn()
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
            // Timeout — 先检查进程是否已退出，再决定是否 kill（防止 PID 竞态）
            if rx.try_recv().is_ok() {
                log::debug!("Git process exited before kill attempt");
            } else {
                let kill_result = {
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        Command::new("taskkill")
                            .args(["/F", "/PID", &child_id.to_string()])
                            .creation_flags(0x08000000) // CREATE_NO_WINDOW
                            .output()
                    }
                    #[cfg(not(windows))]
                    { Command::new("kill").args(["-9", &child_id.to_string()]).output() }
                };
                if let Err(e) = kill_result {
                    log::debug!("Failed to kill timed-out git process {}: {}", child_id, e);
                }
            }
            // 等待线程退出，设置 5 秒二次超时防止 join 无限阻塞
            let join_timeout = Duration::from_secs(5);
            let (tx2, rx2) = std::sync::mpsc::channel();
            let cleanup_handle = std::thread::spawn(move || {
                let _ = thread_handle.join();
                let _ = tx2.send(());
            });
            if rx2.recv_timeout(join_timeout).is_err() {
                log::warn!("Thread join timed out after kill");
                // 线程仍在运行，但 kill 已发送，最终会退出，不阻塞当前线程
            } else {
                let _ = cleanup_handle.join();
            }
            log::error!("Git command timed out after {}s: git {}", timeout.as_secs(), args.join(" "));
            Err(format!("Git 命令超时（{}s）", timeout.as_secs()))
        }
    }
}

