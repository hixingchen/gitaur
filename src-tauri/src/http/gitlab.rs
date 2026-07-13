use super::{GitHost, MergeRequest, MrState, Repository, User};
use reqwest::Client;

pub struct GitLabClient {
    client: Client,
    base_url: String,
    token: String,
}

impl GitLabClient {
    pub fn new(base_url: String, token: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
            token,
        }
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api/v4{}", self.base_url.trim_end_matches('/'), path)
    }
}

#[async_trait::async_trait]
impl GitHost for GitLabClient {
    async fn list_merge_requests(
        &self,
        repo: &str,
        state: MrState,
    ) -> Result<Vec<MergeRequest>, String> {
        let encoded_repo = urlencoding::encode(repo);
        let state_str = match state {
            MrState::Opened => "opened",
            MrState::Closed => "closed",
            MrState::Merged => "merged",
            MrState::All => "all",
        };

        let url = self.api_url(&format!(
            "/projects/{}/merge_requests?state={}&per_page=50",
            encoded_repo, state_str
        ));

        let response = self
            .client
            .get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("GitLab API error: {}", response.status()));
        }

        let mrs: Vec<GitLabMr> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(mrs.into_iter().map(|mr| mr.into()).collect())
    }

    async fn list_repositories(&self, search: Option<&str>) -> Result<Vec<Repository>, String> {
        let mut url = self.api_url("/projects?per_page=100&membership=true");
        if let Some(q) = search {
            url.push_str(&format!("&search={}", urlencoding::encode(q)));
        }

        let response = self
            .client
            .get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("GitLab API error: {}", response.status()));
        }

        let repos: Vec<GitLabRepo> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(repos.into_iter().map(|r| r.into()).collect())
    }

    async fn get_current_user(&self) -> Result<User, String> {
        let url = self.api_url("/user");

        let response = self
            .client
            .get(&url)
            .header("PRIVATE-TOKEN", &self.token)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("GitLab API error: {}", response.status()));
        }

        let user: GitLabUser = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(user.into())
    }
}

// GitLab API response types
use serde::Deserialize;

#[derive(Deserialize)]
struct GitLabMr {
    id: u64,
    title: String,
    description: String,
    source_branch: String,
    target_branch: String,
    author: GitLabUser,
    state: String,
    web_url: String,
    created_at: String,
}

impl From<GitLabMr> for MergeRequest {
    fn from(mr: GitLabMr) -> Self {
        MergeRequest {
            id: mr.id,
            title: mr.title,
            description: mr.description,
            source_branch: mr.source_branch,
            target_branch: mr.target_branch,
            author: mr.author.into(),
            state: match mr.state.as_str() {
                "opened" => MrState::Opened,
                "closed" => MrState::Closed,
                "merged" => MrState::Merged,
                _ => MrState::All,
            },
            web_url: mr.web_url,
            created_at: mr.created_at,
        }
    }
}

#[derive(Deserialize)]
struct GitLabRepo {
    id: u64,
    name: String,
    path_with_namespace: String,
    description: Option<String>,
    web_url: String,
    http_url_to_repo: String,
    default_branch: String,
}

impl From<GitLabRepo> for Repository {
    fn from(r: GitLabRepo) -> Self {
        Repository {
            id: r.id,
            name: r.name,
            full_name: r.path_with_namespace,
            description: r.description.unwrap_or_default(),
            web_url: r.web_url,
            clone_url: r.http_url_to_repo,
            default_branch: r.default_branch,
        }
    }
}

#[derive(Deserialize)]
struct GitLabUser {
    id: u64,
    username: String,
    name: String,
    avatar_url: String,
}

impl From<GitLabUser> for User {
    fn from(u: GitLabUser) -> Self {
        User {
            id: u.id,
            username: u.username,
            name: u.name,
            avatar_url: u.avatar_url,
        }
    }
}
