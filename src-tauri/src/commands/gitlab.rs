use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

/// 检查 IP 是否属于内网/保留地址（统一入口，字符串匹配 + 解析双重保障）
fn is_private_ip(addr: &std::net::IpAddr) -> bool {
    match addr {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64)  // 100.64.0.0/10 CGNAT
                || (v4.octets()[0] == 172 && (v4.octets()[1] >= 16 && v4.octets()[1] <= 31))  // 172.16/12
                || (v4.octets()[0] == 192 && v4.octets()[1] == 2 && v4.octets()[2] == 1)    // 192.0.2.0/24
                || (v4.octets()[0] == 198 && v4.octets()[1] == 51 && v4.octets()[2] == 100) // 198.51.100.0/24
                || (v4.octets()[0] == 203 && v4.octets()[1] == 0 && v4.octets()[2] == 113)  // 203.0.113.0/24
                || v4.octets()[0] >= 224  // multicast+
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xffc0) == 0xfe80  // fe80::/10 link-local
                || (v6.segments()[0] & 0xfe00) == 0xfc00  // fc00::/7 ULA
        }
    }
}

/// Validate that a URL points to an external HTTP(S) host (not localhost/internal IPs).
/// Prevents SSRF attacks. Also called from git module for clone URL validation.
/// 防御三层：1) 字符串匹配 2) IP 解析 3) DNS 解析（防 DNS 重绑定）
pub(crate) fn validate_external_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| format!("Invalid URL: {}", e))?;

    // Only allow HTTP/HTTPS
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("不允许的协议: {}，仅支持 http/https", scheme)),
    }

    // Block localhost and internal IPs
    if let Some(host) = parsed.host_str() {
        let lower = host.to_lowercase();

        // Strip IPv6 brackets: [::1] → ::1, [::ffff:10.1.2.3] → ::ffff:10.1.2.3
        let unbracketed = lower.trim_start_matches('[').trim_end_matches(']');

        // Strip IPv6-mapped prefix: ::ffff:127.0.0.1 → 127.0.0.1
        let normalized = unbracketed.strip_prefix("::ffff:").unwrap_or(unbracketed);

        // IPv4 private/special ranges
        if normalized == "localhost"
            || normalized.starts_with("127.")
            || normalized == "0.0.0.0"
            || normalized.starts_with("169.254.")
            || normalized.starts_with("10.")
            || normalized.starts_with("192.168.")
            || normalized.starts_with("100.64.")   // CGNAT 100.64.0.0/10
            || normalized.starts_with("192.0.2.")   // TEST-NET-1
            || normalized.starts_with("198.51.100.") // TEST-NET-2
            || normalized.starts_with("203.0.113.")  // TEST-NET-3
        {
            return Err("不允许访问内部网络地址".to_string());
        }

        // 172.16.0.0/12 (172.16.x.x ~ 172.31.x.x)
        if normalized.starts_with("172.") {
            if let Some(second) = normalized.split('.').nth(1) {
                if let Ok(n) = second.parse::<u8>() {
                    if (16..=31).contains(&n) {
                        return Err("不允许访问内部网络地址".to_string());
                    }
                }
            }
        }

        // 100.64.0.0/10 (100.64.x.x ~ 100.127.x.x)
        if normalized.starts_with("100.") {
            if let Some(second) = normalized.split('.').nth(1) {
                if let Ok(n) = second.parse::<u8>() {
                    if (64..=127).contains(&n) {
                        return Err("不允许访问内部网络地址".to_string());
                    }
                }
            }
        }

        // IPv6 private/special ranges — 使用标准库做可靠判断
        if let Ok(ipv6) = normalized.parse::<std::net::Ipv6Addr>() {
            if ipv6.is_loopback()            // ::1
                || ipv6.is_unspecified()     // ::
                || (ipv6.segments()[0] & 0xffc0) == 0xfe80  // fe80::/10 link-local
                || (ipv6.segments()[0] & 0xfe00) == 0xfc00  // fc00::/7 ULA
            {
                return Err("不允许访问内部网络地址".to_string());
            }
        }
        // 兜底：字符串匹配处理无法解析的 IPv6 格式
        if normalized == "::1"
            || normalized.starts_with("fe80:")
            || normalized.starts_with("fc") || normalized.starts_with("fd")
        {
            return Err("不允许访问内部网络地址".to_string());
        }

        // 第三层防御：DNS 解析验证（防 DNS 重绑定 + 替代 IP 表示如八进制/十进制）
        // 先尝试直接解析为 IP，再做 DNS 查询
        if let Ok(ip) = normalized.parse::<std::net::IpAddr>() {
            if is_private_ip(&ip) {
                return Err("不允许访问内部网络地址".to_string());
            }
        } else {
            // 非 IP 字面量 — 做 DNS 解析检查
            use std::net::ToSocketAddrs;
            let host_with_port = format!("{}:80", host);
            if let Ok(addrs) = host_with_port.to_socket_addrs() {
                for addr in addrs {
                    if is_private_ip(&addr.ip()) {
                        log::warn!("域名解析到内网地址: {}", addr.ip());
                        return Err("域名解析到内网地址，请求已阻止".to_string());
                    }
                }
            }
            // DNS 解析失败不阻止请求（可能是网络问题，由后续 HTTP 请求报错）
        }
    }

    Ok(())
}

/// Shared HTTP client with connection pooling and timeout.
/// Avoids creating a new Client per request.
/// 初始化失败时 fallback 到基础 Client，不会 panic。
fn http_client() -> Result<&'static Client, String> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(4)
            .redirect(reqwest::redirect::Policy::none()) // 禁止自动跟随重定向，防止 SSRF 绕过
            .build()
            .unwrap_or_else(|e| {
                log::error!("Failed to create configured HTTP client: {}, using default", e);
                Client::new()
            })
    });
    CLIENT.get().ok_or_else(|| "HTTP 客户端初始化失败".to_string())
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub squash: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub squash_commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_when_pipeline_succeeds: Option<bool>,
}

#[tauri::command]
pub async fn gitlab_request(
    url: String,
    token: String,
    method: String,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    // Validate URL to prevent SSRF
    validate_external_url(&url)?;

    let client = http_client()?;

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
        log::error!("GitLab API error ({}): {}", status, error_text);
        return Err(format!("GitLab 请求失败 (HTTP {})", status));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(json)
}

/// Validate MR state parameter — only allow known GitLab states.
fn validate_mr_state(state: &str) -> Result<(), String> {
    match state {
        "opened" | "closed" | "merged" | "all" => Ok(()),
        _ => Err(format!("无效的 MR 状态: {}", state)),
    }
}

#[tauri::command]
pub async fn gitlab_list_merge_requests(
    base_url: String,
    token: String,
    project_id: String,
    state: String,
) -> Result<Vec<GitLabMergeRequest>, String> {
    // Validate state parameter
    validate_mr_state(&state)?;
    // Validate base_url to prevent SSRF
    validate_external_url(&base_url)?;

    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests?state={}&per_page=50",
        base_url.trim_end_matches('/'),
        encoded_project,
        state
    );

    let response = http_client()?
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
    validate_external_url(&base_url)?;

    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests",
        base_url.trim_end_matches('/'),
        encoded_project
    );

    // 对分支名进行 URL 编码，处理中文字符
    let encoded_params = serde_json::json!({
        "source_branch": params.source_branch,
        "target_branch": params.target_branch,
        "title": params.title,
        "description": params.description,
        "assignee_ids": params.assignee_ids,
        "reviewer_ids": params.reviewer_ids,
        "labels": params.labels,
        "remove_source_branch": params.remove_source_branch,
        "squash": params.squash,
        "squash_commit_message": params.squash_commit_message,
        "merge_when_pipeline_succeeds": params.merge_when_pipeline_succeeds,
    });

    let response = http_client()?
        .post(&url)
        .header("PRIVATE-TOKEN", &token)
        .header("Content-Type", "application/json; charset=utf-8")
        .body(encoded_params.to_string())
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("GitLab API error ({}): {}", status, error_text);
        return Err(format!("GitLab 请求失败 (HTTP {})", status));
    }

    let mr: GitLabMergeRequest = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(mr)
}

#[derive(Serialize)]
struct MergeRequestMergeBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    squash: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    should_remove_source_branch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    squash_commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    commit_message: Option<String>,
}

#[tauri::command]
pub async fn gitlab_merge_merge_request(
    base_url: String,
    token: String,
    project_id: String,
    mr_iid: u64,
    squash: Option<bool>,
    remove_source_branch: Option<bool>,
    squash_commit_message: Option<String>,
    commit_message: Option<String>,
) -> Result<GitLabMergeRequest, String> {
    validate_external_url(&base_url)?;

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
        squash_commit_message,
        commit_message,
    };

    let response = http_client()?
        .put(&url)
        .header("PRIVATE-TOKEN", &token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("GitLab API error ({}): {}", status, error_text);
        return Err(format!("GitLab 请求失败 (HTTP {})", status));
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
    validate_external_url(&base_url)?;

    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/approve",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let response = http_client()?
        .post(&url)
        .header("PRIVATE-TOKEN", &token)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("GitLab API error ({}): {}", status, error_text);
        return Err(format!("GitLab 请求失败 (HTTP {})", status));
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
    validate_external_url(&base_url)?;

    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/notes?per_page=100",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let response = http_client()?
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
    validate_external_url(&base_url)?;

    let encoded_project = urlencoding::encode(&project_id);
    let url = format!(
        "{}/api/v4/projects/{}/merge_requests/{}/notes",
        base_url.trim_end_matches('/'),
        encoded_project,
        mr_iid
    );

    let note_body = serde_json::json!({ "body": body });

    let response = http_client()?
        .post(&url)
        .header("PRIVATE-TOKEN", &token)
        .json(&note_body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("GitLab API error ({}): {}", status, error_text);
        return Err(format!("GitLab 请求失败 (HTTP {})", status));
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
    validate_external_url(&base_url)?;

    let url = format!(
        "{}/api/v4/projects?search={}&per_page=20",
        base_url.trim_end_matches('/'),
        urlencoding::encode(&query)
    );

    let response = http_client()?
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
