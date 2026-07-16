import { invoke } from '@tauri-apps/api/core';

export interface GitLabConfig {
  url: string;
  token: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string | null;
  description?: string | null;
  state: string | null;
  source_branch: string | null;
  target_branch: string | null;
  author?: GitLabUser | null;
  assignees?: GitLabUser[] | null;
  reviewers?: GitLabUser[] | null;
  web_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  merged_at?: string | null;
  labels?: string[] | null;
  work_in_progress?: boolean;
  blocking_discussions_resolved?: boolean;
  merge_status?: string | null;
  detailed_merge_status?: string | null;
  user_notes_count?: number;
  approvals_required?: number;
  approvals_left?: number;
}

export interface GitLabUser {
  id: number;
  username?: string | null;
  name?: string | null;
  avatar_url?: string | null;
}

export interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  updated_at: string;
  system: boolean;
  resolvable: boolean;
  resolved: boolean | null;
}

export interface CreateMergeRequestParams {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  assignee_ids?: number[];
  reviewer_ids?: number[];
  labels?: string[];
  remove_source_branch?: boolean;
  squash?: boolean;
  squash_commit_message?: string;
  merge_when_pipeline_succeeds?: boolean;
}

export interface UpdateMergeRequestParams {
  title?: string;
  description?: string;
  target_branch?: string;
  assignee_ids?: number[];
  reviewer_ids?: number[];
  labels?: string[];
  remove_source_branch?: boolean;
  state_event?: 'close' | 'reopen';
}

export class GitLabService {
  private config: GitLabConfig;

  constructor(config: GitLabConfig) {
    this.config = { ...config, url: config.url.replace(/\/+$/, '') };
  }

  // ========== Projects ==========

  async searchProjects(query: string): Promise<GitLabProject[]> {
    return invoke<GitLabProject[]>('gitlab_search_projects', {
      baseUrl: this.config.url,
      token: this.config.token,
      query,
    });
  }

  // ========== Merge Requests ==========

  async getMergeRequests(
    projectId: string,
    state: 'opened' | 'closed' | 'merged' | 'all' = 'opened'
  ): Promise<GitLabMergeRequest[]> {
    return invoke<GitLabMergeRequest[]>('gitlab_list_merge_requests', {
      baseUrl: this.config.url,
      token: this.config.token,
      projectId,
      state,
    });
  }

  async getMergeRequest(projectId: string, mrIid: number): Promise<GitLabMergeRequest> {
    const url = `${this.config.url}/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`;
    return invoke<GitLabMergeRequest>('gitlab_request', {
      url,
      token: this.config.token,
      method: 'GET',
      body: null,
    });
  }

  async createMergeRequest(
    projectId: string,
    params: CreateMergeRequestParams
  ): Promise<GitLabMergeRequest> {
    return invoke<GitLabMergeRequest>('gitlab_create_merge_request', {
      baseUrl: this.config.url,
      token: this.config.token,
      projectId,
      params,
    });
  }

  async updateMergeRequest(
    projectId: string,
    mrIid: number,
    params: UpdateMergeRequestParams
  ): Promise<GitLabMergeRequest> {
    const url = `${this.config.url}/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`;
    return invoke<GitLabMergeRequest>('gitlab_request', {
      url,
      token: this.config.token,
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async mergeMergeRequest(
    projectId: string,
    mrIid: number,
    options?: {
      squash?: boolean;
      should_remove_source_branch?: boolean;
      squash_commit_message?: string;
      commit_message?: string;
    }
  ): Promise<GitLabMergeRequest> {
    return invoke<GitLabMergeRequest>('gitlab_merge_merge_request', {
      baseUrl: this.config.url,
      token: this.config.token,
      projectId,
      mrIid,
      squash: options?.squash,
      removeSourceBranch: options?.should_remove_source_branch,
      squashCommitMessage: options?.squash_commit_message,
      commitMessage: options?.commit_message,
    });
  }

  async closeMergeRequest(projectId: string, mrIid: number): Promise<GitLabMergeRequest> {
    return this.updateMergeRequest(projectId, mrIid, { state_event: 'close' });
  }

  async reopenMergeRequest(projectId: string, mrIid: number): Promise<GitLabMergeRequest> {
    return this.updateMergeRequest(projectId, mrIid, { state_event: 'reopen' });
  }

  // ========== Approvals ==========

  async approveMergeRequest(projectId: string, mrIid: number): Promise<Record<string, unknown>> {
    return invoke('gitlab_approve_merge_request', {
      baseUrl: this.config.url,
      token: this.config.token,
      projectId,
      mrIid,
    });
  }

  // ========== Notes (Comments) ==========

  async getNotes(projectId: string, mrIid: number): Promise<GitLabNote[]> {
    return invoke<GitLabNote[]>('gitlab_get_notes', {
      baseUrl: this.config.url,
      token: this.config.token,
      projectId,
      mrIid,
    });
  }

  async createNote(projectId: string, mrIid: number, body: string): Promise<GitLabNote> {
    return invoke<GitLabNote>('gitlab_create_note', {
      baseUrl: this.config.url,
      token: this.config.token,
      projectId,
      mrIid,
      body,
    });
  }
}
