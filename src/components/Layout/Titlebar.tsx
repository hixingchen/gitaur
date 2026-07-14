import { useState, useEffect, useCallback } from 'react';
import { theme } from 'antd';
import {
  MinusOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);
  const { token } = theme.useToken();

  const refreshMaximized = useCallback(async () => {
    const isMax = await appWindow.isMaximized();
    setMaximized(isMax);
  }, []);

  useEffect(() => {
    refreshMaximized();

    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    appWindow.onResized(() => {
      refreshMaximized();
    }).then((fn) => {
      if (cancelled) {
        // 组件已卸载，立即取消监听
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [refreshMaximized]);

  const handleToggleMaximize = async () => {
    await appWindow.toggleMaximize();
    // 延迟检查状态，等窗口动画完成
    setTimeout(() => refreshMaximized(), 100);
  };

  const hoverBg = token.colorFillSecondary;

  const btnBase: React.CSSProperties = {
    width: 46,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: token.colorTextSecondary,
    fontSize: 13,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none',
    borderRadius: 0,
    // 焦点样式通过 CSS 类实现（见 App.css .titlebar-btn:focus-visible）
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: token.colorBgElevated,
        ['--titlebar-bg' as string]: token.colorBgElevated,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* 左侧：图标 + 应用名 */}
      <div
        data-tauri-drag-region
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 10,
          gap: 8,
        }}
      >
        {/* App icon — 与系统任务栏图标一致 */}
        <img
          src="/icon.png"
          alt="Gitaur"
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
          }}
        />

        <span style={{
          fontWeight: 600,
          fontSize: 13,
          color: token.colorTextSecondary,
          letterSpacing: 0.5,
        }}>
          Gitaur
        </span>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div style={{ display: 'flex', height: '100%' }}>
        {/* 最小化 */}
        <button
          style={btnBase}
          onClick={() => appWindow.minimize()}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = hoverBg;
            e.currentTarget.style.color = token.colorText;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = token.colorTextSecondary;
          }}
          aria-label="最小化"
        >
          <MinusOutlined style={{ fontSize: 12 }} />
        </button>

        {/* 最大化 / 还原 */}
        <button
          style={btnBase}
          onClick={handleToggleMaximize}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = hoverBg;
            e.currentTarget.style.color = token.colorText;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = token.colorTextSecondary;
          }}
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            /* 还原 — 下方块在后绘制，遮挡上方块重叠处 */
            <svg width="10" height="10" viewBox="0 0 10 10">
              {/* 上方块(右上): 先画，在下层 */}
              <rect x="2.5" y="0.5" width="7" height="7" rx="0.8"
                stroke="currentColor" strokeWidth="1" fill="none" />
              {/* 下方块(左下): 后画，在上层，实心填充遮盖重叠部分 */}
              <rect x="0.5" y="2.5" width="7" height="7" rx="0.8"
                stroke="currentColor" strokeWidth="1"
                fill="var(--titlebar-bg, #141414)" />
            </svg>
          ) : (
            /* 最大化 — 单空心方块 */
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1"
                stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </button>

        {/* 关闭 */}
        <button
          style={btnBase}
          onClick={() => appWindow.close()}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#e81123';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = token.colorTextSecondary;
          }}
          aria-label="关闭"
        >
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  );
}
