/** A single file's status from git status --porcelain */
export interface FileStatus {
  path: string;
  /** M=modified, A=added, D=deleted, R=renamed, ?=untracked */
  status: string;
  /** Whether this change is staged (in index) */
  staged: boolean;
}

/** A git branch */
export interface Branch {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** A single commit log entry */
export interface LogEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  refs: string[];
  parents: string[];
}

/** 单个提交中一个文件的变更统计 */
export interface CommitFileChange {
  path: string;
  /** M=修改 A=新增 D=删除 R=重命名 C=复制 */
  status: string;
  /** 新增行数；二进制文件为 -1 */
  additions: number;
  /** 删除行数；二进制文件为 -1 */
  deletions: number;
}

/** 提交详情 — 元信息 + 文件变更列表 */
export interface CommitDetail {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  parents: string[];
  files: CommitFileChange[];
}

/** Full repository status info returned by get_repo_status */
export interface RepoInfo {
  path: string;
  branches: Branch[];
  currentBranch: string;
  status: FileStatus[];
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

/** User-facing application settings */
export interface AppSettings {
  theme: 'light' | 'dark';
  gitlabUrl: string;
  gitlabToken: string;
  recentRepos: string[];
}
