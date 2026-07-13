pub mod gitlab;
pub mod gitee;

use serde::{Deserialize, Serialize};

/// Common trait for Git hosting platforms
#[async_trait::async_trait]
pub trait GitHost: Send + Sync {
    async fn list_merge_requests(
        &self,
        repo: &str,
        state: MrState,
    ) -> Result<Vec<MergeRequest>, String>;

    async fn list_repositories(&self, search: Option<&str>) -> Result<Vec<Repository>, String>;

    async fn get_current_user(&self) -> Result<User, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeRequest {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub source_branch: String,
    pub target_branch: String,
    pub author: User,
    pub state: MrState,
    pub web_url: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub description: String,
    pub web_url: String,
    pub clone_url: String,
    pub default_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: u64,
    pub username: String,
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MrState {
    Opened,
    Closed,
    Merged,
    All,
}
