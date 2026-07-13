import { create } from 'zustand';
import type { RepoInfo, LogEntry, CommitDetail } from '../types/git';
import { invoke } from '@tauri-apps/api/core';

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
  loadLog: (maxCount?: number, branch?: string | null) => Promise<void>;
  commit: (message: string, files: string[], amend?: boolean) => Promise<void>;
  checkout: (target: string, createBranch?: boolean, startPoint?: string) => Promise<void>;
  push: (remote?: string, force?: boolean, deleteBranch?: boolean, branch?: string) => Promise<void>;
  pull: (remote?: string, rebase?: boolean) => Promise<void>;
  merge: (branch: string) => Promise<void>;
  rebase: (onto: string) => Promise<void>;
  abortRebase: () => Promise<void>;
  rebaseContinue: () => Promise<void>;
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
    set({ repoPath: path, loading: true, error: null });
    try {
      const info = await invoke<RepoInfo>('get_repo_status', { repoPath: path });
      set({ repoInfo: info, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  refreshStatus: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true });
    try {
      const info = await invoke<RepoInfo>('get_repo_status', { repoPath });
      set({ repoInfo: info, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // 静默刷新 — 不设置 loading，不触发列表闪烁，保持文件顺序
  refreshStatusSilent: async () => {
    const { repoPath, repoInfo: oldInfo } = get();
    if (!repoPath) return;
    try {
      const info = await invoke<RepoInfo>('get_repo_status', { repoPath });
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
      set({ error: String(e) });
    }
  },

  loadLog: async (maxCount?: number, branch?: string | null) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ logLoading: true });
    try {
      const entries = await invoke<LogEntry[]>('get_log', {
        repoPath,
        maxCount: maxCount ?? 100,
        branch: branch ?? null,
      });
      set({ logEntries: entries, logLoading: false });
    } catch (e) {
      set({ error: String(e), logLoading: false });
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
    set({ commitDetailLoading: true, selectedCommitFile: null, commitFileDiff: null });
    try {
      const detail = await invoke<CommitDetail>('get_commit_detail', { repoPath, hash });
      set({ commitDetail: detail, commitDetailLoading: false });
    } catch (e) {
      set({ error: String(e), commitDetailLoading: false });
    }
  },

  loadCommitFileDiff: async (hash: string, file: string) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ commitFileDiffLoading: true });
    try {
      const diff = await invoke<string>('get_commit_file_diff', { repoPath, hash, file });
      set({ commitFileDiff: diff, commitFileDiffLoading: false });
    } catch (e) {
      set({ error: String(e), commitFileDiffLoading: false });
    }
  },

  setSelectedCommit: (hash: string | null) =>
    set({ selectedCommit: hash, commitDetail: null, selectedCommitFile: null, commitFileDiff: null }),
  setSelectedCommitFile: (file: string | null) => set({ selectedCommitFile: file }),

  closeRepo: () => set({
    repoPath: null, repoInfo: null, logEntries: [], logBranch: null,
    selectedCommit: null, commitDetail: null, selectedCommitFile: null, commitFileDiff: null,
  }),
  clearError: () => set({ error: null }),
}));
