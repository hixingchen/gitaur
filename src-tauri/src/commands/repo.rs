use std::path::Path;
use tauri::AppHandle;

#[tauri::command]
pub fn validate_repo_path(path: String) -> Result<bool, String> {
    let git_dir = Path::new(&path).join(".git");
    Ok(git_dir.exists() && git_dir.is_dir())
}

#[tauri::command]
pub fn start_file_watcher(app: AppHandle, repo_path: String) -> Result<(), String> {
    crate::watcher::start_watching(app, &repo_path)
}

#[tauri::command]
pub fn stop_file_watcher() {
    crate::watcher::stop_watching()
}
