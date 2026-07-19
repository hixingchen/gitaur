mod commands;
mod git;
mod watcher;

use commands::{git::*, gitlab::*, repo::*};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Git commands
            get_repo_status,
            git_commit,
            git_checkout,
            git_push,
            git_pull,
            git_fetch,
            get_log,
            git_clone,
            get_file_content,
            git_merge,
            git_rebase,
            git_abort_rebase,
            git_rebase_continue,
            git_merge_abort,
            check_rebase_state,
            check_conflicts,
            read_working_file,
            write_working_file,
            git_stage,
            git_unstage,
            git_stage_all,
            git_branch_delete,
            git_branch_rename,
            git_branch_list,
            get_commit_detail,
            get_commit_file_diff,
            git_tag,
            git_tag_list,
            git_push_tags,
            git_log_find_by_message,
            git_collect_messages,
            git_find_latest_non_merge_commit,
            // Repo commands
            validate_repo_path,
            start_file_watcher,
            stop_file_watcher,
            // GitLab
            gitlab_request,
            gitlab_list_merge_requests,
            gitlab_create_merge_request,
            gitlab_merge_merge_request,
            gitlab_approve_merge_request,
            gitlab_get_notes,
            gitlab_create_note,
            gitlab_search_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
