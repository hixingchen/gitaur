import { create } from 'zustand';
import type { RepoInfo, LogEntry, CommitDetail } from '../types/git';
import { invoke } from '@tauri-apps/api/core';
import { useViewStore } from './viewStore';

// 请求 ID 计数器 — 防止并发请求竞态（旧响应覆盖新状态）
let _statusRequestId = 0;
let _logRequestId = 0;
let _commitDetailRequestId = 0;
let _commitFileDiffRequestId = 0;

interface RepoState {
  // Current repo
  repoPath: string | null;
  repoInfo: RepoInfo | null;
  loading: boolean;
  error: string | null;

  // Logs
  logEntries: LogEntry[];
  logLoading: boolean;
  /** 当前历史筛选的分支；null 表示 --all */
  logBranch: string | null;

  // Commit detail (历史界面)
  selectedCommit: string | null;
  commitDetail: CommitDetail | null;
  commitDetailLoading: boolean;
  selectedCommitFile: string | null;
  commitFileDiff: string | null;
  commitFileDiffLoading: boolean;

  // Actions
  openRepo: (path: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshStatusSilent: () => Promise<void>;
  loadLog: (maxCount?: number, branch?: string | null, baseRef?: string) => Promise<void>;
  commit: (message: string, files: string[], amend?: boolean) => Promise<void>;
  checkout: (target: string, createBranch?: boolean, startPoint?: string) => Promise<void>;
  push: (remote?: string, force?: boolean, deleteBranch?: boolean, branch?: string) => Promise<void>;
  pull: (remote?: string, rebase?: boolean) => Promise<void>;
  merge: (branch: string) => Promise<void>;
  rebase: (onto: string) => Promise<void>;
  abortRebase: () => Promise<void>;
  rebaseContinue: () => Promise<void>;
  abortConflict: () => Promise<void>;
  continueConflict: () => Promise<void>;
  stageFile: (file: string) => Promise<void>;
  unstageFile: (file: string) => Promise<void>;
  stageAll: () => Promise<void>;
  deleteBranch: (branch: string, force?: boolean) => Promise<void>;
  renameBranch: (oldName: string | null, newName: string) => Promise<void>;
  loadCommitDetail: (hash: string) => Promise<void>;
  loadCommitFileDiff: (hash: string, file: string) => Promise<void>;
  setSelectedCommit: (hash: string | null) => void;
  setSelectedCommitFile: (file: string | null) => void;
  closeRepo: () => void;
  clearError: () => void;
}

export const useRepoStore = create<RepoState>((set, get) => ({
  repoPath: null,
  repoInfo: null,
  loading: false,
  error: null,
  logEntries: [],
  logLoading: false,
  logBranch: null,
  selectedCommit: null,
  commitDetail: null,
  commitDetailLoading: false,
  selectedCommitFile: null,
  commitFileDiff: null,
  commitFileDiffLoading: false,

  openRepo: async (path: string) => {
    // 停止旧仓库的文件监听
    const oldPath = get().repoPath;
    if (oldPath) {
      invoke('stop_file_watcher').catch(() => {});
    }
    const reqId = ++_statusRequestId;
    set({
      repoPath: path,
      repoInfo: null,  // 立即清除，防止组件用旧仓库的 repoInfo 配合新 repoPath
      loading: true,
      error: null,
      // 清除旧仓库的日志状态
      logEntries: [],
      logBranch: null,
      selectedCommit: null,
      commitDetail: null,
      selectedCommitFile: null,
      commitFileDiff: null,
    });
    // 清除视图状态（选中的文件）
    useViewStore.getState().setSelectedFile(null);
    try {
      const info = await invoke<RepoInfo>('get_repo_status', { repoPath: path });
      if (reqId !== _statusRequestId) return;
      set({ repoInfo: info, loading: false });
      // 启动文件监听，自动刷新状态
      invoke('start_file_watcher', { repoPath: path }).catch((e) => {
        console.warn('文件监听启动失败（不影响主功能）:', e);
      });
    } catch (e) {
      if (reqId === _statusRequestId) set({ error: String(e), loading: false });
    }
  },

  refreshStatus: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    const reqId = ++_statusRequestId;
    set({ loading: true });
    try {
      const info = await invoke<RepoInfo>('get_repo_status', { repoPath });
      if (reqId === _statusRequestId) set({ repoInfo: info, loading: false });
    } catch (e) {
      if (reqId === _statusRequestId) set({ error: String(e), loading: false });
    }
  },

  // 静默刷新 — 不设置 loading，不触发列表闪烁，保持文件顺序
  refreshStatusSilent: async () => {
    const { repoPath, repoInfo: oldInfo } = get();
    if (!repoPath) return;
    const reqId = ++_statusRequestId;
    try {
      const info = await invoke<RepoInfo>('get_repo_status', { repoPath });
      if (reqId !== _statusRequestId) return;
      // 浅比较：如果核心字段没变，跳过更新避免触发重渲染
      if (oldInfo
        && oldInfo.currentBranch === info.currentBranch
        && oldInfo.ahead === info.ahead
        && oldInfo.behind === info.behind
        && oldInfo.hasUpstream === info.hasUpstream
        && oldInfo.status.length === info.status.length
        && oldInfo.status.every((old, i) => {
          const cur = info.status[i];
          return old.path === cur.path && old.status === cur.status && old.staged === cur.staged;
        })
      ) {
        return; // 数据无变化，跳过更新
      }
      // 保持旧列表中的文件顺序，新文件追加到末尾
      const oldOrder = oldInfo?.status ?? [];
      const gitMap = new Map(info.status.map((f) => [f.path, f]));
      const ordered: typeof info.status = [];
      for (const old of oldOrder) {
        const updated = gitMap.get(old.path);
        if (updated) { ordered.push(updated); gitMap.delete(old.path); }
      }
      // 新文件（旧列表中不存在的）追加到末尾
      for (const f of info.status) {
        if (gitMap.has(f.path)) ordered.push(f);
      }
      set({ repoInfo: { ...info, status: ordered } });
    } catch (e) {
      if (reqId === _statusRequestId) set({ error: String(e) });
    }
  },

  loadLog: async (maxCount?: number, branch?: string | null, baseRef?: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    const reqId = ++_logRequestId;
    set({
      logLoading: true,
      selectedCommit: null,  // 清除选中状态，避免显示旧提交的详情
      commitDetail: null,
      selectedCommitFile: null,
      commitFileDiff: null,
    });
    try {
      const entries = await invoke<LogEntry[]>('get_log', {
        repoPath,
        maxCount: maxCount ?? 100,
        branch: branch ?? null,
        baseRef: baseRef ?? null,
        firstParent: false,
        noMerges: true,  // 所有分支都隐藏合并记录
      });
      if (reqId === _logRequestId) set({ logEntries: entries, logLoading: false });
    } catch (e) {
      if (reqId === _logRequestId) set({ error: String(e), logLoading: false });
    }
  },

  commit: async (message: string, files: string[], amend?: boolean) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_commit', { repoPath, params: { message, files, amend } });
      await get().refreshStatus();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  checkout: async (target: string, createBranch?: boolean, startPoint?: string) => {
    const { repoPath } = get();
    if (!repoPath) return;

    set({ loading: true, error: null });
    try {
      await invoke('git_checkout', {
        repoPath, target, createBranch, startPoint: startPoint ?? null,
      });
      await get().refreshStatus();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  push: async (remote?: string, force?: boolean, deleteBranch?: boolean, branch?: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_push', { repoPath, remote, force, delete: deleteBranch, branch });
      await get().refreshStatus();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  pull: async (remote?: string, rebase?: boolean) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_pull', { repoPath, remote, rebase });
      await get().refreshStatus();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  merge: async (branch: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_merge', { repoPath, branch });
      await get().refreshStatus();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  rebase: async (onto: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_rebase', { repoPath, onto });
      await get().refreshStatus();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  abortRebase: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_abort_rebase', { repoPath });
      await get().refreshStatus();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  rebaseContinue: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_rebase_continue', { repoPath });
      await get().refreshStatus();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  // 中止冲突（自动判断 rebase 或 merge）
  abortConflict: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      // 检查是否在 rebase 状态
      const rebaseDir = await invoke<boolean>('check_rebase_state', { repoPath });
      if (rebaseDir) {
        await invoke('git_abort_rebase', { repoPath });
      } else {
        await invoke('git_merge_abort', { repoPath });
      }
      await get().refreshStatus();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  // 继续解决冲突（自动判断 rebase 或 merge）
  continueConflict: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      const rebaseDir = await invoke<boolean>('check_rebase_state', { repoPath });
      if (rebaseDir) {
        await invoke('git_rebase_continue', { repoPath });
      } else {
        // merge 冲突解决后直接 commit
        await invoke('git_commit', { repoPath, message: 'Merge branch', files: [], amend: false });
      }
      await get().refreshStatus();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  stageFile: async (file: string) => {
    const { repoPath, repoInfo } = get();
    if (!repoPath || !repoInfo) return;
    // 乐观更新 — 立即切换 UI，Checkbox 是受控组件，不这样会视觉回弹
    set((state) => {
      if (!state.repoInfo) return {};
      const newStatus = state.repoInfo.status.map((f) =>
        f.path === file ? { ...f, staged: true } : f
      );
      return { repoInfo: { ...state.repoInfo, status: newStatus } };
    });
    try {
      await invoke('git_stage', { repoPath, files: [file] });
    } catch (e) {
      set({ error: String(e) });
    }
    await get().refreshStatusSilent();
  },

  unstageFile: async (file: string) => {
    const { repoPath, repoInfo } = get();
    if (!repoPath || !repoInfo) return;
    // 乐观更新 — 立即切换 UI，Checkbox 是受控组件，不这样会视觉回弹
    set((state) => {
      if (!state.repoInfo) return {};
      const newStatus = state.repoInfo.status.map((f) =>
        f.path === file ? { ...f, staged: false } : f
      );
      return { repoInfo: { ...state.repoInfo, status: newStatus } };
    });
    try {
      await invoke('git_unstage', { repoPath, files: [file] });
    } catch (e) {
      set({ error: String(e) });
    }
    await get().refreshStatusSilent();
  },

  stageAll: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await invoke('git_stage_all', { repoPath });
      await get().refreshStatusSilent();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteBranch: async (branch: string, force?: boolean) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_branch_delete', { repoPath, branch, force });
      await get().refreshStatus();
      set({ loading: false });
    } catch (e) {
      set({ loading: false });
      throw e; // 向上抛出，让调用方处理错误提示
    }
  },

  renameBranch: async (oldName: string | null, newName: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true, error: null });
    try {
      await invoke('git_branch_rename', { repoPath, oldName, newName });
      await get().refreshStatus();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadCommitDetail: async (hash: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    const reqId = ++_commitDetailRequestId;
    set({ commitDetailLoading: true, selectedCommitFile: null, commitFileDiff: null });
    try {
      const detail = await invoke<CommitDetail>('get_commit_detail', { repoPath, hash });
      if (reqId === _commitDetailRequestId) set({ commitDetail: detail, commitDetailLoading: false });
    } catch (e) {
      if (reqId === _commitDetailRequestId) set({ error: String(e), commitDetailLoading: false });
    }
  },

  loadCommitFileDiff: async (hash: string, file: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    const reqId = ++_commitFileDiffRequestId;
    set({ commitFileDiffLoading: true });
    try {
      const diff = await invoke<string>('get_commit_file_diff', { repoPath, hash, file });
      if (reqId === _commitFileDiffRequestId) set({ commitFileDiff: diff, commitFileDiffLoading: false });
    } catch (e) {
      if (reqId === _commitFileDiffRequestId) set({ error: String(e), commitFileDiffLoading: false });
    }
  },

  setSelectedCommit: (hash: string | null) =>
    set({ selectedCommit: hash, commitDetail: null, selectedCommitFile: null, commitFileDiff: null }),
  setSelectedCommitFile: (file: string | null) => set({ selectedCommitFile: file }),

  closeRepo: () => {
    // 停止后端文件监听，防止 OS 级资源泄漏
    invoke('stop_file_watcher').catch(() => {});
    set({
      repoPath: null, repoInfo: null, logEntries: [], logBranch: null,
      selectedCommit: null, commitDetail: null, selectedCommitFile: null, commitFileDiff: null,
    });
  },
  clearError: () => set({ error: null }),
}));
