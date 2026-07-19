use crate::git::executor;
use crate::git::parser::{self, Branch, FileStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 验证分支名/引用不以 `-` 开头（防止被误解为 git 选项）
fn validate_ref(name: &str) -> Result<(), String> {
    if name.starts_with('-') {
        return Err(format!("无效的引用名: {}", name));
    }
    if name.contains("..") || name.contains("~") || name.contains('^') {
        return Err(format!("引用名包含非法字符: {}", name));
    }
    Ok(())
}

/// 验证仓库路径 — 防止路径穿越和选项注入
fn validate_repo_path(path: &str) -> Result<std::path::PathBuf, String> {
    if path.starts_with('-') {
        return Err("仓库路径不能以 - 开头".to_string());
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| format!("仓库路径无效: {}", path))?;
    if !canonical.join(".git").exists() {
        return Err(format!("不是有效的 git 仓库: {}", path));
    }
    Ok(canonical)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub branches: Vec<Branch>,
    pub current_branch: String,
    pub status: Vec<FileStatus>,
    pub ahead: usize,
    pub behind: usize,
    pub has_upstream: bool,
}

#[tauri::command]
pub fn get_repo_status(repo_path: String) -> Result<RepoInfo, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    // Get status
    let status_output = executor::execute(&repo_path, &["status", "--porcelain", "-uall"])?;
    let status = parser::parse_status(&status_output.stdout);

    // Get branches
    let branch_output = executor::execute(&repo_path, &["branch", "-a", "-vv"])?;
    let branches = parser::parse_branches(&branch_output.stdout);

    let current_branch = branches
        .iter()
        .find(|b| b.is_current)
        .map(|b| b.name.clone())
        .unwrap_or_else(|| "unknown".to_string());

    let current = branches.iter().find(|b| b.is_current);
    let ahead = current.map(|b| b.ahead).unwrap_or(0);
    let behind = current.map(|b| b.behind).unwrap_or(0);
    let has_upstream = current.and_then(|b| b.upstream.as_ref()).is_some();

    Ok(RepoInfo {
        path: repo_path,
        branches,
        current_branch,
        status,
        ahead,
        behind,
        has_upstream,
    })
}

/// Validate file path for git commands — reject path traversal.
fn validate_git_file_path(file_path: &str) -> Result<(), String> {
    if file_path.contains("..") {
        return Err("路径包含非法字符".to_string());
    }
    if std::path::Path::new(file_path).is_absolute() {
        return Err("不允许绝对路径".to_string());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CommitParams {
    pub message: String,
    pub files: Vec<String>,
    pub amend: Option<bool>,
}

#[tauri::command]
pub fn git_commit(repo_path: String, params: CommitParams) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    // 验证提交消息长度
    if params.message.len() > 10000 {
        return Err("提交消息过长（超过 10000 字符）".to_string());
    }
    if params.message.trim().is_empty() {
        return Err("提交消息不能为空".to_string());
    }
    // 验证文件路径防止路径穿越
    for file in &params.files {
        validate_git_file_path(file)?;
    }

    let mut args: Vec<String> = vec!["commit".into(), "-m".into(), params.message.clone()];

    if params.amend.unwrap_or(false) {
        args.push("--amend".into());
    }

    if !params.files.is_empty() {
        args.push("--".into());
        args.extend(params.files.iter().cloned());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = executor::execute(&repo_path, &arg_refs)?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_checkout(
    repo_path: String,
    target: String,
    create_branch: Option<bool>,
    start_point: Option<String>,
) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&target)?;
    let mut args: Vec<&str> = vec!["checkout"];

    if create_branch.unwrap_or(false) {
        args.push("-b");
    }

    args.push(&target);

    // 创建分支时可选指定起点（如 origin/feature），用于建立跟踪关系
    let sp_owned;
    if let Some(ref sp) = start_point {
        validate_ref(sp)?;
        sp_owned = sp.clone();
        args.push(&sp_owned);
    }

    let output = executor::execute(&repo_path, &args)?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_push(
    repo_path: String,
    remote: Option<String>,
    force: Option<bool>,
    delete: Option<bool>,
    branch: Option<String>,
) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let remote = remote.unwrap_or_else(|| "origin".to_string());

    // 验证 remote 和 branch 参数防止注入
    validate_ref(&remote)?;
    if let Some(ref b) = branch {
        validate_ref(b)?;
    }

    let mut args: Vec<String> = vec!["push".into()];

    if delete.unwrap_or(false) {
        // 删除远程分支：git push origin --delete branch_name
        args.push(remote);
        args.push("--delete".into());
        args.push(branch.unwrap_or_else(|| "HEAD".into()));
    } else {
        // 正常推送：git push -u origin HEAD
        args.push("-u".into());
        args.push(remote);
        args.push(branch.unwrap_or_else(|| "HEAD".into()));

        if force.unwrap_or(false) {
            args.push("--force-with-lease".into());
        }
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = executor::execute(&repo_path, &arg_refs)?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_pull(repo_path: String, remote: Option<String>, rebase: Option<bool>) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    validate_ref(&remote)?;
    let mut args: Vec<&str> = vec!["pull", &remote];

    if rebase.unwrap_or(false) {
        args.push("--rebase");
    }

    let output = executor::execute(&repo_path, &args)?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_fetch(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let output = executor::execute(&repo_path, &["fetch", "--all", "--prune"])?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[derive(Debug, Serialize)]
pub struct LogEntry {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
    pub refs: Vec<String>,
    pub parents: Vec<String>,
}

#[tauri::command]
pub fn get_log(
    repo_path: String,
    max_count: Option<usize>,
    branch: Option<String>,
    base_ref: Option<String>,
    first_parent: Option<bool>,
    no_merges: Option<bool>,
) -> Result<Vec<LogEntry>, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let count = max_count.unwrap_or(100).to_string();
    let mut args: Vec<&str> = vec![
        "log",
        "--format=%H%x00%P%x00%an%x00%ae%x00%ad%x00%s%x00%d",
        "--date=format:%Y-%m-%d %H:%M:%S",
        "--max-count",
        &count,
    ];

    // --first-parent: 只跟随第一个父提交，展示简洁单线历史
    let use_first_parent = first_parent.unwrap_or(false);
    if use_first_parent {
        args.push("--first-parent");
    }

    // --no-merges: 隐藏合并提交，只显示实际代码提交
    if no_merges.unwrap_or(false) {
        args.push("--no-merges");
    }

    let range_str;
    let remote_ref_str;
    if let (Some(ref b), Some(ref base)) = (&branch, &base_ref) {
        // 范围查询：base..branch，只返回 branch 独有的提交
        validate_ref(b)?;
        validate_ref(base)?;
        range_str = format!("{}..{}", base, b);
        args.push(&range_str);
    } else if let Some(ref b) = branch {
        validate_ref(b)?;
        args.push(b);
    } else {
        // 不指定分支 → 智能选择显示方式
        let current_branch = executor::execute(&repo_path, &["branch", "--show-current"])?;
        let branch_name = current_branch.stdout.trim();

        if !branch_name.is_empty() {
            // feature/xxx, bugfix/xxx, release/xxx, hotfix/xxx 分支 → 只显示差异提交
            if branch_name.starts_with("feature/") || branch_name.starts_with("bugfix/") || branch_name.starts_with("release/") || branch_name.starts_with("hotfix/") {
                // 确定基准分支：hotfix 基于 main，其他基于 develop
                let base = if branch_name.starts_with("hotfix/") {
                    let has_remote_main = executor::execute(
                        &repo_path, &["rev-parse", "--verify", "origin/main"]
                    );
                    if has_remote_main.is_ok() && has_remote_main.unwrap().is_success() {
                        "origin/main"
                    } else {
                        "main"
                    }
                } else {
                    let has_remote_develop = executor::execute(
                        &repo_path, &["rev-parse", "--verify", "origin/develop"]
                    );
                    if has_remote_develop.is_ok() && has_remote_develop.unwrap().is_success() {
                        "origin/develop"
                    } else {
                        "develop"
                    }
                };
                remote_ref_str = format!("origin/{}", branch_name);
                let check = executor::execute(&repo_path, &["rev-parse", "--verify", &remote_ref_str]);
                if check.is_ok() && check.unwrap().is_success() {
                    range_str = format!("{}..{}", base, remote_ref_str);
                    args.push(&range_str);
                } else {
                    // 远程分支不存在，用本地
                    range_str = format!("{}..{}", base, branch_name);
                    args.push(&range_str);
                }
            } else {
                // 其他分支（develop, main 等） → 显示远程跟踪分支（优先）或本地分支
                remote_ref_str = format!("origin/{}", branch_name);
                let check = executor::execute(&repo_path, &["rev-parse", "--verify", &remote_ref_str]);
                if check.is_ok() && check.unwrap().is_success() {
                    args.push(&remote_ref_str);
                }
                // 远程分支不存在时不添加，git log 默认用 HEAD
            }
        }
    }

    let output = executor::execute(&repo_path, &args)?;

    let entries: Vec<LogEntry> = output
        .stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() < 6 {
                return None;
            }

            let parents: Vec<String> = parts[1]
                .split_whitespace()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();

            let refs_str = parts.get(6).unwrap_or(&"").trim();
            let refs: Vec<String> = refs_str
                .trim_matches(|c| c == '(' || c == ')')
                .split(", ")
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();

            Some(LogEntry {
                hash: parts[0].to_string(),
                author: parts[2].to_string(),
                email: parts[3].to_string(),
                date: parts[4].to_string(),
                message: parts[5].to_string(),
                refs,
                parents,
            })
        })
        .collect();

    Ok(entries)
}

/// 根据提交消息查找提交
#[tauri::command]
pub fn git_log_find_by_message(
    repo_path: String,
    branch: String,
    message: String,
    max_count: Option<usize>,
) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&branch)?;
    let count = max_count.unwrap_or(10).to_string();

    let output = executor::execute(&repo_path, &[
        "log",
        &branch,
        &format!("--grep={}", message),
        "--format=%H%x00%s",
        "--max-count",
        &count,
    ])?;

    Ok(output.stdout)
}

/// 收集分支上的完整 commit messages（含换行），用于生成 squash 默认消息
#[tauri::command]
pub fn git_collect_messages(
    repo_path: String,
    branch: String,
    base_ref: String,
    max_count: Option<usize>,
) -> Result<Vec<String>, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&branch)?;
    validate_ref(&base_ref)?;
    let count = max_count.unwrap_or(100).to_string();
    let range = format!("{}..{}", base_ref, branch);

    // %B = full body（含换行），用 \x00\x00 分隔不同 commit
    let output = executor::execute(&repo_path, &[
        "log",
        &range,
        "--no-merges",
        "--format=%B%x00%x00",
        "--max-count",
        &count,
    ])?;

    let messages: Vec<String> = output.stdout
        .split("\x00\x00")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(messages)
}

/// 查找分支上最新的非合并提交（用于找到 squash 提交）
#[tauri::command]
pub fn git_find_latest_non_merge_commit(
    repo_path: String,
    branch: String,
) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&branch)?;

    let output = executor::execute(&repo_path, &[
        "rev-list",
        "--no-merges",
        "--max-count=1",
        &branch,
    ])?;

    Ok(output.stdout.trim().to_string())
}

#[tauri::command]
pub fn git_merge(repo_path: String, branch: String, no_ff: Option<bool>, strategy: Option<String>) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&branch)?;
    let mut args: Vec<&str> = vec!["merge", &branch];
    if no_ff.unwrap_or(false) { args.push("--no-ff"); }
    // 支持冲突解决策略：ours 或 theirs
    if let Some(ref s) = strategy {
        if s == "ours" || s == "theirs" {
            args.push("-X");
            args.push(s);
        }
    }
    args.push("--no-edit");
    let output = executor::execute(&repo_path, &args)?;
    if output.exit_code != 0 {
        return Err(format!("{}\n{}", output.stdout, output.stderr));
    }
    Ok(format!("{}\n{}", output.stdout, output.stderr))
}

#[tauri::command]
pub fn git_rebase(repo_path: String, onto: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&onto)?;

    // 如果有未完成的 rebase，先自动 abort
    let rebase_dir = std::path::Path::new(&repo_path).join(".git").join("rebase-merge");
    let rebase_apply = std::path::Path::new(&repo_path).join(".git").join("rebase-apply");
    if rebase_dir.exists() || rebase_apply.exists() {
        let _ = executor::execute(&repo_path, &["rebase", "--abort"]);
    }

    let output = executor::execute(&repo_path, &["rebase", &onto])?;
    if output.exit_code != 0 {
        return Err(format!("{}\n{}", output.stdout, output.stderr));
    }
    Ok(format!("{}\n{}", output.stdout, output.stderr))
}

#[tauri::command]
pub fn git_abort_rebase(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let output = executor::execute(&repo_path, &["rebase", "--abort"])?;
    if output.exit_code != 0 {
        return Err(format!("{}\n{}", output.stdout, output.stderr));
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_rebase_continue(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let output = executor::execute(&repo_path, &["rebase", "--continue"])?;
    if output.exit_code != 0 {
        return Err(format!("{}\n{}", output.stdout, output.stderr));
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_merge_abort(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let output = executor::execute(&repo_path, &["merge", "--abort"])?;
    if output.exit_code != 0 {
        return Err(format!("{}\n{}", output.stdout, output.stderr));
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn check_rebase_state(repo_path: String) -> Result<bool, String> {
    let canonical = validate_repo_path(&repo_path)?;
    let rebase_merge = canonical.join(".git/rebase-merge");
    let rebase_apply = canonical.join(".git/rebase-apply");
    Ok(rebase_merge.exists() || rebase_apply.exists())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub has_conflicts: bool,
    pub conflicted_files: Vec<String>,
}

#[tauri::command]
pub fn check_conflicts(repo_path: String) -> Result<ConflictInfo, String> {
    let canonical = validate_repo_path(&repo_path)?;
    let repo_path_str = canonical.to_string_lossy().to_string();
    let status_out = executor::execute(&repo_path_str, &["status", "--porcelain"])?;
    let conflicted: Vec<String> = status_out.stdout.lines()
        .filter(|l| l.starts_with("UU") || l.starts_with("AA") || l.starts_with("DD")
            || l.starts_with("AU") || l.starts_with("UA") || l.starts_with("UD") || l.starts_with("DU"))
        .map(|l| l.get(3..).unwrap_or("").trim().to_string())
        .collect();
    let rebase_dir = canonical.join(".git/rebase-merge");
    let rebase_apply = canonical.join(".git/rebase-apply");
    Ok(ConflictInfo {
        has_conflicts: !conflicted.is_empty() || rebase_dir.exists() || rebase_apply.exists(),
        conflicted_files: conflicted,
    })
}

/// Validate clone URL — only allow http/https/ssh/git protocols.
fn validate_clone_url(url: &str) -> Result<(), String> {
    // 拒绝以 - 开头的 URL，防止被 git 解释为选项
    if url.starts_with('-') {
        return Err("URL 不能以 - 开头".to_string());
    }
    // 拒绝 file:// 协议（防止读取本地文件）
    if url.starts_with("file://") {
        return Err("不允许 file:// 协议".to_string());
    }
    // HTTP/HTTPS URL 需要 SSRF 验证
    if url.starts_with("http://") || url.starts_with("https://") {
        return crate::commands::gitlab::validate_external_url(url);
    }
    if url.starts_with("ssh://") {
        // 防止 SSH 用户名注入（如 ssh://-oProxyCommand=evil@host/path）
        if let Some(at_pos) = url.find('@') {
            let userinfo = &url[6..at_pos]; // ssh:// 后到 @ 之前
            if userinfo.starts_with('-') {
                return Err("SSH URL 用户名不能以 - 开头".to_string());
            }
        }
        return Ok(());
    }
    if url.starts_with("git://") {
        return Err("git:// 协议不安全（明文传输），请使用 https:// 或 ssh://".to_string());
    }
    // SSH shorthand: git@host:path（不含 ://）
    if url.contains('@') && !url.contains("://") {
        return Ok(());
    }
    Err(format!("不支持的 URL 协议: {}", url))
}

/// Validate target path — reject path traversal.
/// 允许绝对路径（原生文件对话框返回绝对路径）。
fn validate_target_path(path: &str) -> Result<(), String> {
    if path.contains("..") {
        return Err("路径包含非法字符".to_string());
    }
    if path.trim().is_empty() {
        return Err("目标路径不能为空".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn git_clone(url: String, target_path: String) -> Result<String, String> {
    // Validate inputs
    validate_clone_url(&url)?;
    validate_target_path(&target_path)?;

    // Run clone in a blocking thread to avoid freezing the async runtime
    let output = tokio::task::spawn_blocking(move || {
        executor::execute(".", &["clone", &url, &target_path])
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))??;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

/// Validate git revision — reject special characters that could be abused.
fn validate_revision(rev: &str) -> Result<(), String> {
    if rev.starts_with('-') {
        return Err("revision 不能以 - 开头".to_string());
    }
    if rev.contains("..") || rev.contains("~") || rev.contains('^') {
        return Err("不支持的 revision 语法".to_string());
    }
    if rev.is_empty() {
        return Err("revision 不能为空".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_file_content(repo_path: String, file_path: String, revision: Option<String>) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_git_file_path(&file_path)?;

    let mut args: Vec<&str> = vec!["show"];

    let full_ref = if let Some(ref rev) = revision {
        validate_revision(rev)?;
        format!("{}:{}", rev, file_path)
    } else {
        format!("HEAD:{}", file_path)
    };

    args.push(&full_ref);

    let output = executor::execute(&repo_path, &args)?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

/// 验证文件路径在仓库目录内（防止路径穿越）
fn validate_file_path(repo_path: &str, file_path: &str) -> Result<std::path::PathBuf, String> {
    // 拒绝包含 .. 的路径
    if file_path.contains("..") {
        return Err("路径包含非法字符".to_string());
    }
    // 拒绝绝对路径
    if std::path::Path::new(file_path).is_absolute() {
        return Err("不允许绝对路径".to_string());
    }
    // 拒绝空路径
    if file_path.trim().is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let repo_canonical = std::fs::canonicalize(repo_path)
        .map_err(|_| "仓库路径无效".to_string())?;
    let full_path = repo_canonical.join(file_path);

    // 规范化路径（处理新文件：只规范化父目录）
    let full_canonical = if full_path.exists() {
        std::fs::canonicalize(&full_path)
            .map_err(|_| "文件路径无效".to_string())?
    } else {
        // 新文件：规范化父目录
        let parent = full_path.parent()
            .ok_or("无法获取父目录".to_string())?;
        let parent_canonical = std::fs::canonicalize(parent)
            .map_err(|_| "父目录不存在".to_string())?;
        let file_name = full_path.file_name()
            .ok_or("无效的文件名".to_string())?;
        parent_canonical.join(file_name)
    };

    // 确保路径在仓库目录内
    if !full_canonical.starts_with(&repo_canonical) {
        return Err("路径超出仓库范围".to_string());
    }

    Ok(full_canonical)
}

/// Max file size for reading into memory (2 MB).
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;

/// Read file with encoding detection — tries UTF-8 first, falls back to GBK.
fn read_file_with_encoding(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("读取文件失败: {}", e))?;

    // Try UTF-8 first (with BOM detection)
    if let Ok(s) = std::str::from_utf8(&bytes) {
        // Strip UTF-8 BOM if present
        return Ok(s.strip_prefix('\u{FEFF}').unwrap_or(s).to_string());
    }

    // Fallback to GBK (common on Windows Chinese systems)
    let (decoded, _, _) = encoding_rs::GBK.decode(&bytes);
    Ok(decoded.into_owned())
}

#[tauri::command]
pub fn read_working_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let full_path = validate_file_path(&repo_path, &file_path)?;
    // Check file size before reading to prevent OOM
    let metadata = std::fs::metadata(&full_path)
        .map_err(|e| format!("读取文件信息失败: {}", e))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "文件过大（{} MB），超过 2 MB 限制，无法在编辑器中打开",
            metadata.len() / 1024 / 1024
        ));
    }
    read_file_with_encoding(&full_path)
}

/// Detect if a file is GBK encoded by checking if valid UTF-8 fails.
/// 只读前 8KB 判断编码，避免读取整个文件浪费内存。
fn detect_encoding(path: &std::path::Path) -> Result<&'static str, String> {
    use std::io::Read;
    const SAMPLE_SIZE: usize = 8192;
    let mut f = std::fs::File::open(path)
        .map_err(|e| format!("读取文件失败（编码检测）: {}", e))?;
    let mut buf = vec![0u8; SAMPLE_SIZE];
    let n = f.read(&mut buf)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    buf.truncate(n);
    if std::str::from_utf8(&buf).is_err() {
        Ok("gbk")
    } else {
        Ok("utf-8")
    }
}

#[tauri::command]
pub fn write_working_file(repo_path: String, file_path: String, content: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let full_path = validate_file_path(&repo_path, &file_path)?;

    // If file exists, detect and preserve original encoding
    if full_path.exists() {
        let encoding = detect_encoding(&full_path)?;
        if encoding == "gbk" {
            let (encoded, _, _) = encoding_rs::GBK.encode(&content);
            std::fs::write(&full_path, encoded.as_ref())
                .map_err(|e| format!("写入文件失败: {}", e))?;
            return Ok("ok".into());
        }
    }

    // Default: write as UTF-8
    std::fs::write(&full_path, &content)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok("ok".into())
}

#[tauri::command]
pub fn git_stage(repo_path: String, files: Vec<String>) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    for file in &files {
        validate_git_file_path(file)?;
    }
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    let mut args = vec!["add"];
    args.extend(file_refs);
    let output = executor::execute(&repo_path, &args)?;
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_unstage(repo_path: String, files: Vec<String>) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    for file in &files {
        validate_git_file_path(file)?;
    }
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    // 对于新增的文件，使用 git rm --cached；对于已跟踪的文件，使用 git reset HEAD
    let mut args = vec!["reset", "HEAD", "--"];
    args.extend(file_refs.clone());
    let output = executor::execute(&repo_path, &args)?;

    // 如果 reset 失败（可能是新增文件），尝试 rm --cached
    if !output.stderr.is_empty() || output.stdout.is_empty() {
        let mut rm_args = vec!["rm", "--cached", "--"];
        rm_args.extend(file_refs);
        if let Err(e) = executor::execute(&repo_path, &rm_args) {
            log::debug!("git rm --cached fallback failed: {}", e);
        }
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_stage_all(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let output = executor::execute(&repo_path, &["add", "-A"])?;
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_branch_delete(repo_path: String, branch: String, force: Option<bool>) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&branch)?;
    // -d 安全删除（检查合并），-D 强制删除
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    let output = executor::execute(&repo_path, &["branch", flag, &branch])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_branch_rename(
    repo_path: String,
    old_name: Option<String>,
    new_name: String,
) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    // 验证分支名防止注入
    validate_ref(&new_name)?;
    if let Some(ref old) = old_name {
        validate_ref(old)?;
    }

    // git branch -m [old] new — 不传 old 表示重命名当前分支
    let mut args: Vec<&str> = vec!["branch", "-m"];
    let old_owned;
    if let Some(ref old) = old_name {
        old_owned = old.clone();
        args.push(&old_owned);
    }
    args.push(&new_name);
    let output = executor::execute(&repo_path, &args)?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_branch_list(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    let output = executor::execute(&repo_path, &["branch", "-a"])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }
    Ok(output.stdout)
}

/// 单个提交中一个文件的变更统计
#[derive(Debug, Serialize)]
pub struct CommitFileChange {
    pub path: String,
    /// M=修改 A=新增 D=删除 R=重命名 C=复制
    pub status: char,
    /// 新增行数；二进制文件为 -1
    pub additions: i64,
    /// 删除行数；二进制文件为 -1
    pub deletions: i64,
}

/// 提交详情 — 元信息 + 文件变更列表
#[derive(Debug, Serialize)]
pub struct CommitDetail {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
    pub parents: Vec<String>,
    pub files: Vec<CommitFileChange>,
}

/// numstat 对重命名/复制显示 "old => new" 或 "dir/{old => new}/rest"
/// 解析出最终的完整路径（新路径）
fn resolve_numstat_path(raw: &str) -> String {
    let raw = raw.trim();
    if !raw.contains("=>") {
        return raw.to_string();
    }
    // 处理 {old => new} 语法
    if let (Some(brace_start), Some(brace_end)) = (raw.find('{'), raw.find('}')) {
        let before = &raw[..brace_start];
        let inside = &raw[brace_start + 1..brace_end];
        let after = &raw[brace_end + 1..];
        let arrow = inside.find("=>").unwrap_or(inside.len());
        let new_part = inside[arrow + 2..].trim();
        return format!("{}{}{}", before, new_part, after);
    }
    // "old => new"
    let arrow = raw.find("=>").unwrap_or(raw.len());
    raw[arrow + 2..].trim().to_string()
}

/// 合并 --name-status（状态+路径）与 --numstat（增删行数）输出
fn parse_commit_files(name_status: &str, numstat: &str) -> Vec<CommitFileChange> {
    let mut stat_map: HashMap<String, (i64, i64)> = HashMap::new();
    for line in numstat.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let add = parts[0].parse::<i64>().unwrap_or(-1);
        let del = parts[1].parse::<i64>().unwrap_or(-1);
        let path = resolve_numstat_path(parts[2]);
        stat_map.insert(path, (add, del));
    }

    let mut files = Vec::new();
    for line in name_status.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.is_empty() {
            continue;
        }
        let status = parts[0].chars().next().unwrap_or('M');
        // rename/copy 有 3 列：R100\told\tnew；普通 2 列：M\tpath
        let path = if parts.len() >= 3 {
            parts[2].to_string()
        } else if parts.len() >= 2 {
            parts[1].to_string()
        } else {
            continue;
        };
        let (add, del) = stat_map.get(&path).copied().unwrap_or((-1, -1));
        files.push(CommitFileChange {
            path,
            status,
            additions: add,
            deletions: del,
        });
    }
    files
}

#[tauri::command]
pub fn get_commit_detail(repo_path: String, hash: String) -> Result<CommitDetail, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_revision(&hash)?;
    // 元信息：用 \0 分隔，%B（完整消息）放最后避免多行干扰
    let meta = executor::execute(
        &repo_path,
        &[
            "show",
            "-s",
            "--format=%H%x00%an%x00%ae%x00%ad%x00%P%x00%B",
            "--date=format:%Y-%m-%d %H:%M:%S",
            &hash,
        ],
    )?;
    let meta_parts: Vec<&str> = meta.stdout.splitn(6, '\0').collect();
    if meta_parts.len() < 6 {
        return Err(format!("无法解析提交 {}", hash));
    }
    let parents: Vec<String> = meta_parts[4]
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    // 文件变更：合并 name-status 和 numstat 为单次调用
    // 使用 --name-status 获取状态，同时用 --numstat 获取增删行数
    // git 不支持同时使用这两个选项，但可以通过 --stat 获取近似信息
    // 或者使用 --name-status 并接受没有增删行数的精确数据
    let ns = executor::execute(&repo_path, &["show", "--name-status", "--format=", &hash])?;
    let stat = executor::execute(&repo_path, &["show", "--numstat", "--format=", &hash])?;
    let files = parse_commit_files(ns.stdout.trim(), stat.stdout.trim());

    Ok(CommitDetail {
        hash: meta_parts[0].to_string(),
        author: meta_parts[1].to_string(),
        email: meta_parts[2].to_string(),
        date: meta_parts[3].to_string(),
        message: meta_parts[5].trim_end().to_string(),
        parents,
        files,
    })
}

#[tauri::command]
pub fn get_commit_file_diff(
    repo_path: String,
    hash: String,
    file: String,
) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_revision(&hash)?;
    validate_git_file_path(&file)?;
    // git show <hash> -- <file> 输出该提交对该文件的 diff（根提交也适用）
    let output = executor::execute(&repo_path, &["show", &hash, "--", &file])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_tag(repo_path: String, tag: String, message: String, target: Option<String>) -> Result<(), String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();
    validate_ref(&tag)?;

    let target_ref = target.as_deref().unwrap_or("HEAD");
    let output = executor::execute(&repo_path, &["tag", "-a", &tag, "-m", &message, target_ref])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Failed to create tag").to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn git_tag_list(repo_path: String) -> Result<String, String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();

    let output = executor::execute(&repo_path, &["tag", "-l"])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Failed to list tags").to_string());
    }
    Ok(output.stdout)
}

#[tauri::command]
pub async fn git_push_tags(repo_path: String) -> Result<(), String> {
    let repo_path = validate_repo_path(&repo_path)?.to_string_lossy().to_string();

    let output = executor::execute(&repo_path, &["push", "origin", "--tags"])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Failed to push tags").to_string());
    }
    Ok(())
}
