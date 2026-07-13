use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLabProject {
    pub id: u64,
    pub name: String,
    pub name_with_namespace: String,
    pub path: String,
    pub path_with_namespace: String,
    pub default_branch: String,
    pub web_url: String,
    pub http_url_to_repo: String,
    pub ssh_url_to_repo: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLabMergeRequest {
    pub id: u64,
    pub iid: u64,
    pub project_id: u64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub source_branch: Option<String>,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub author: Option<GitLabUser>,
    #[serde(default)]
    pub assignees: Option<Vec<GitLabUser>>,
    #[serde(default)]
    pub reviewers: Option<Vec<GitLabUser>>,
    #[serde(default)]
    pub web_url: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    pub merged_at: Option<String>,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
    #[serde(default)]
    pub work_in_progress: Option<bool>,
    #[serde(default)]
    pub blocking_discussions_resolved: Option<bool>,
    #[serde(default)]
    pub merge_status: Option<String>,
    #[serde(default)]
    pub detailed_merge_status: Option<String>,
    #[serde(default)]
    pub user_notes_count: Option<u64>,
    #[serde(default)]
    pub approvals_required: Option<u64>,
    #[serde(default)]
    pub approvals_left: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLabUser {
    pub id: u64,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLabNote {
    pub id: u64,
    pub body: String,
    pub author: GitLabUser,
    pub created_at: String,
    pub updated_at: String,
    pub system: bool,
    pub resolvable: bool,
    pub resolved: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateMergeRequestParams {
    pub source_branch: String,
    pub target_branch: String,
    pub title: String,
    pub description: Option<String>,
    pub assignee_ids: Option<Vec<u64>>,
    pub reviewer_ids: Option<Vec<u64>>,
    pub labels: Option<Vec<String>>,
    pub remove_source_branch: Option<bool>,
    pub squash: Option<bool>,
}

#[tauri::command]
pub async fn gitlab_request(
    url: String,
    token: String,
    method: String,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = Client::new();

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    request = request.header("PRIVATE-TOKEN", &token);

    if let Some(body_str) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body_str);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab API error ({}): {}", status, error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(json)
}

#[tauri::command]
pub async fn gitlab_list_merge_requests(
    base_url: String,
    token: String,
    project_id: String,
    state: String,
) -> Result<Vec<GitLabMergeRequest>, String> {
    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests?state={}&per_page=50",
        base_url.trim_end_matches('/'),
        encoded_project,
        state
    );

    let client = Client::new();
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", &token)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitLab API error: {}", response.status()));
    }

    let mrs: Vec<GitLabMergeRequest> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(mrs)
}

#[tauri::command]
pub async fn gitlab_create_merge_request(
    base_url: String,
    token: String,
    project_id: String,
    params: CreateMergeRequestParams,
) -> Result<GitLabMergeRequest, String> {
    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests",
        base_url.trim_end_matches('/'),
        encoded_project
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .header("PRIVATE-TOKEN", &token)
        .json(&params)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("GitLab API error: {}", response_text));
    }

    let mr: GitLabMergeRequest = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(mr)
}

#[derive(Serialize)]
struct MergeRequestMergeBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    squash: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    should_remove_source_branch: Option<bool>,
}

#[tauri::command]
pub async fn gitlab_merge_merge_request(
    base_url: String,
    token: String,
    project_id: String,
    mr_iid: u64,
    squash: Option<bool>,
    remove_source_branch: Option<bool>,
) -> Result<GitLabMergeRequest, String> {
    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/merge",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let body = MergeRequestMergeBody {
        squash,
        should_remove_source_branch: remove_source_branch,
    };

    let client = Client::new();
    let response = client
        .put(&url)
        .header("PRIVATE-TOKEN", &token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab API error: {}", error_text));
    }

    let mr: GitLabMergeRequest = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(mr)
}

#[tauri::command]
pub async fn gitlab_approve_merge_request(
    base_url: String,
    token: String,
    project_id: String,
    mr_iid: u64,
) -> Result<serde_json::Value, String> {
    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/approve",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .header("PRIVATE-TOKEN", &token)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab API error: {}", error_text));
    }

    let result: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(result)
}

#[tauri::command]
pub async fn gitlab_get_notes(
    base_url: String,
    token: String,
    project_id: String,
    mr_iid: u64,
) -> Result<Vec<GitLabNote>, String> {
    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/notes?per_page=100",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let client = Client::new();
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", &token)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitLab API error: {}", response.status()));
    }

    let notes: Vec<GitLabNote> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(notes)
}

#[tauri::command]
pub async fn gitlab_create_note(
    base_url: String,
    token: String,
    project_id: String,
    mr_iid: u64,
    body: String,
) -> Result<GitLabNote, String> {
    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/notes",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let note_body = serde_json::json!({ "body": body });

    let client = Client::new();
    let response = client
        .post(&url)
        .header("PRIVATE-TOKEN", &token)
        .json(&note_body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab API error: {}", error_text));
    }

    let note: GitLabNote = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(note)
}

#[tauri::command]
pub async fn gitlab_search_projects(
    base_url: String,
    token: String,
    query: String,
) -> Result<Vec<GitLabProject>, String> {
    let url = format!(
        "{}/api/v4/projects?search={}&per_page=20",
        base_url.trim_end_matches('/'),
        urlencoding::encode(&query)
    );

    let client = Client::new();
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", &token)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitLab API error: {}", response.status()));
    }

    let projects: Vec<GitLabProject> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(projects)
}
