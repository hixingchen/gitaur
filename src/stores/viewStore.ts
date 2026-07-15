import { create } from 'zustand';

/** 导航页面类型 */
export type NavKey = 'home' | 'repos' | 'workspace' | 'pipeline' | 'branches' | 'history' | 'history-demo' | 'settings';

/** 轻量 UI 状态 — 选文件不触发 repoStore 重渲染 */
interface ViewState {
  selectedFile: string | null;
  activeNav: NavKey;
  setSelectedFile: (f: string | null) => void;
  setActiveNav: (nav: NavKey) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  selectedFile: null,
  activeNav: 'home',
  setSelectedFile: (f) => set({ selectedFile: f }),
  setActiveNav: (nav) => set({ activeNav: nav }),
}));
