import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// 禁用默认右键菜单（仅限非输入元素，保留文本输入/编辑器的右键菜单）
document.addEventListener('contextmenu', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement)?.closest('[contenteditable="true"]')) {
    e.preventDefault();
  }
});

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
