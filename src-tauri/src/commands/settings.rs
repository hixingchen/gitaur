use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,              // "light" | "dark"
    pub git_user_name: String,
    pub git_user_email: String,
    pub gitlab_url: String,
    pub gitlab_token: String,
    pub gitee_token: String,
    pub recent_repos: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            git_user_name: String::new(),
            git_user_email: String::new(),
            gitlab_url: "https://gitlab.com".to_string(),
            gitlab_token: String::new(),
            gitee_token: String::new(),
            recent_repos: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn get_default_settings() -> AppSettings {
    AppSettings::default()
}
