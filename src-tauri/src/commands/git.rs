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

#[derive(Debug, Serialize)]
pub struct DiffResult {
    pub raw_diff: String,
    pub files_changed: Vec<String>,
}

#[tauri::command]
pub fn get_diff(repo_path: String, file: Option<String>, staged: Option<bool>) -> Result<DiffResult, String> {
    let mut args = vec!["diff"];
    if staged.unwrap_or(false) {
        args = vec!["diff", "--cached"];
    }
    args.push("--");
    if let Some(ref f) = file {
        args.push(f);
    }

    let output = executor::execute(&repo_path, &args)?;

    let files_changed = output
        .stdout
        .lines()
        .filter(|l| l.starts_with("diff --git"))
        .map(|l| {
            l.split_whitespace()
                .nth(3)
                .unwrap_or("")
                .trim_start_matches("b/")
                .to_string()
        })
        .collect();

    Ok(DiffResult {
        raw_diff: output.stdout,
        files_changed,
    })
}

#[derive(Debug, Deserialize)]
pub struct CommitParams {
    pub message: String,
    pub files: Vec<String>,
    pub amend: Option<bool>,
}

#[tauri::command]
pub fn git_commit(repo_path: String, params: CommitParams) -> Result<String, String> {
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
    validate_ref(&target)?;
    let mut args: Vec<&str> = vec!["checkout"];

    if create_branch.unwrap_or(false) {
        args.push("-b");
    }

    args.push(&target);

    // 创建分支时可选指定起点（如 origin/feature），用于建立跟踪关系
    let sp_owned;
    if let Some(ref sp) = start_point {
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
    let remote = remote.unwrap_or_else(|| "origin".to_string());

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
    let remote = remote.unwrap_or_else(|| "origin".to_string());
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
) -> Result<Vec<LogEntry>, String> {
    let count = max_count.unwrap_or(100).to_string();
    let mut args: Vec<&str> = vec![
        "log",
        "--all",
        "--format=%H%x00%P%x00%an%x00%ae%x00%ad%x00%s%x00%d",
        "--date=format:%Y-%m-%d %H:%M:%S",
        "--max-count",
        &count,
    ];

    let branch_str;
    if let Some(ref b) = branch {
        branch_str = b.clone();
        args.push(&branch_str);
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

#[tauri::command]
pub fn git_merge(repo_path: String, branch: String, no_ff: Option<bool>) -> Result<String, String> {
    validate_ref(&branch)?;
    let mut args: Vec<&str> = vec!["merge", &branch];
    if no_ff.unwrap_or(false) { args.push("--no-ff"); }
    let output = executor::execute(&repo_path, &args)?;
    Ok(format!("{}\n{}", output.stdout, output.stderr))
}

#[tauri::command]
pub fn git_rebase(repo_path: String, onto: String) -> Result<String, String> {
    validate_ref(&onto)?;
    let output = executor::execute(&repo_path, &["rebase", &onto])?;
    Ok(format!("{}\n{}", output.stdout, output.stderr))
}

#[tauri::command]
pub fn git_abort_rebase(repo_path: String) -> Result<String, String> {
    let output = executor::execute(&repo_path, &["rebase", "--abort"])?;
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_rebase_continue(repo_path: String) -> Result<String, String> {
    let output = executor::execute(&repo_path, &["rebase", "--continue"])?;
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_sync(repo_path: String) -> Result<String, String> {
    let _fetch = executor::execute(&repo_path, &["fetch", "origin"])?;
    let output = executor::execute(&repo_path, &["pull", "--rebase", "origin"])?;
    Ok(format!("{}\n{}", output.stdout, output.stderr))
}

#[derive(Debug, Serialize)]
pub struct ConflictInfo {
    pub has_conflicts: bool,
    pub conflicted_files: Vec<String>,
}

#[tauri::command]
pub fn check_conflicts(repo_path: String) -> Result<ConflictInfo, String> {
    let status_out = executor::execute(&repo_path, &["status", "--porcelain"])?;
    let conflicted: Vec<String> = status_out.stdout.lines()
        .filter(|l| l.starts_with("UU") || l.starts_with("AA") || l.starts_with("DD"))
        .map(|l| l[3..].trim().to_string())
        .collect();
    let rebase_dir = std::path::Path::new(&repo_path).join(".git/rebase-merge");
    let rebase_apply = std::path::Path::new(&repo_path).join(".git/rebase-apply");
    Ok(ConflictInfo {
        has_conflicts: !conflicted.is_empty() || rebase_dir.exists() || rebase_apply.exists(),
        conflicted_files: conflicted,
    })
}

#[tauri::command]
pub fn git_clone(url: String, target_path: String) -> Result<String, String> {
    let output = executor::execute(".", &["clone", &url, &target_path])?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_init(path: String) -> Result<String, String> {
    let output = executor::execute(&path, &["init"])?;

    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn get_file_content(repo_path: String, file_path: String, revision: Option<String>) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["show"];

    let full_ref = if let Some(ref rev) = revision {
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

#[tauri::command]
pub fn read_working_file(repo_path: String, file_path: String) -> Result<String, String> {
    let full_path = validate_file_path(&repo_path, &file_path)?;
    std::fs::read_to_string(&full_path)
        .map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub fn write_working_file(repo_path: String, file_path: String, content: String) -> Result<String, String> {
    let full_path = validate_file_path(&repo_path, &file_path)?;
    std::fs::write(&full_path, &content)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok("ok".into())
}

#[tauri::command]
pub fn git_stage(repo_path: String, files: Vec<String>) -> Result<String, String> {
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    let mut args = vec!["add"];
    args.extend(file_refs);
    let output = executor::execute(&repo_path, &args)?;
    Ok(output.stdout)
}

#[tauri::command]
pub fn git_unstage(repo_path: String, files: Vec<String>) -> Result<String, String> {
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    // 对于新增的文件，使用 git rm --cached；对于已跟踪的文件，使用 git reset HEAD
    let mut args = vec!["reset", "HEAD", "--"];
    args.extend(file_refs.clone());
    let output = executor::execute(&repo_path, &args)?;

    // 如果 reset 失败（可能是新增文件），尝试 rm --cached
    if !output.stderr.is_empty() || output.stdout.is_empty() {
        let mut rm_args = vec!["rm", "--cached", "--"];
        rm_args.extend(file_refs);
        let _ = executor::execute(&repo_path, &rm_args);
    }

    Ok(output.stdout)
}

#[tauri::command]
pub fn git_stage_all(repo_path: String) -> Result<String, String> {
    let output = executor::execute(&repo_path, &["add", "-A"])?;
    Ok(output.stdout)
}

#[derive(Debug, Serialize)]
pub struct RemoteSyncInfo {
    pub ahead: usize,
    pub behind: usize,
    pub remote_branch: String,
    pub ahead_commits: Vec<LogEntry>,
    pub behind_commits: Vec<LogEntry>,
}

#[tauri::command]
pub fn get_remote_sync(repo_path: String) -> Result<RemoteSyncInfo, String> {
    let _branch_out = executor::execute(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;

    // 获取上游分支，如果没有则返回空
    let remote_branch = match executor::execute(&repo_path, &["rev-parse", "--abbrev-ref", "@{upstream}"]) {
        Ok(o) => o.stdout.trim().to_string(),
        Err(_) => return Ok(RemoteSyncInfo { ahead: 0, behind: 0, remote_branch: String::new(), ahead_commits: vec![], behind_commits: vec![] }),
    };

    if remote_branch.is_empty() {
        return Ok(RemoteSyncInfo { ahead: 0, behind: 0, remote_branch: String::new(), ahead_commits: vec![], behind_commits: vec![] });
    }

    let mut ahead: Vec<LogEntry> = Vec::new();
    if let Ok(o) = executor::execute(
        &repo_path,
        &["log", "--format=%H%x00%an%x00%ad%x00%s", "--date=format:%m-%d %H:%M", "@{upstream}..HEAD"],
    ) {
        for line in o.stdout.lines() {
            let p: Vec<&str> = line.split('\0').collect();
            if p.len() >= 4 { ahead.push(LogEntry { hash: p[0].into(), author: p[1].into(), email: String::new(), date: p[2].into(), message: p[3].into(), refs: vec![], parents: vec![] }); }
        }
    }

    let mut behind: Vec<LogEntry> = Vec::new();
    if let Ok(o) = executor::execute(
        &repo_path,
        &["log", "--format=%H%x00%an%x00%ad%x00%s", "--date=format:%m-%d %H:%M", "HEAD..@{upstream}"],
    ) {
        for line in o.stdout.lines() {
            let p: Vec<&str> = line.split('\0').collect();
            if p.len() >= 4 { behind.push(LogEntry { hash: p[0].into(), author: p[1].into(), email: String::new(), date: p[2].into(), message: p[3].into(), refs: vec![], parents: vec![] }); }
        }
    }

    Ok(RemoteSyncInfo { ahead: ahead.len(), behind: behind.len(), remote_branch, ahead_commits: ahead, behind_commits: behind })
}

#[tauri::command]
pub fn git_branch_delete(repo_path: String, branch: String, force: Option<bool>) -> Result<String, String> {
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

    // 文件变更：name-status 给状态，numstat 给增删行数
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
    // git show <hash> -- <file> 输出该提交对该文件的 diff（根提交也适用）
    let output = executor::execute(&repo_path, &["show", &hash, "--", &file])?;
    if !output.is_success() {
        return Err(output.error_message().unwrap_or("Unknown error").to_string());
    }
    Ok(output.stdout)
}
