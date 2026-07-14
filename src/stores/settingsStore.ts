import { create } from 'zustand';
import type { AppSettings } from '../types/git';
import { load, type Store } from '@tauri-apps/plugin-store';

interface SettingsState {
  settings: AppSettings;
  store: Store | null;
  loading: boolean;

  init: () => Promise<void>;
  update: (partial: Partial<AppSettings>) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  gitUserName: '',
  gitUserEmail: '',
  gitlabUrl: 'https://gitlab.com',
  gitlabToken: '',
  recentRepos: [],
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  store: null,
  loading: false,

  init: async () => {
    set({ loading: true });
    try {
      const store = await load('settings.json', { autoSave: false, defaults: {} });
      const saved = await store.get<AppSettings>('settings');

      if (saved) {
        set({ settings: { ...DEFAULT_SETTINGS, ...saved }, store, loading: false });
      } else {
        await store.set('settings', DEFAULT_SETTINGS);
        set({ store, loading: false });
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
      set({ loading: false });
    }
  },

  update: async (partial) => {
    const { settings, store } = get();
    const newSettings = { ...settings, ...partial };
    set({ settings: newSettings });

    if (store) {
      try {
        await store.set('settings', newSettings);
        await store.save();
      } catch (e) {
        console.error('Failed to save settings:', e);
      }
    }
  },
}));
