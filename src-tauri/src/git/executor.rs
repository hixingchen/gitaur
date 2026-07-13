use super::GitOutput;
use std::process::Command;

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

/// Execute a git command in the given repository directory.
/// Handles timeout, cancellation, and stderr capture.
pub fn execute(repo_path: &str, args: &[&str]) -> Result<GitOutput, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    Ok(GitOutput {
        stdout: decode_output(&output.stdout),
        stderr: decode_output(&output.stderr),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// Execute a git command that may take a long time (clone, large diff).
/// Returns stdout lines as they come via a callback.
pub async fn execute_streaming<F>(
    repo_path: &str,
    args: &[&str],
    mut on_line: F,
) -> Result<GitOutput, String>
where
    F: FnMut(&str),
{
    use tokio::process::Command as AsyncCommand;

    let mut child = AsyncCommand::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git: {}", e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut stdout_lines = String::new();
    let mut reader = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        on_line(&line);
        stdout_lines.push_str(&line);
        stdout_lines.push('\n');
    }

    let mut stderr_bytes = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(
        &mut tokio::io::BufReader::new(stderr),
        &mut stderr_bytes,
    )
    .await
    .unwrap_or_default();

    let status = child.wait().await.map_err(|e| format!("Git process error: {}", e))?;

    Ok(GitOutput {
        stdout: stdout_lines,
        stderr: decode_output(&stderr_bytes),
        exit_code: status.code().unwrap_or(-1),
    })
}
