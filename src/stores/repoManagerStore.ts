import { create } from 'zustand';
import { load, type Store } from '@tauri-apps/plugin-store';

export interface SavedRepo {
  path: string;
  alias: string;
  addedAt: string;
}

interface RepoManagerState {
  repos: SavedRepo[];
  lastRepoPath: string | null;
  loading: boolean;
  _store: Store | null;

  init: () => Promise<void>;
  addRepo: (path: string, alias?: string) => Promise<void>;
  updateAlias: (path: string, alias: string) => Promise<void>;
  removeRepo: (path: string) => Promise<void>;
  setLastRepo: (path: string) => Promise<void>;
  clearLastRepo: () => Promise<void>;
}

export function defaultAlias(path: string): string {
  const parts = path.replace(/[/\\]$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** 获取或创建持久化 store 实例 — 复用避免重复加载 */
async function ensureStore(): Promise<Store> {
  return load('repos.json', { autoSave: false, defaults: {} });
}

async function persist(repos: SavedRepo[], lastRepoPath: string | null, store?: Store | null): Promise<Store> {
  const s = store || await ensureStore();
  await s.set('data', { repos, lastRepoPath });
  await s.save();
  return s;
}

export const useRepoManagerStore = create<RepoManagerState>((set, get) => ({
  repos: [],
  lastRepoPath: null,
  loading: false,
  _store: null,

  init: async () => {
    set({ loading: true });
    try {
      const store = await ensureStore();
      const saved = await store.get<{ repos: SavedRepo[]; lastRepoPath?: string }>('data');
      if (saved?.repos) {
        const fixed = saved.repos.map((r: SavedRepo & { name?: string }) => ({
          ...r,
          alias: r.name || r.alias || defaultAlias(r.path),
        }));
        set({ repos: fixed, lastRepoPath: saved.lastRepoPath || null, loading: false, _store: store });
      } else {
        const lastPath = await store.get<string>('lastRepoPath');
        set({ _store: store, lastRepoPath: lastPath || null, loading: false });
      }
    } catch (e) {
      console.error('Failed to load repo list:', e);
      set({ loading: false });
    }
  },

  addRepo: async (path: string, alias?: string) => {
    const { repos, lastRepoPath, _store } = get();
    const repoAlias = alias || defaultAlias(path);

    const filtered = repos.filter((r) => r.path !== path);
    const updated = [{ path, alias: repoAlias, addedAt: new Date().toISOString() }, ...filtered].slice(0, 20);
    set({ repos: updated });

    try {
      const store = await persist(updated, lastRepoPath, _store);
      set({ _store: store });
    } catch (e) {
      console.error('Failed to save repo list:', e);
    }
  },

  updateAlias: async (path: string, alias: string) => {
    const { repos, lastRepoPath, _store } = get();
    const updated = repos.map((r) => (r.path === path ? { ...r, alias } : r));
    set({ repos: updated });

    try {
      const store = await persist(updated, lastRepoPath, _store);
      set({ _store: store });
    } catch (e) {
      console.error('Failed to save repo list:', e);
    }
  },

  removeRepo: async (path: string) => {
    const { repos, lastRepoPath, _store } = get();
    const updated = repos.filter((r) => r.path !== path);
    const newLastPath = lastRepoPath === path ? null : lastRepoPath;
    set({ repos: updated, lastRepoPath: newLastPath });

    try {
      const s = _store || await ensureStore();
      await s.set('data', { repos: updated, lastRepoPath: newLastPath });
      await s.save();
      set({ _store: s });
    } catch (e) {
      console.error('Failed to save repo list:', e);
    }
  },

  setLastRepo: async (path: string) => {
    const { repos, _store } = get();
    set({ lastRepoPath: path });
    try {
      const s = _store || await ensureStore();
      await s.set('data', { repos, lastRepoPath: path });
      await s.save();
      set({ _store: s });
    } catch (e) {
      console.error('Failed to save last repo:', e);
    }
  },

  clearLastRepo: async () => {
    const { repos, _store } = get();
    set({ lastRepoPath: null });
    try {
      const s = _store || await ensureStore();
      await s.set('data', { repos, lastRepoPath: null });
      await s.save();
      set({ _store: s });
    } catch (e) {
      console.error('Failed to clear last repo:', e);
    }
  },
}));
