use super::{GitHost, MergeRequest, MrState, Repository, User};
use reqwest::Client;

pub struct GiteeClient {
    client: Client,
    token: String,
}

impl GiteeClient {
    pub fn new(token: String) -> Self {
        Self {
            client: Client::new(),
            token,
        }
    }
}

#[async_trait::async_trait]
impl GitHost for GiteeClient {
    async fn list_merge_requests(
        &self,
        repo: &str,
        state: MrState,
    ) -> Result<Vec<MergeRequest>, String> {
        let state_str = match state {
            MrState::Opened => "open",
            MrState::Closed => "closed",
            MrState::Merged => "merged",
            MrState::All => "all",
        };

        let url = format!(
            "https://gitee.com/api/v5/repos/{}/pulls?state={}&per_page=50",
            repo, state_str
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Gitee API error: {}", response.status()));
        }

        let prs: Vec<GiteePr> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(prs.into_iter().map(|pr| pr.into()).collect())
    }

    async fn list_repositories(&self, search: Option<&str>) -> Result<Vec<Repository>, String> {
        let mut url = "https://gitee.com/api/v5/user/repos?per_page=100&type=all".to_string();
        if let Some(q) = search {
            url.push_str(&format!("&q={}", urlencoding::encode(q)));
        }

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Gitee API error: {}", response.status()));
        }

        let repos: Vec<GiteeRepo> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(repos.into_iter().map(|r| r.into()).collect())
    }

    async fn get_current_user(&self) -> Result<User, String> {
        let url = "https://gitee.com/api/v5/user";

        let response = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Gitee API error: {}", response.status()));
        }

        let user: GiteeUser = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(user.into())
    }
}

use serde::Deserialize;

#[derive(Deserialize)]
struct GiteePr {
    id: u64,
    title: String,
    body: Option<String>,
    head: GiteeBranchRef,
    base: GiteeBranchRef,
    user: GiteeUser,
    state: String,
    html_url: String,
    created_at: String,
}

impl From<GiteePr> for MergeRequest {
    fn from(pr: GiteePr) -> Self {
        MergeRequest {
            id: pr.id,
            title: pr.title,
            description: pr.body.unwrap_or_default(),
            source_branch: pr.head.ref_name,
            target_branch: pr.base.ref_name,
            author: pr.user.into(),
            state: match pr.state.as_str() {
                "open" => MrState::Opened,
                "closed" => MrState::Closed,
                "merged" => MrState::Merged,
                _ => MrState::All,
            },
            web_url: pr.html_url,
            created_at: pr.created_at,
        }
    }
}

#[derive(Deserialize)]
struct GiteeBranchRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Deserialize)]
struct GiteeRepo {
    id: u64,
    name: String,
    full_name: String,
    description: Option<String>,
    html_url: String,
    clone_url: String,
    default_branch: String,
}

impl From<GiteeRepo> for Repository {
    fn from(r: GiteeRepo) -> Self {
        Repository {
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            description: r.description.unwrap_or_default(),
            web_url: r.html_url,
            clone_url: r.clone_url,
            default_branch: r.default_branch,
        }
    }
}

#[derive(Deserialize)]
struct GiteeUser {
    id: u64,
    login: String,
    name: String,
    avatar_url: String,
}

impl From<GiteeUser> for User {
    fn from(u: GiteeUser) -> Self {
        User {
            id: u.id,
            username: u.login,
            name: u.name,
            avatar_url: u.avatar_url,
        }
    }
}
