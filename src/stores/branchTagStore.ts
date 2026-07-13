import { create } from 'zustand';
import { load, type Store } from '@tauri-apps/plugin-store';

/** 分支标签类型 */
export type BranchTagType = 'integration' | 'mainline' | 'release' | 'hotfix' | 'task';

/** 分支标签 */
export interface BranchTag {
  branchName: string;
  tag: BranchTagType;
  repoPath: string;
}

/** 标签配置 */
export const TAG_CONFIG: Record<BranchTagType, { label: string; color: string; icon: string }> = {
  integration: { label: '开发分支', color: 'blue', icon: '🔗' },
  mainline: { label: '主干分支', color: 'red', icon: '🏗️' },
  release: { label: '发布分支', color: 'orange', icon: '📦' },
  hotfix: { label: '热修复分支', color: 'volcano', icon: '🔧' },
  task: { label: '任务分支', color: 'purple', icon: '🚀' },
};

interface BranchTagState {
  /** 按仓库路径存储标签 */
  tagsByRepo: Record<string, BranchTag[]>;
  _store: Store | null;

  // Actions
  init: () => Promise<void>;
  autoTag: (repoPath: string, branches: string[]) => Promise<void>;
  setTag: (repoPath: string, branchName: string, tag: BranchTagType) => Promise<void>;
  removeTag: (repoPath: string, branchName: string) => Promise<void>;
  getTag: (repoPath: string, branchName: string) => BranchTagType | null;
  getTargetBranch: (repoPath: string) => string | null;
  getTagsForRepo: (repoPath: string) => BranchTag[];
}

const STORE_FILE = 'branch-tags.json';
let _storeInstance: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!_storeInstance) {
    _storeInstance = await load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return _storeInstance;
}

async function persistTags(tagsByRepo: Record<string, BranchTag[]>, store?: Store | null): Promise<void> {
  const s = store || await ensureStore();
  await s.set('tagsByRepo', tagsByRepo);
  await s.save();
}

export const useBranchTagStore = create<BranchTagState>((set, get) => ({
  tagsByRepo: {},
  _store: null,

  init: async () => {
    try {
      const store = await ensureStore();
      const saved = await store.get<Record<string, BranchTag[]>>('tagsByRepo');
      if (saved) {
        set({ tagsByRepo: saved, _store: store });
      } else {
        set({ _store: store });
      }
    } catch (e) {
      console.error('加载分支标签失败:', e);
    }
  },

  /** 自动标记默认分支（master/main → 主干，develop → 开发） */
  autoTag: async (repoPath: string, branches: string[]) => {
    const { tagsByRepo, _store } = get();
    const repoTags = [...(tagsByRepo[repoPath] || [])];
    let changed = false;

    // 检查是否已有主干分支标签
    const hasMainline = repoTags.some((t) => t.tag === 'mainline');
    if (!hasMainline) {
      // 自动标记 master 或 main
      const mainBranch = branches.find((b) => b === 'master' || b === 'main');
      if (mainBranch) {
        repoTags.push({ branchName: mainBranch, tag: 'mainline', repoPath });
        changed = true;
      }
    }

    // 检查是否已有开发分支标签
    const hasIntegration = repoTags.some((t) => t.tag === 'integration');
    if (!hasIntegration) {
      // 自动标记 develop
      const developBranch = branches.find((b) => b === 'develop');
      if (developBranch) {
        repoTags.push({ branchName: developBranch, tag: 'integration', repoPath });
        changed = true;
      }
    }

    if (changed) {
      const newTagsByRepo = { ...tagsByRepo, [repoPath]: repoTags };
      set({ tagsByRepo: newTagsByRepo });
      await persistTags(newTagsByRepo, _store);
    }
  },

  setTag: async (repoPath: string, branchName: string, tag: BranchTagType) => {
    const { tagsByRepo, _store } = get();
    const repoTags = tagsByRepo[repoPath] || [];

    // 过滤掉同一个分支的旧标签（如果要更新标签类型）
    const filteredTags = repoTags.filter((t) => t.branchName !== branchName);
    const newTag: BranchTag = { branchName, tag, repoPath };
    const newRepoTags = [...filteredTags, newTag];
    const newTagsByRepo = { ...tagsByRepo, [repoPath]: newRepoTags };

    set({ tagsByRepo: newTagsByRepo });
    await persistTags(newTagsByRepo, _store);
  },

  removeTag: async (repoPath: string, branchName: string) => {
    const { tagsByRepo, _store } = get();
    const repoTags = tagsByRepo[repoPath] || [];
    const newRepoTags = repoTags.filter((t) => t.branchName !== branchName);
    const newTagsByRepo = { ...tagsByRepo, [repoPath]: newRepoTags };

    set({ tagsByRepo: newTagsByRepo });
    await persistTags(newTagsByRepo, _store);
  },

  getTag: (repoPath: string, branchName: string) => {
    const { tagsByRepo } = get();
    const repoTags = tagsByRepo[repoPath] || [];
    const found = repoTags.find((t) => t.branchName === branchName);
    return found?.tag || null;
  },

  getTargetBranch: (repoPath: string) => {
    const { tagsByRepo } = get();
    const repoTags = tagsByRepo[repoPath] || [];
    const target = repoTags.find((t) => t.tag === 'integration');
    return target?.branchName || null;
  },

  getTagsForRepo: (repoPath: string) => {
    const { tagsByRepo } = get();
    return tagsByRepo[repoPath] || [];
  },
}));
