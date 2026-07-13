import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// 禁用默认右键菜单
document.addEventListener('contextmenu', (e) => e.preventDefault());

// 全局错误捕获，防止白屏
window.onerror = (msg) => {
  console.error('Global error:', msg);
  return true; // 阻止默认行为
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
