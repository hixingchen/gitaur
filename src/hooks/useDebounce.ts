import { useState, useEffect, useRef } from 'react';

/**
 * 防抖 Hook — 值变化后延迟 delay 毫秒才更新。
 * 消除各组件中重复的防抖 setTimeout 逻辑。
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, delay]);

  return debounced;
}
