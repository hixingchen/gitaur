import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  // Tauri expects a fixed port; fail if port is already in use
  server: {
    port: 5173,
    strictPort: true,
    // Allow Tauri to connect from its webview
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
