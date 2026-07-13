import { create } from 'zustand';

/** 轻量 UI 状态 — 选文件不触发 repoStore 重渲染 */
interface ViewState {
  selectedFile: string | null;
  setSelectedFile: (f: string | null) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  selectedFile: null,
  setSelectedFile: (f) => set({ selectedFile: f }),
}));
