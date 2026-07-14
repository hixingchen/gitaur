import { create } from 'zustand';
import { GitLabService, type GitLabMergeRequest, type GitLabProject, type CreateMergeRequestParams } from '../services/gitlab';
import { useSettingsStore } from './settingsStore';

interface GitLabState {
  service: GitLabService | null;
  projects: GitLabProject[];
  currentProject: GitLabProject | null;
  mergeRequests: GitLabMergeRequest[];
  selectedMR: GitLabMergeRequest | null;
  loading: boolean;
  error: string | null;

  // Actions
  init: () => void;
  searchProjects: (query: string) => Promise<void>;
  selectProject: (project: GitLabProject) => void;
  loadMergeRequests: (state?: 'opened' | 'closed' | 'merged' | 'all') => Promise<void>;
  selectMR: (mr: GitLabMergeRequest | null) => void;
  createMergeRequest: (params: CreateMergeRequestParams) => Promise<GitLabMergeRequest | null>;
  mergeMR: (mrIid: number, squash?: boolean) => Promise<boolean>;
  closeMR: (mrIid: number) => Promise<boolean>;
  approveMR: (mrIid: number) => Promise<boolean>;
  refreshMR: () => Promise<void>;
  clearError: () => void;
}

// 项目搜索缓存（5 分钟 TTL）
const _projectCache = new Map<string, { projects: GitLabProject[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export const useGitLabStore = create<GitLabState>((set, get) => ({
  service: null,
  projects: [],
  currentProject: null,
  mergeRequests: [],
  selectedMR: null,
  loading: false,
  error: null,

  init: () => {
    const settings = useSettingsStore.getState().settings;
    if (settings.gitlabUrl && settings.gitlabToken) {
      const service = new GitLabService({
        url: settings.gitlabUrl,
        token: settings.gitlabToken,
      });
      set({ service });
    }
  },

  searchProjects: async (query: string) => {
    const { service } = get();
    if (!service) {
      set({ error: '请先配置 GitLab 连接' });
      return;
    }

    // 检查缓存
    const cached = _projectCache.get(query);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      set({ projects: cached.projects, loading: false });
      return;
    }

    set({ loading: true, error: null });
    try {
      const projects = await service.searchProjects(query);
      _projectCache.set(query, { projects, ts: Date.now() });
      set({ projects, loading: false });
    } catch (e) {
      set({ error: `搜索项目失败: ${e}`, loading: false });
    }
  },

  selectProject: (project: GitLabProject) => {
    set({ currentProject: project, mergeRequests: [], selectedMR: null });
  },

  loadMergeRequests: async (state = 'opened') => {
    const { service, currentProject } = get();
    if (!service || !currentProject) {
      set({ error: '请先选择项目' });
      return;
    }

    set({ loading: true, error: null });
    try {
      const mergeRequests = await service.getMergeRequests(
        currentProject.path_with_namespace,
        state
      );
      set({ mergeRequests, loading: false });
    } catch (e) {
      set({ error: `加载 MR 列表失败: ${e}`, loading: false });
    }
  },

  selectMR: (mr: GitLabMergeRequest | null) => {
    set({ selectedMR: mr });
  },

  createMergeRequest: async (params: CreateMergeRequestParams) => {
    const { service, currentProject } = get();
    if (!service || !currentProject) {
      set({ error: '请先选择项目' });
      return null;
    }

    set({ loading: true, error: null });
    try {
      const mr = await service.createMergeRequest(
        currentProject.path_with_namespace,
        params
      );
      set((state) => ({
        mergeRequests: [mr, ...state.mergeRequests],
        loading: false,
      }));
      return mr;
    } catch (e) {
      set({ error: `创建 MR 失败: ${e}`, loading: false });
      return null;
    }
  },

  mergeMR: async (mrIid: number, squash = false) => {
    const { service, currentProject } = get();
    if (!service || !currentProject) {
      set({ error: '请先选择项目' });
      return false;
    }

    set({ loading: true, error: null });
    try {
      await service.mergeMergeRequest(
        currentProject.path_with_namespace,
        mrIid,
        { squash, should_remove_source_branch: true }
      );
      // Refresh list
      await get().loadMergeRequests();
      set({ loading: false });
      return true;
    } catch (e) {
      set({ error: `合并 MR 失败: ${e}`, loading: false });
      return false;
    }
  },

  closeMR: async (mrIid: number) => {
    const { service, currentProject } = get();
    if (!service || !currentProject) {
      set({ error: '请先选择项目' });
      return false;
    }

    set({ loading: true, error: null });
    try {
      await service.closeMergeRequest(
        currentProject.path_with_namespace,
        mrIid,
      );
      await get().loadMergeRequests();
      set({ loading: false });
      return true;
    } catch (e) {
      set({ error: `关闭 MR 失败: ${e}`, loading: false });
      return false;
    }
  },

  approveMR: async (mrIid: number) => {
    const { service, currentProject } = get();
    if (!service || !currentProject) {
      set({ error: '请先选择项目' });
      return false;
    }

    set({ loading: true, error: null });
    try {
      await service.approveMergeRequest(
        currentProject.path_with_namespace,
        mrIid
      );
      await get().refreshMR();
      set({ loading: false });
      return true;
    } catch (e) {
      set({ error: `审批 MR 失败: ${e}`, loading: false });
      return false;
    }
  },

  refreshMR: async () => {
    const { service, currentProject, selectedMR } = get();
    if (!service || !currentProject || !selectedMR) return;

    try {
      const updated = await service.getMergeRequest(
        currentProject.path_with_namespace,
        selectedMR.iid
      );
      set({ selectedMR: updated });
    } catch (e) {
      console.error('刷新 MR 失败:', e);
    }
  },

  clearError: () => set({ error: null }),
}));
