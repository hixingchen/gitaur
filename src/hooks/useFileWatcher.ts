import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Subscribe to file system changes in the current repository.
 * Automatically refreshes repo status when files change.
 * Includes debouncing to prevent rapid-fire refreshes.
 *
 * @param onChanged - callback when files change (receives changed paths)
 * @param enabled - whether to enable the watcher
 */
export function useFileWatcher(
  onChanged: (paths: string[]) => void,
  enabled: boolean = true,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onChanged);
  callbackRef.current = onChanged;

  useEffect(() => {
    if (!enabled) return;

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    const setup = async () => {
      try {
        const fn = await listen<string[]>('file-changed', (event) => {
          // 防抖：300ms 内多次触发只执行最后一次
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }
          timerRef.current = setTimeout(() => {
            callbackRef.current(event.payload);
          }, 300);
        });
        if (cancelled) {
          // 组件已卸载，立即取消监听
          fn();
        } else {
          unlisten = fn;
        }
      } catch (e) {
        console.debug('File watcher event listener setup:', e);
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [enabled]);
}
