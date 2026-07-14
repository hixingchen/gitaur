import { useEffect, useRef, useMemo } from 'react';
import { usePipelineStore } from '../stores/pipelineStore';
import { useViewStore } from '../stores/viewStore';

const BASE_INTERVAL = 30_000; // 30 秒
const MAX_INTERVAL = 300_000; // 5 分钟
const BACKOFF_STATUSES = new Set(['conflict', 'pipeline_failed', 'not_approved']);

/**
 * MR 状态轮询管理 Hook（带指数退避）
 */
export function useMrPolling() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const intervalRef = useRef(BASE_INTERVAL);

  const pollMrStatus = usePipelineStore((s) => s.pollMrStatus);
  const currentTask = usePipelineStore((s) => s.currentTask);
  const activeNav = useViewStore((s) => s.activeNav);

  const taskKey = useMemo(() => {
    if (!currentTask) return null;
    const waitStep = currentTask.steps.find((s) => s.key === 'wait');
    return {
      id: currentTask.id,
      mrIid: currentTask.mrIid,
      waitStatus: waitStep?.status,
      mrPollStatus: currentTask.mrPollStatus,
    };
  }, [currentTask]);

  const stopPolling = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    currentTaskIdRef.current = null;
    intervalRef.current = BASE_INTERVAL;
  };

  const scheduleNext = (taskId: string) => {
    timerRef.current = setTimeout(() => {
      if (currentTaskIdRef.current === taskId) {
        pollMrStatus(taskId);
        // 根据状态调整间隔
        const task = usePipelineStore.getState().currentTask;
        const ps = task?.mrPollStatus;
        if (ps && BACKOFF_STATUSES.has(ps)) {
          intervalRef.current = Math.min(intervalRef.current * 2, MAX_INTERVAL);
        } else {
          intervalRef.current = BASE_INTERVAL;
        }
        scheduleNext(taskId);
      }
    }, intervalRef.current);
  };

  const startPolling = (taskId: string) => {
    stopPolling();
    currentTaskIdRef.current = taskId;
    intervalRef.current = BASE_INTERVAL;

    // 立即执行一次
    pollMrStatus(taskId);
    // 调度下一次
    scheduleNext(taskId);
  };

  const shouldPoll = useMemo(() => {
    if (activeNav !== 'workspace' && activeNav !== 'pipeline') return false;
    if (!taskKey) return false;
    if (!taskKey.mrIid) return false;
    if (taskKey.waitStatus !== 'process') return false;
    return true;
  }, [activeNav, taskKey]);

  useEffect(() => {
    if (shouldPoll && taskKey) {
      if (currentTaskIdRef.current !== taskKey.id) {
        startPolling(taskKey.id);
      }
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [shouldPoll, taskKey?.id]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);
}
