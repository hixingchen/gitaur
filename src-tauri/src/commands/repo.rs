use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    pub path: String,
    pub name: String,
    pub added_at: String,
}

#[tauri::command]
pub fn validate_repo_path(path: String) -> Result<bool, String> {
    let git_dir = Path::new(&path).join(".git");
    Ok(git_dir.exists() && git_dir.is_dir())
}

#[tauri::command]
pub fn get_repo_name(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    p.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}
