import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import { message } from 'antd';
import { useRepoStore } from './repoStore';
import { useGitLabStore } from './gitlabStore';
import { useBranchTagStore } from './branchTagStore';

/** 流水线步骤状态 */
export type StepStatus = 'wait' | 'process' | 'finish' | 'error' | 'skip';

/** 流水线步骤 */
export interface PipelineStep {
  key: string;
  title: string;
  status: StepStatus;
  description?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'success' | 'cancelled';

/** 任务类型 */
export type TaskType = 'feature' | 'version';

/** 版本子类型 */
export type VersionType = 'release' | 'hotfix';

/** 流水线阶段 — 显式状态机，替代从步骤组合推断 */
export type FeaturePhase =
  | 'pending'           // 未开始
  | 'developing'        // 开发中（分支已创建，等待用户操作）
  | 'syncing'           // 同步中（自动）
  | 'paused_sync_error' // 同步错误暂停（冲突/未提交）
  | 'pushing'           // 推送中（自动）
  | 'creating_mr'       // 创建 MR 中（自动）
  | 'waiting_merge'     // 等待合并（MR 已创建）
  | 'cleaning_up'       // 清理中（自动）
  | 'finished'          // 完成
  | 'delete_only';      // 仅可删除（错误状态）

export type VersionPhase =
  | 'pending'           // 未开始
  | 'developing'        // 开发中（分支已创建，等待用户操作）
  | 'pushing'           // 推送中（自动）
  | 'creating_mr'       // 创建 MR 中（自动，两个 MR 并行创建）
  | 'waiting_merge'     // 等待合并（两个 MR 都创建完成）
  | 'tagging'           // 打 Tag 中（自动，两个 MR 都合并后）
  | 'cleaning_up'       // 清理中（自动）
  | 'finished'          // 完成
  | 'delete_only';      // 仅可删除（错误状态）

export type PipelinePhase = FeaturePhase | VersionPhase;

/** 同步策略 */
export type SyncStrategy = 'rebase' | 'merge';

/** MR 设置 */
export interface MRSettings {
  enabled: boolean;
  title?: string;
  description?: string;
  squash: boolean;
  squashCommitMessage?: string;
  mergeCommitMessage?: string;
  deleteBranchAfterMerge: boolean;
  autoMerge: boolean;
  targetBranch: string;
}

/** MR 轮询状态 */
export type MrPollStatus = 'idle' | 'checking' | 'conflict' | 'pipeline_failed' | 'not_approved' | 'mergeable' | 'merged' | 'closed';

/** 流水线任务 */
export interface PipelineTask {
  id: string;
  name: string;
  taskType: TaskType;
  versionType?: VersionType;
  branchName: string;
  version?: string;
  status: TaskStatus;
  phase: PipelinePhase;
  steps: PipelineStep[];
  currentStep: number;
  syncStrategy: SyncStrategy;
  mrSettings: MRSettings;
  mrIid?: number;
  mrUrl?: string;
  mrMainIid?: number;
  mrMainUrl?: string;
  mrDevIid?: number;
  mrDevUrl?: string;
  mrPollStatus?: MrPollStatus;
  squashCommitMessage?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** 创建任务参数 */
export interface CreateTaskParams {
  name: string;
  taskType: TaskType;
  versionType?: VersionType;
  branchName?: string;
  version?: string;
  syncStrategy?: SyncStrategy;
  mrSettings?: Partial<MRSettings>;
}

interface PipelineState {
  /** 按仓库路径存储任务 */
  tasksByRepo: Record<string, PipelineTask[]>;
  currentTask: PipelineTask | null;
  loading: boolean;
  error: string | null;
  _store: Store | null;

  // Actions
  init: () => Promise<void>;
  createTask: (params: CreateTaskParams) => PipelineTask | null;
  startTask: (taskId: string) => Promise<void>;
  commitCode: (taskId: string, message?: string) => Promise<void>;
  syncRemote: (taskId: string) => Promise<void>;
  pushRemote: (taskId: string) => Promise<void>;
  createMR: (taskId: string, commitMessage?: string) => Promise<void>;
  createVersionMR: (taskId: string, commitMessage?: string) => Promise<void>;
  checkMergeStatus: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  switchRepo: (repoPath: string | null) => void;
  setCurrentTask: (taskId: string | null) => void;
  abortRebase: (taskId: string) => Promise<void>;
  rebaseContinue: (taskId: string) => Promise<void>;
  closeMR: (taskId: string) => Promise<void>;
  reopenMR: (taskId: string) => Promise<void>;
  resumeDevelopment: (taskId: string) => void;
  resumeFromConflict: (taskId: string) => Promise<void>;
  pollMrStatus: (taskId: string) => Promise<void>;
  checkAndCleanTasks: () => Promise<void>;
  clearError: () => void;
}

function createFeatureSteps(): PipelineStep[] {
  return [
    { key: 'branch', title: '创建分支', status: 'wait' },
    { key: 'develop', title: '开发修改', status: 'wait' },
    { key: 'commit', title: '提交代码', status: 'wait' },
    { key: 'sync', title: '同步检测', status: 'wait' },
    { key: 'push', title: '推送远程', status: 'wait' },
    { key: 'mr', title: '创建MR', status: 'wait' },
    { key: 'wait', title: '等待合并', status: 'wait' },
    { key: 'cleanup', title: '清理分支', status: 'wait' },
  ];
}

function createVersionSteps(versionType: VersionType): PipelineStep[] {
  const developTitle = versionType === 'release' ? '版本准备' : '紧急修复';
  return [
    { key: 'branch', title: '创建分支', status: 'wait' },
    { key: 'develop', title: developTitle, status: 'wait' },
    { key: 'commit', title: '提交代码', status: 'wait' },
    { key: 'push', title: '推送远程', status: 'wait' },
    { key: 'mr', title: '创建MR', status: 'wait' },
    { key: 'wait', title: '等待合并', status: 'wait' },
    { key: 'tag', title: '标记版本', status: 'wait' },
    { key: 'cleanup', title: '清理分支', status: 'wait' },
  ];
}

function createSteps(taskType: TaskType, versionType?: VersionType): PipelineStep[] {
  if (taskType === 'feature') return createFeatureSteps();
  return createVersionSteps(versionType!);
}

function updateStep(task: PipelineTask, key: string, updates: Partial<PipelineStep>): PipelineTask {
  const steps = task.steps.map((s) =>
    s.key === key ? { ...s, ...updates } : s
  );
  const currentStep = steps.findIndex((s) => s.status === 'process');
  return { ...task, steps, currentStep: currentStep >= 0 ? currentStep : task.currentStep, updatedAt: Date.now() };
}

function setTaskStatus(task: PipelineTask, status: TaskStatus, error?: string): PipelineTask {
  return { ...task, status, error, updatedAt: Date.now() };
}

/** 创建 updateTask 闭包 — 减少重复代码 */
function makeUpdateTask(
  repoPath: string,
  taskId: string,
  set: (fn: (state: any) => any) => void,
): (updated: PipelineTask) => void {
  return (updated: PipelineTask) => {
    set((state) => {
      const repoTasks = (state.tasksByRepo[repoPath] || []).map((t: PipelineTask) => (t.id === taskId ? updated : t));
      const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
      persistTasks(newTasksByRepo);
      return {
        tasksByRepo: newTasksByRepo,
        currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
      };
    });
  };
}

function getRepoPath(): string | null {
  return useRepoStore.getState().repoPath;
}

/** 获取当前仓库的任务列表和指定任务 */
function getTask(taskId: string): { repoPath: string; tasks: PipelineTask[]; task: PipelineTask | undefined } | null {
  const repoPath = getRepoPath();
  if (!repoPath) return null;
  const tasks = (usePipelineStore.getState().tasksByRepo[repoPath] || []);
  const task = tasks.find((t) => t.id === taskId);
  return { repoPath, tasks, task };
}

// 持久化文件名
const STORE_FILE = 'pipeline.json';
let _storeInstance: Store | null = null;

async function ensureStore(): Promise<Store> {
  if (!_storeInstance) {
    _storeInstance = await load(STORE_FILE, { autoSave: false, defaults: {} });
  }
  return _storeInstance;
}

// 防抖持久化：1 秒内多次调用只执行最后一次，减少磁盘 I/O
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingData: Record<string, PipelineTask[]> | null = null;
let _cleanupResumeTimers: ReturnType<typeof setTimeout>[] = [];

async function persistTasks(tasksByRepo: Record<string, PipelineTask[]>): Promise<void> {
  _pendingData = tasksByRepo;
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    _persistTimer = null;
    if (!_pendingData) return;
    const data = _pendingData;
    _pendingData = null;
    try {
      const s = await ensureStore(); // 始终使用最新实例，避免闭包捕获旧 store
      await s.set('tasksByRepo', data);
      await s.save();
    } catch (e) {
      console.error('持久化任务数据失败:', e);
    }
  }, 1000);
}

let taskCounter = 0;

/** 向后兼容：为没有 phase 字段的旧任务从步骤状态推断阶段 */
function inferPhase(task: PipelineTask): PipelinePhase {
  if (task.phase) return task.phase; // 已有 phase 字段，直接返回
  if (task.status === 'success' || task.status === 'cancelled') return 'finished';
  if (task.status === 'pending') return 'pending';

  // 版本任务
  if (task.taskType === 'version') {
    const push = task.steps.find(s => s.key === 'push');
    const mr = task.steps.find(s => s.key === 'mr');
    const wait = task.steps.find(s => s.key === 'wait');
    const tag = task.steps.find(s => s.key === 'tag');
    const cleanup = task.steps.find(s => s.key === 'cleanup');

    if (cleanup?.status === 'process') return 'cleaning_up';
    if (tag?.status === 'process') return 'tagging';
    if (wait?.status === 'process') return 'waiting_merge';
    if (mr?.status === 'process') return 'creating_mr';
    if (push?.status === 'process') return 'pushing';
    if (push?.status === 'error') return 'delete_only';
    if (mr?.status === 'error') return 'delete_only';
    return 'developing';
  }

  // Feature 任务（原有逻辑）
  const sync = task.steps.find(s => s.key === 'sync');
  const push = task.steps.find(s => s.key === 'push');
  const mr = task.steps.find(s => s.key === 'mr');
  const wait = task.steps.find(s => s.key === 'wait');
  const cleanup = task.steps.find(s => s.key === 'cleanup');

  if (cleanup?.status === 'process') return 'cleaning_up';
  if (wait?.status === 'process') return 'waiting_merge';
  if (mr?.status === 'process') return 'creating_mr';
  if (push?.status === 'process') return 'pushing';
  if (sync?.status === 'process') return 'syncing';
  if (sync?.status === 'error') return 'paused_sync_error';
  if (push?.status === 'error') return 'delete_only';
  if (mr?.status === 'error') return 'delete_only';
  return 'developing';
}

/** 每仓库最多保留的已完成/已取消任务数 */
const MAX_COMPLETED_TASKS = 50;

/** 清理已完成的旧任务，只保留最近的 MAX_COMPLETED_TASKS 个 */
function trimCompletedTasks(tasks: PipelineTask[]): PipelineTask[] {
  const active = tasks.filter((t) => t.status === 'pending' || t.status === 'running' || t.status === 'paused');
  const done = tasks.filter((t) => t.status === 'success' || t.status === 'cancelled');
  if (done.length <= MAX_COMPLETED_TASKS) return tasks;
  // 按 updatedAt 降序，保留最近的
  done.sort((a, b) => b.updatedAt - a.updatedAt);
  return [...active, ...done.slice(0, MAX_COMPLETED_TASKS)];
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  tasksByRepo: {},
  currentTask: null,
  loading: false,
  error: null,
  _store: null,

  init: async () => {
    try {
      const store = await ensureStore();
      const saved = await store.get<Record<string, PipelineTask[]>>('tasksByRepo');
      if (saved) {
        // 恢复任务状态：运行中的任务标记为暂停，同时清理旧任务
        const restored: Record<string, PipelineTask[]> = {};
        const tasksToResumeCleanup: Array<{ repoPath: string; task: PipelineTask }> = [];

        for (const [repo, tasks] of Object.entries(saved)) {
          const mapped = tasks.map((t) => {
            // 向后兼容：为旧任务推断 phase
            let withPhase = { ...t, phase: inferPhase(t) };

            // 检查是否有中断的清理任务
            const cleanupStep = t.steps.find((s) => s.key === 'cleanup');
            if (cleanupStep?.status === 'process') {
              tasksToResumeCleanup.push({ repoPath: repo, task: withPhase });
              return withPhase;
            }

            // 处理中断的任务：重置所有 'process' 状态的步骤
            if (t.status === 'running') {
              const resetSteps = withPhase.steps.map((s) => {
                if (s.status === 'process') {
                  // 对于 develop 步骤，保持 process（等待用户操作）
                  if (s.key === 'develop') return s;
                  // 其他步骤重置为 wait 或 error
                  return { ...s, status: 'wait' as StepStatus, error: undefined, description: undefined };
                }
                return s;
              });
              withPhase = { ...withPhase, steps: resetSteps, status: 'paused' as TaskStatus, error: '程序重启，任务已暂停' };
            }
            return withPhase;
          });
          restored[repo] = trimCompletedTasks(mapped);
        }
        set({ tasksByRepo: restored, _store: store });

        // 异步恢复中断的清理任务（清除之前的定时器，防止 HMR 重复执行）
        for (const timer of _cleanupResumeTimers) clearTimeout(timer);
        _cleanupResumeTimers = [];
        for (const { repoPath, task } of tasksToResumeCleanup) {
          const timer = setTimeout(async () => {
            try {
              const repoExists = await invoke<boolean>('validate_repo_path', { path: repoPath });
              if (repoExists) {
                message.info('恢复中断的清理任务...');
                await executeCleanup(task, task.id, repoPath);
              }
            } catch (e) {
              console.error('恢复清理任务失败:', e);
            }
          }, 1000);
          _cleanupResumeTimers.push(timer);
        }
      } else {
        set({ _store: store });
      }
    } catch (e) {
      console.error('加载流水线数据失败:', e);
    }
  },

  switchRepo: (repoPath: string | null) => {
    const { tasksByRepo } = get();
    const tasks = repoPath ? (tasksByRepo[repoPath] || []) : [];
    const currentTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
    set({ currentTask });
  },

  createTask: (params: CreateTaskParams) => {
    const repoPath = getRepoPath();
    if (!repoPath) {
      set({ error: '请先打开仓库' });
      return null;
    }

    const id = `task_${Date.now()}_${++taskCounter}`;
    const taskType = params.taskType || 'feature';
    const versionType = params.versionType;
    const branchName = params.branchName || `feature/${params.name.toLowerCase().replace(/\s+/g, '-')}`;

    const task: PipelineTask = {
      id,
      name: params.name,
      taskType,
      versionType,
      branchName,
      version: params.version,
      status: 'pending',
      phase: 'pending',
      steps: createSteps(taskType, versionType),
      currentStep: -1,
      syncStrategy: params.syncStrategy || 'rebase',
      mrSettings: {
        enabled: true,
        squash: true,
        deleteBranchAfterMerge: true,
        autoMerge: false,
        targetBranch: 'develop',
        ...params.mrSettings,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    set((state) => {
      const repoTasks = trimCompletedTasks([...(state.tasksByRepo[repoPath] || []), task]);
      const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
      // 异步持久化
      persistTasks(newTasksByRepo);
      return { tasksByRepo: newTasksByRepo, currentTask: task };
    });

    // 根据任务类型给分支打上对应标签
    const branchTag = taskType === 'version'
      ? (versionType === 'release' ? 'release' : 'hotfix')
      : 'task';
    useBranchTagStore.getState().setTag(repoPath, branchName, branchTag);

    return task;
  },

  startTask: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    const { repoPath, task } = ctx;
    if (task.status === 'running') return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = makeUpdateTask(repoPath, taskId, set);
    updateTask(currentTask);

    try {
      // Step 1: 创建分支
      currentTask = updateStep(currentTask, 'branch', { status: 'process', startTime: Date.now() });
      updateTask(currentTask);

      // 先 fetch 确保有最新的远程分支
      await invoke('git_fetch', { repoPath });

      // 版本任务从不同源分支切出
      let sourceBranch = `origin/${task.mrSettings.targetBranch}`;
      if (task.taskType === 'version' && task.versionType === 'release') {
        // release 从 develop 切出
        const branchTagStore = useBranchTagStore.getState();
        const devBranch = repoPath ? branchTagStore.getTargetBranch(repoPath) : null;
        sourceBranch = `origin/${devBranch || 'develop'}`;
      } else if (task.taskType === 'version' && task.versionType === 'hotfix') {
        // hotfix 从 main 切出
        sourceBranch = `origin/${task.mrSettings.targetBranch}`;
      }

      await invoke('git_checkout', {
        repoPath,
        target: task.branchName,
        createBranch: true,
        startPoint: sourceBranch,
      });

      await useRepoStore.getState().refreshStatus();

      currentTask = updateStep(currentTask, 'branch', {
        status: 'finish', endTime: Date.now(), description: task.branchName,
      });
      updateTask(currentTask);

      // Step 2: 开发修改 — 暂停等待用户操作
      const developTitle = task.taskType === 'version'
        ? (task.versionType === 'release' ? '请准备版本内容' : '请进行紧急修复')
        : '请在工作区修改代码';
      currentTask = updateStep(currentTask, 'develop', {
        status: 'process', description: `${developTitle}，完成后点击"提交代码"`,
      });
      currentTask = setTaskStatus(currentTask, 'paused');
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);
      return;

    } catch (e) {
      const errorMsg = String(e);
      console.error('startTask error:', errorMsg);
      currentTask = updateStep(currentTask, 'branch', {
        status: 'error', error: errorMsg, endTime: Date.now(),
      });
      // 分支创建失败 → 回到 pending，用户可重试开始
      currentTask = setTaskStatus(currentTask, 'paused', errorMsg);
      currentTask = { ...currentTask, phase: 'pending' };
      updateTask(currentTask);
    }
  },

  // 提交代码（开发步骤完成后）
  commitCode: async (taskId: string, message?: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return; // 防止并发执行
    const { repoPath, task } = ctx;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = makeUpdateTask(repoPath, taskId, set);
    updateTask(currentTask);

    try {
      const repoStore = useRepoStore.getState();
      await repoStore.refreshStatus();
      const repoInfo = repoStore.repoInfo;

      // 检查是否有变更
      const hasChanges = repoInfo && repoInfo.status.length > 0;
      if (!hasChanges) {
        // 无变更 → 保留原 phase，不改变状态
        currentTask = setTaskStatus(currentTask, 'paused', '没有代码变更');
        currentTask = { ...currentTask, phase: task.phase }; // 保留原 phase
        updateTask(currentTask);
        return;
      }

      // 只提交已暂存的文件，如果没有暂存的文件则暂存所有
      const stagedFiles = repoInfo.status.filter((f) => f.staged);
      if (stagedFiles.length === 0) {
        await invoke('git_stage_all', { repoPath });
      }
      await invoke('git_commit', {
        repoPath,
        params: { message: message || task.name, files: [], amend: false },
      });

      await repoStore.refreshStatus();

      // 更新步骤状态
      currentTask = updateStep(currentTask, 'develop', {
        status: 'finish', endTime: Date.now(), description: '已提交',
      });
      currentTask = updateStep(currentTask, 'commit', {
        status: 'finish', endTime: Date.now(), description: '已提交',
      });
      // 提交完成后暂停，仍在开发阶段（可继续改或同步）
      currentTask = setTaskStatus(currentTask, 'paused');
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);

    } catch (e) {
      const errorMsg = String(e);
      // 提供更友好的错误信息
      let friendlyMsg = errorMsg;
      if (errorMsg.includes('nothing to commit')) {
        friendlyMsg = '没有代码变更，请先修改文件再提交';
      } else if (errorMsg.includes('nothing staged')) {
        friendlyMsg = '没有暂存的文件，请先修改文件再提交';
      }

      // 弹出提示，不改变步骤状态，用户可以继续修改代码
      currentTask = setTaskStatus(currentTask, 'paused', friendlyMsg);
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);
    }
  },

  // 同步远程（fetch + rebase/merge）
  syncRemote: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return;
    const { repoPath, task } = ctx;

    let currentTask = setTaskStatus(task, 'running');
    currentTask = { ...currentTask, phase: 'syncing' };
    const updateTask = makeUpdateTask(repoPath, taskId, set);
    updateTask(currentTask);

    try {
      // 检查是否有未提交的更改
      const repoInfo = useRepoStore.getState().repoInfo;
      if (repoInfo && repoInfo.status.length > 0) {
        throw new Error('当前有未提交的更改，请先提交代码再同步');
      }

      currentTask = updateStep(currentTask, 'sync', { status: 'process', startTime: Date.now(), description: '正在获取远程更新...' });
      updateTask(currentTask);

      await invoke('git_fetch', { repoPath });

      const strategy = task.syncStrategy;
      currentTask = updateStep(currentTask, 'sync', { description: `正在${strategy === 'rebase' ? '变基' : '合并'}...` });
      updateTask(currentTask);

      try {
        if (strategy === 'rebase') {
          await invoke('git_rebase', { repoPath, onto: `origin/${task.mrSettings.targetBranch}` });
        } else {
          await invoke('git_merge', { repoPath, branch: `origin/${task.mrSettings.targetBranch}` });
        }

        await useRepoStore.getState().refreshStatus();

        currentTask = updateStep(currentTask, 'sync', {
          status: 'finish', endTime: Date.now(), description: `已${strategy === 'rebase' ? '变基' : '合并'}`,
        });
        // 同步成功，进入开发阶段（用户可继续开发或推送）
        currentTask = setTaskStatus(currentTask, 'paused');
        currentTask = { ...currentTask, phase: 'developing' };
        updateTask(currentTask);

      } catch (syncError) {
        const errorMsg = String(syncError);
        if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict') || errorMsg.includes('could not apply')) {
          currentTask = updateStep(currentTask, 'sync', {
            status: 'error', error: '存在冲突，请手动解决后点击"继续同步"', endTime: Date.now(),
          });
          currentTask = setTaskStatus(currentTask, 'paused', '存在冲突');
          currentTask = { ...currentTask, phase: 'paused_sync_error' };
          updateTask(currentTask);
          return;
        }
        throw syncError;
      }

    } catch (e) {
      const errorMsg = String(e);
      let friendlyMsg = errorMsg;
      if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict')) {
        friendlyMsg = '存在冲突，请在工作区手动解决后点击"继续同步"';
      } else if (errorMsg.includes('Could not resolve host')) {
        friendlyMsg = '网络连接失败，请检查网络';
      } else if (errorMsg.includes('未提交的更改')) {
        friendlyMsg = '当前有未提交的更改，请先提交代码再同步';
      }
      currentTask = updateStep(currentTask, 'sync', {
        status: 'error', error: friendlyMsg, endTime: Date.now(),
      });
      currentTask = setTaskStatus(currentTask, 'paused', friendlyMsg);
      currentTask = { ...currentTask, phase: 'paused_sync_error' };
      updateTask(currentTask);
    }
  },

  // 推送到远程
  pushRemote: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return; // 防止并发执行
    const { repoPath, task } = ctx;

    let currentTask = setTaskStatus(task, 'running');
    currentTask = { ...currentTask, phase: 'pushing' };
    const updateTask = makeUpdateTask(repoPath, taskId, set);
    updateTask(currentTask);

    try {
      currentTask = updateStep(currentTask, 'push', { status: 'process', startTime: Date.now() });
      updateTask(currentTask);

      const force = task.syncStrategy === 'rebase';
      await invoke('git_push', { repoPath, remote: 'origin', force });

      await useRepoStore.getState().refreshStatus();

      currentTask = updateStep(currentTask, 'push', {
        status: 'finish', endTime: Date.now(), description: force ? '已强制推送' : '已推送',
      });

      // 版本任务推送后进入开发阶段，用户确认后创建 MR
      currentTask = setTaskStatus(currentTask, 'paused');
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);

    } catch (e) {
      const errorMsg = String(e);
      let friendlyMsg = errorMsg;
      if (errorMsg.includes('rejected')) {
        friendlyMsg = '推送被拒绝，可能需要先同步远程或检查权限';
      } else if (errorMsg.includes('Could not resolve host')) {
        friendlyMsg = '网络连接失败，请检查网络';
      } else if (errorMsg.includes('permission')) {
        friendlyMsg = '没有推送权限，请检查仓库访问权限';
      }

      message.error(friendlyMsg);
      currentTask = updateStep(currentTask, 'push', {
        status: 'error', error: friendlyMsg, endTime: Date.now(),
      });
      // 推送失败 → 回到开发阶段，用户可同步后重试推送
      currentTask = setTaskStatus(currentTask, 'paused');
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);
    }
  },

  // 创建 MR
  createMR: async (taskId: string, commitMessage?: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return; // 防止并发执行
    const { repoPath, task } = ctx;

    // 防止重复创建 MR
    if (task.mrIid) {
      message.warning('MR 已存在，请勿重复创建');
      return;
    }

    let currentTask = setTaskStatus(task, 'running');
    currentTask = { ...currentTask, phase: 'creating_mr' };
    const updateTask = makeUpdateTask(repoPath, taskId, set);
    updateTask(currentTask);

    try {
      if (task.mrSettings.enabled) {
        currentTask = updateStep(currentTask, 'mr', { status: 'process', startTime: Date.now() });
        updateTask(currentTask);

        const gitlabStore = useGitLabStore.getState();
        let { service, currentProject } = gitlabStore;

        // 如果没有选择项目，尝试自动选择
        if (service && !currentProject) {
          if (repoPath) {
            const repoName = repoPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || '';
            try {
              await gitlabStore.searchProjects(repoName);
              const matched = gitlabStore.projects.find((p) => p.path === repoName || p.name === repoName);
              if (matched) {
                gitlabStore.selectProject(matched);
                currentProject = matched;
              }
            } catch (e) {
              console.error('createMR: auto search failed', e);
            }
          }
        }

        if (service && currentProject) {
          try {
            const mrTitle = task.mrSettings.title || task.name;
            const mr = await service.createMergeRequest(
              currentProject.path_with_namespace,
              {
                source_branch: task.branchName,
                target_branch: task.mrSettings.targetBranch,
                title: mrTitle,
                description: task.mrSettings.description || '',
                remove_source_branch: task.mrSettings.deleteBranchAfterMerge,
                squash: task.mrSettings.squash,
                squash_commit_message: task.mrSettings.squash ? (commitMessage || undefined) : undefined,
              },
            );

            currentTask = { ...currentTask, mrIid: mr.iid, mrUrl: mr.web_url || undefined, squashCommitMessage: commitMessage || undefined };
            currentTask = updateStep(currentTask, 'mr', {
              status: 'finish', endTime: Date.now(), description: `MR !${mr.iid}`,
            });
            updateTask(currentTask);

            // 进入等待合并步骤
            currentTask = updateStep(currentTask, 'wait', { status: 'process', description: '等待 MR 合并' });
            currentTask = setTaskStatus(currentTask, 'paused', '等待 MR 合并');
            currentTask = { ...currentTask, phase: 'waiting_merge' };
            updateTask(currentTask);

            return;

          } catch (mrError) {
            console.error('createMR: error', mrError);
            message.error(`创建 MR 失败: ${mrError}`);
            currentTask = updateStep(currentTask, 'mr', { status: 'error', error: String(mrError), endTime: Date.now() });
            // MR 创建失败 → 回到开发阶段，用户可重试创建 MR
            currentTask = setTaskStatus(currentTask, 'paused');
            currentTask = { ...currentTask, phase: 'developing' };
            updateTask(currentTask);
            return;
          }
        } else {
          currentTask = updateStep(currentTask, 'mr', { status: 'skip', description: '未配置 GitLab' });
          updateTask(currentTask);
        }
      } else {
        currentTask = updateStep(currentTask, 'mr', { status: 'skip', description: '已禁用' });
        updateTask(currentTask);
      }

      // MR 禁用或未配置 GitLab，直接清理
      await executeCleanup(currentTask, taskId, repoPath);

    } catch (e) {
      const errorMsg = String(e);
      message.error(errorMsg);
      // 保留 developing phase，用户可重试
      currentTask = setTaskStatus(currentTask, 'paused');
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);
    }
  },

  // 创建版本 MR（release/hotfix）- 并行创建 MR→main 和 MR→develop
  createVersionMR: async (taskId: string, commitMessage?: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return;
    const { repoPath, task } = ctx;

    // 防止重复创建 MR
    if (task.mrMainIid || task.mrDevIid) {
      message.warning('MR 已存在，请勿重复创建');
      return;
    }

    let currentTask = setTaskStatus(task, 'running');
    currentTask = { ...currentTask, phase: 'creating_mr' };
    currentTask = updateStep(currentTask, 'mr', { status: 'process', startTime: Date.now() });
    const updateTask = makeUpdateTask(repoPath, taskId, set);
    updateTask(currentTask);

    try {
      const gitlabStore = useGitLabStore.getState();
      let { service, currentProject } = gitlabStore;

      // 如果没有选择项目，尝试自动选择
      if (service && !currentProject) {
        if (repoPath) {
          const repoName = repoPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || '';
          try {
            await gitlabStore.searchProjects(repoName);
            const matched = gitlabStore.projects.find((p) => p.path === repoName || p.name === repoName);
            if (matched) {
              gitlabStore.selectProject(matched);
              currentProject = matched;
            }
          } catch (e) {
            console.error('createVersionMR: auto search failed', e);
          }
        }
      }

      if (!service || !currentProject) {
        message.error('未配置 GitLab');
        currentTask = setTaskStatus(currentTask, 'paused', '未配置 GitLab');
        currentTask = { ...currentTask, phase: 'developing' };
        updateTask(currentTask);
        return;
      }

      const mrTitle = `${task.versionType === 'release' ? 'Release' : 'Hotfix'}: ${task.version || task.name}`;
      const branchTagStore = useBranchTagStore.getState();
      const devBranch = branchTagStore.getTargetBranch(repoPath) || 'develop';

      // Release 任务：先合并 main 到 release，避免 MR 冲突
      if (task.versionType === 'release') {
        try {
          await invoke('git_fetch', { repoPath });
          await invoke('git_merge', {
            repoPath,
            branch: `origin/${task.mrSettings.targetBranch}`,
            strategy: 'ours',
          });
        } catch (mergeError) {
          console.warn('合并 main 到 release 失败:', mergeError);
          // 合并失败继续创建 MR，让用户手动解决
        }
      }

      // 并行创建两个 MR
      const [mrMainResult, mrDevResult] = await Promise.allSettled([
        // MR→main
        service.createMergeRequest(
          currentProject.path_with_namespace,
          {
            source_branch: task.branchName,
            target_branch: task.mrSettings.targetBranch, // main
            title: mrTitle,
            description: task.mrSettings.description || '',
            remove_source_branch: false, // 不删除，等两个 MR 都合并
            squash: task.mrSettings.squash,
            squash_commit_message: task.mrSettings.squash ? (commitMessage || undefined) : undefined,
          },
        ),
        // MR→develop
        service.createMergeRequest(
          currentProject.path_with_namespace,
          {
            source_branch: task.branchName,
            target_branch: devBranch,
            title: `${mrTitle} (merge to ${devBranch})`,
            description: task.mrSettings.description || '',
            remove_source_branch: false, // 不删除，等两个 MR 都合并
            squash: task.mrSettings.squash,
            squash_commit_message: task.mrSettings.squash ? (commitMessage || undefined) : undefined,
          },
        ),
      ]);

      // 处理 MR→main 结果
      if (mrMainResult.status === 'fulfilled') {
        const mrMain = mrMainResult.value;
        currentTask = { ...currentTask, mrMainIid: mrMain.iid, mrMainUrl: mrMain.web_url || undefined };
      } else {
        console.error('createVersionMR: mr_main error', mrMainResult.reason);
        message.error(`创建 MR→main 失败: ${mrMainResult.reason}`);
      }

      // 处理 MR→develop 结果
      if (mrDevResult.status === 'fulfilled') {
        const mrDev = mrDevResult.value;
        currentTask = { ...currentTask, mrDevIid: mrDev.iid, mrDevUrl: mrDev.web_url || undefined, mrIid: mrDev.iid, mrUrl: mrDev.web_url || undefined };
      } else {
        console.error('createVersionMR: mr_dev error', mrDevResult.reason);
        message.error(`创建 MR→develop 失败: ${mrDevResult.reason}`);
      }

      // 检查是否都创建成功
      const mrMainSuccess = mrMainResult.status === 'fulfilled';
      const mrDevSuccess = mrDevResult.status === 'fulfilled';

      if (mrMainSuccess && mrDevSuccess) {
        // 两个 MR 都创建成功
        currentTask = {
          ...currentTask,
          squashCommitMessage: commitMessage || undefined,
        };
        currentTask = updateStep(currentTask, 'mr', {
          status: 'finish', endTime: Date.now(),
          description: `MR !${currentTask.mrMainIid} + MR !${currentTask.mrDevIid}`,
        });
        // 进入等待合并步骤
        currentTask = updateStep(currentTask, 'wait', { status: 'process', description: '等待两个 MR 合并' });
        currentTask = setTaskStatus(currentTask, 'paused', '等待 MR 合并');
        currentTask = { ...currentTask, phase: 'waiting_merge' };
      } else if (mrMainSuccess || mrDevSuccess) {
        // 只有一个成功
        currentTask = updateStep(currentTask, 'mr', {
          status: 'error', endTime: Date.now(),
          error: '部分 MR 创建失败，请检查后重试',
        });
        currentTask = setTaskStatus(currentTask, 'paused', '部分 MR 创建失败');
        currentTask = { ...currentTask, phase: 'developing' };
      } else {
        // 都失败
        currentTask = updateStep(currentTask, 'mr', {
          status: 'error', endTime: Date.now(),
          error: 'MR 创建失败',
        });
        currentTask = setTaskStatus(currentTask, 'paused', 'MR 创建失败');
        currentTask = { ...currentTask, phase: 'developing' };
      }

      updateTask(currentTask);

    } catch (e) {
      const errorMsg = String(e);
      message.error(errorMsg);
      currentTask = updateStep(currentTask, 'mr', { status: 'error', error: errorMsg, endTime: Date.now() });
      currentTask = setTaskStatus(currentTask, 'paused');
      currentTask = { ...currentTask, phase: 'developing' };
      updateTask(currentTask);
    }
  },

  // 检查 MR 合并状态
  checkMergeStatus: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return; // 防止并发执行
    const { repoPath, task } = ctx;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = makeUpdateTask(repoPath, taskId, set);

    updateTask(currentTask);

    try {
      await checkMRAndCleanup(currentTask, taskId, updateTask, repoPath, task);
    } catch (e) {
      console.error('检查 MR 状态失败:', e);
      currentTask = setTaskStatus(currentTask, 'paused');
      updateTask(currentTask);
    }
  },

  deleteTask: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) {
      console.error('deleteTask: task not found', taskId);
      return;
    }
    const { repoPath, task } = ctx;

    try {
      // 1. 中止 rebase（如果正在进行，仅 feature 任务）
      if (task.taskType === 'feature') {
        const syncStep = task.steps.find((s) => s.key === 'sync');
        if (syncStep?.status === 'error' || syncStep?.status === 'process') {
          try {
            await invoke('git_abort_rebase', { repoPath });
          } catch (e) {
            console.warn('操作失败（已忽略）:', e);
          }
        }
      }

      // 2. 关闭 MR（如果存在）
      const gitlabStore = useGitLabStore.getState();
      const { service, currentProject } = gitlabStore;

      if (task.taskType === 'version') {
        // 版本任务：关闭两个 MR
        const mrMainStep = task.steps.find((s) => s.key === 'mr_main');
        if (mrMainStep?.status === 'finish' && task.mrMainIid && service && currentProject) {
          try {
            await service.closeMergeRequest(currentProject.path_with_namespace, task.mrMainIid);
          } catch {
            // MR 可能已经关闭，忽略
          }
        }
        const mrDevStep = task.steps.find((s) => s.key === 'mr_dev');
        if (mrDevStep?.status === 'finish' && task.mrDevIid && service && currentProject) {
          try {
            await service.closeMergeRequest(currentProject.path_with_namespace, task.mrDevIid);
          } catch {
            // MR 可能已经关闭，忽略
          }
        }
      } else {
        // Feature 任务：关闭一个 MR
        const mrStep = task.steps.find((s) => s.key === 'mr');
        if (mrStep?.status === 'finish' && task.mrIid && service && currentProject) {
          try {
            await service.closeMergeRequest(currentProject.path_with_namespace, task.mrIid);
          } catch {
            // MR 可能已经关闭，忽略
          }
        }
      }

      // 3. 切回目标分支（版本任务切回 develop，feature 切回目标分支）
      try {
        const checkoutTarget = task.taskType === 'version'
          ? (useBranchTagStore.getState().getTargetBranch(repoPath) || 'develop')
          : task.mrSettings.targetBranch;
        await invoke('git_checkout', {
          repoPath,
          target: checkoutTarget,
          createBranch: false,
          startPoint: null,
        });
      } catch {
        // 忽略
      }

      // 4. 删除本地分支
      const branchStep = task.steps.find((s) => s.key === 'branch');
      if (branchStep?.status === 'finish') {
        try {
          await invoke('git_branch_delete', { repoPath, branch: task.branchName, force: true });
        } catch {
          // 可能正在当前分支或已删除，忽略
        }
      }

      // 5. 删除远程分支（不管 pipeline 有没有记录推送，都尝试删）
      try {
        await invoke('git_push', {
          repoPath,
          remote: 'origin',
          force: false,
          delete: true,
          branch: task.branchName,
        });
      } catch {
        // 远程分支可能已删除，忽略
      }

      await useRepoStore.getState().refreshStatus();

      // 6. 移除任务分支标签
      try {
        await useBranchTagStore.getState().removeTag(repoPath, task.branchName);
      } catch {
        // 忽略
      }

      // 7. 从列表移除
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).filter((t) => t.id !== taskId);
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? null : state.currentTask,
        };
      });

      message.success('任务已删除，分支和 MR 已清理');

    } catch (e) {
      console.error('deleteTask error:', e);
      // 兜底：至少从列表移除
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).filter((t) => t.id !== taskId);
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? null : state.currentTask,
        };
      });
      message.error('删除任务失败');
    }
  },

  setCurrentTask: (taskId: string | null) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    set({ currentTask: taskId ? tasks.find((t) => t.id === taskId) || null : null });
  },

  checkAndCleanTasks: async () => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    // 清理非当前仓库且全部任务已完成的旧条目
    set((state) => {
      const pruned: Record<string, PipelineTask[]> = {};
      for (const [key, tasks] of Object.entries(state.tasksByRepo)) {
        if (key === repoPath || tasks.some((t) => t.status === 'pending' || t.status === 'running' || t.status === 'paused')) {
          pruned[key] = tasks;
        }
      }
      if (Object.keys(pruned).length < Object.keys(state.tasksByRepo).length) {
        persistTasks(pruned);
        return { tasksByRepo: pruned };
      }
      return {};
    });

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    if (tasks.length === 0) return;

    try {
      // 刷新状态获取最新分支信息
      await useRepoStore.getState().refreshStatusSilent();

      // 从store中获取更新后的repoInfo
      const repoInfo = useRepoStore.getState().repoInfo;
      if (!repoInfo) return;

      const branches = repoInfo.branches.map((b) => b.name);
      const localBranches = branches.filter((b) => !b.startsWith('remotes/'));

      // 找出任务分支已不存在的任务
      const tasksToRemove = tasks.filter((task) => {
        if (task.status === 'pending') return false;
        return !localBranches.includes(task.branchName);
      });

      // 并发清理任务（远程分支、标签）
      const cleanupPromises = tasksToRemove.map(async (task) => {
        // 1. 尝试删除远程分支（不管 pipeline 有没有记录推送，都尝试删）
        try {
          await invoke('git_push', {
            repoPath, remote: 'origin', force: false,
            delete: true, branch: task.branchName,
          });
        } catch (e) { console.warn('删除远程分支失败（已忽略）:', e); }

        // 2. 移除任务分支标签
        try {
          await useBranchTagStore.getState().removeTag(repoPath, task.branchName);
        } catch (e) { console.warn('移除标签失败（已忽略）:', e); }
      });
      await Promise.allSettled(cleanupPromises);

      // 从列表中移除
      const removeIds = new Set(tasksToRemove.map((t) => t.id));
      const remainingTasks = tasks.filter((t) => !removeIds.has(t.id));
      const newTasksByRepo = { ...tasksByRepo, [repoPath]: remainingTasks };

      set((state) => {
        persistTasks(newTasksByRepo);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask && removeIds.has(state.currentTask.id) ? null : state.currentTask,
        };
      });

      if (tasksToRemove.length > 0) {
        message.warning(`${tasksToRemove.length} 个任务的分支已被删除，已自动清理`);
      }
    } catch (e) {
      console.error('检查任务分支失败:', e);
    }
  },

  abortRebase: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    try {
      await invoke('git_abort_rebase', { repoPath });
      const { tasksByRepo } = get();
      const tasks = tasksByRepo[repoPath] || [];
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        let resetTask = updateStep(task, 'sync', { status: 'wait', error: undefined });
        resetTask = setTaskStatus(resetTask, 'paused');
        resetTask = { ...resetTask, phase: 'developing' as PipelinePhase };
        set((state) => {
          const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? resetTask : t));
          const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
          persistTasks(newTasksByRepo);
          return {
            tasksByRepo: newTasksByRepo,
            currentTask: state.currentTask?.id === taskId ? resetTask : state.currentTask,
          };
        });
      }
    } catch (e) {
      set({ error: `中止 rebase 失败: ${e}` });
    }
  },

  // 继续开发 — 回到开发步骤（保留已完成的步骤，只重置后续步骤）
  resumeDevelopment: (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    const { repoPath, task } = ctx;

    const developTitle = task.taskType === 'version'
      ? (task.versionType === 'release' ? '请准备版本内容' : '请进行紧急修复')
      : '请在工作区修改代码';

    let updated = updateStep(task, 'develop', { status: 'process', description: `${developTitle}，完成后点击"提交代码"` });
    updated = updateStep(updated, 'commit', { status: 'wait', error: undefined, description: undefined });
    updated = updateStep(updated, 'push', { status: 'wait', error: undefined, description: undefined });

    if (task.taskType === 'feature') {
      // Feature 任务：重置 sync 和 mr 步骤
      updated = updateStep(updated, 'sync', { status: 'wait', error: undefined, description: undefined });
      updated = updateStep(updated, 'mr', { status: 'wait', error: undefined, description: undefined });
      updated = { ...updated, mrPollStatus: undefined };
    } else {
      // 版本任务：重置 mr、wait、tag 步骤
      updated = updateStep(updated, 'mr', { status: 'wait', error: undefined, description: undefined });
      updated = updateStep(updated, 'wait', { status: 'wait', error: undefined, description: undefined });
      updated = updateStep(updated, 'tag', { status: 'wait', error: undefined, description: undefined });
      updated = { ...updated, mrPollStatus: undefined };
    }

    updated = setTaskStatus(updated, 'paused');
    updated = { ...updated, phase: 'developing' };

    set((state) => {
      const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
      const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
      persistTasks(newTasksByRepo);
      return {
        tasksByRepo: newTasksByRepo,
        currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
      };
    });
  },

  // 冲突状态恢复 — 同步 + 推送 + 回到等待合并
  resumeFromConflict: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    if (ctx.task.status === 'running') return; // 防止并发执行
    const { repoPath, task } = ctx;

    const updateTask = makeUpdateTask(repoPath, taskId, set);

    // 1. 重置状态，开始同步
    let currentTask = updateStep(task, 'wait', { status: 'wait', error: undefined, description: undefined });
    currentTask = updateStep(currentTask, 'sync', { status: 'process', startTime: Date.now(), description: '正在同步远程...' });
    currentTask = { ...currentTask, mrPollStatus: undefined };
    currentTask = setTaskStatus(currentTask, 'running');
    currentTask = { ...currentTask, phase: 'syncing' };
    updateTask(currentTask);

    try {
      // 2. 检查未提交更改
      const repoInfo = useRepoStore.getState().repoInfo;
      if (repoInfo && repoInfo.status.length > 0) {
        throw new Error('当前有未提交的更改，请先提交代码再同步');
      }

      // 3. Fetch + Rebase/Merge
      currentTask = updateStep(currentTask, 'sync', { description: '正在获取远程更新...' });
      updateTask(currentTask);
      await invoke('git_fetch', { repoPath });

      const strategy = task.syncStrategy;
      currentTask = updateStep(currentTask, 'sync', { description: `正在${strategy === 'rebase' ? '变基' : '合并'}...` });
      updateTask(currentTask);

      if (strategy === 'rebase') {
        await invoke('git_rebase', { repoPath, onto: `origin/${task.mrSettings.targetBranch}` });
      } else {
        await invoke('git_merge', { repoPath, branch: `origin/${task.mrSettings.targetBranch}` });
      }

      // 4. 同步成功
      currentTask = updateStep(currentTask, 'sync', { status: 'finish', endTime: Date.now(), description: '已同步' });
      currentTask = updateStep(currentTask, 'push', { status: 'process', startTime: Date.now(), description: '正在推送...' });
      updateTask(currentTask);

      // 5. 推送
      const force = task.syncStrategy === 'rebase';
      await invoke('git_push', { repoPath, remote: 'origin', force });

      // 6. 推送成功，回到等待合并
      currentTask = updateStep(currentTask, 'push', { status: 'finish', endTime: Date.now(), description: '已推送' });
      currentTask = updateStep(currentTask, 'wait', { status: 'process', description: '等待 MR 合并' });
      currentTask = setTaskStatus(currentTask, 'paused', '等待 MR 合并');
      currentTask = { ...currentTask, phase: 'waiting_merge' };
      updateTask(currentTask);

      await useRepoStore.getState().refreshStatus();
      message.success('同步完成，等待 MR 合并');

    } catch (e) {
      const errorMsg = String(e);
      let friendlyMsg = errorMsg;

      if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict') || errorMsg.includes('could not apply')) {
        friendlyMsg = '存在冲突，请手动解决后点击"同步远程"';
        currentTask = updateStep(currentTask, 'sync', { status: 'error', error: friendlyMsg, endTime: Date.now() });
      } else if (errorMsg.includes('未提交的更改')) {
        friendlyMsg = '当前有未提交的更改，请先提交代码再同步';
        currentTask = updateStep(currentTask, 'sync', { status: 'error', error: friendlyMsg, endTime: Date.now() });
      } else if (errorMsg.includes('Could not resolve host')) {
        friendlyMsg = '网络连接失败，请检查网络';
        currentTask = updateStep(currentTask, 'sync', { status: 'error', error: friendlyMsg, endTime: Date.now() });
      } else if (errorMsg.includes('rejected')) {
        friendlyMsg = '推送被拒绝，可能需要先同步远程或检查权限';
        currentTask = updateStep(currentTask, 'push', { status: 'error', error: friendlyMsg, endTime: Date.now() });
      } else {
        currentTask = updateStep(currentTask, 'sync', { status: 'error', error: friendlyMsg, endTime: Date.now() });
      }

      currentTask = setTaskStatus(currentTask, 'paused', friendlyMsg);
      currentTask = { ...currentTask, phase: 'paused_sync_error' };
      updateTask(currentTask);
      message.error(friendlyMsg);
    }
  },

  // 轮询 MR 状态
  pollMrStatus: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    const { repoPath, task } = ctx;
    // 版本任务轮询 MR→develop，feature 任务轮询 MR
    const mrIid = task.taskType === 'version' ? task.mrDevIid : task.mrIid;
    if (!mrIid) return;

    const gitlabStore = useGitLabStore.getState();
    let { service, currentProject } = gitlabStore;
    if (!service) return;

    // 如果没有选择项目，尝试自动选择
    if (!currentProject && repoPath) {
      const repoName = repoPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || '';
      try {
        await gitlabStore.searchProjects(repoName);
        const matched = gitlabStore.projects.find((p) => p.path === repoName || p.name === repoName);
        if (matched) {
          gitlabStore.selectProject(matched);
          currentProject = matched;
        }
      } catch (e) {
        console.warn('[pollMrStatus] Auto-select project failed:', e);
      }
    }

    if (!currentProject) return;

    try {
      const mr = await service.getMergeRequest(currentProject.path_with_namespace, mrIid);

      let newStatus: MrPollStatus = 'idle';

      if (mr.state === 'merged') {
        newStatus = 'merged';
      } else if (mr.state === 'closed') {
        newStatus = 'closed';
      } else {
        const detailed = mr.detailed_merge_status || '';
        if (detailed === 'conflict') newStatus = 'conflict';
        else if (detailed === 'ci_must_pass' || detailed === 'not_mergeable') newStatus = 'pipeline_failed';
        else if (detailed === 'not_approved') newStatus = 'not_approved';
        else if (detailed === 'mergeable') newStatus = 'mergeable';
      }

      // 自动合并：MR 可合并且开启了自动合并
      if (newStatus === 'mergeable' && task.mrSettings.autoMerge && mrIid) {
        try {
          const squashCommitMsg = task.mrSettings.squash ? (task.squashCommitMessage || undefined) : undefined;

          // 版本任务：先尝试合并 MR→main（如果还没合并）
          if (task.taskType === 'version' && task.mrMainIid) {
            try {
              const mrMain = await service.getMergeRequest(currentProject.path_with_namespace, task.mrMainIid);
              if (mrMain.state !== 'merged' && mrMain.detailed_merge_status === 'mergeable') {
                await service.mergeMergeRequest(
                  currentProject.path_with_namespace,
                  task.mrMainIid,
                  {
                    squash: task.mrSettings.squash,
                    should_remove_source_branch: false,
                    squash_commit_message: squashCommitMsg,
                  },
                );
              }
            } catch (e) {
              console.warn('[pollMrStatus] 自动合并 MR→main 失败:', e);
            }
          }

          // 合并当前 MR（MR→develop）
          await service.mergeMergeRequest(
            currentProject.path_with_namespace,
            mrIid,
            {
              squash: task.mrSettings.squash,
              should_remove_source_branch: task.taskType === 'version' ? false : task.mrSettings.deleteBranchAfterMerge,
              squash_commit_message: squashCommitMsg,
            },
          );
          // 合并成功，重新轮询获取最终状态
          return;
        } catch (e) {
          console.warn('[pollMrStatus] 自动合并失败:', e);
          // 合并失败继续走正常状态更新流程
        }
      }

      // 检查是否需要执行清理（MR 已合并但清理未完成）
      const cleanupStep = task.steps.find((s) => s.key === 'cleanup');
      // cleanup 为 'wait' 或 'process'（中断的清理）都需要执行
      const needCleanup = newStatus === 'merged' && (!cleanupStep || cleanupStep.status === 'wait' || cleanupStep.status === 'process');

      // 只在状态变化时更新，或者需要执行清理时
      if (task.mrPollStatus !== newStatus || needCleanup) {
        // 如果 MR 已合并且需要清理
        if (needCleanup) {
          // 版本任务需要检查 MR→main 也已合并
          if (task.taskType === 'version' && task.mrMainIid) {
            try {
              const mrMain = await service.getMergeRequest(currentProject.path_with_namespace, task.mrMainIid);
              if (mrMain.state !== 'merged') {
                // MR→main 还没合并，检查具体状态
                let mainMrStatus: MrPollStatus = 'idle';
                if (mrMain.state === 'closed') {
                  mainMrStatus = 'closed';
                } else {
                  const detailed = mrMain.detailed_merge_status || '';
                  if (detailed === 'conflict') mainMrStatus = 'conflict';
                  else if (detailed === 'ci_must_pass' || detailed === 'not_mergeable') mainMrStatus = 'pipeline_failed';
                  else if (detailed === 'not_approved') mainMrStatus = 'not_approved';
                  else if (detailed === 'mergeable') mainMrStatus = 'mergeable';
                }

                // 更新状态，显示 MR→main 的实际状态
                const updatedTask: PipelineTask = {
                  ...task,
                  mrPollStatus: mainMrStatus,
                  updatedAt: Date.now(),
                };
                set((state) => {
                  const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) =>
                    t.id === taskId ? updatedTask : t
                  );
                  const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
                  persistTasks(newTasksByRepo);
                  return {
                    tasksByRepo: newTasksByRepo,
                    currentTask: state.currentTask?.id === taskId ? updatedTask : state.currentTask,
                  };
                });
                return;
              }
            } catch (e) {
              console.warn('[pollMrStatus] 检查 MR→main 状态失败:', e);
            }
          }
          // 两个 MR 都合并，先打 Tag 再清理
          await executeTagAndCleanup(task, taskId, repoPath);
          return;
        }

        // 其他状态更新
        const updatedTask: PipelineTask = { ...task, mrPollStatus: newStatus, updatedAt: Date.now() };

        set((state) => {
          const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) =>
            t.id === taskId ? updatedTask : t
          );
          const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
          persistTasks(newTasksByRepo);
          return {
            tasksByRepo: newTasksByRepo,
            currentTask: state.currentTask?.id === taskId ? updatedTask : state.currentTask,
          };
        });

        // 状态变化时发通知
        switch (newStatus) {
          case 'conflict':
            message.warning('MR 存在冲突，请解决后推送');
            break;
          case 'pipeline_failed':
            message.error('流水线失败，请检查代码');
            break;
          case 'not_approved':
            message.info('等待审批中');
            break;
          case 'closed':
            message.warning('MR 已关闭');
            break;
        }
      }
    } catch (e) {
      console.warn('轮询 MR 状态失败:', e);
    }
  },

  rebaseContinue: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    try {
      // 先 stage 所有已解决的文件
      await invoke('git_stage_all', { repoPath });
      // 再继续 rebase
      await invoke('git_rebase_continue', { repoPath });
      await useRepoStore.getState().refreshStatus();

      const { tasksByRepo } = get();
      const tasks = tasksByRepo[repoPath] || [];
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        let updatedTask = updateStep(task, 'sync', {
          status: 'finish', endTime: Date.now(), description: '已变基',
        });
        updatedTask = setTaskStatus(updatedTask, 'paused');
        updatedTask = { ...updatedTask, phase: 'developing' as PipelinePhase };
        set((state) => {
          const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updatedTask : t));
          const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
          persistTasks(newTasksByRepo);
          return {
            tasksByRepo: newTasksByRepo,
            currentTask: state.currentTask?.id === taskId ? updatedTask : state.currentTask,
          };
        });
        message.success('变基完成');
      }
    } catch (e) {
      const errorMsg = String(e);
      if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict')) {
        message.error('仍有未解决的冲突，请检查文件');
      } else {
        message.error(`继续 rebase 失败: ${errorMsg}`);
      }
    }
  },

  closeMR: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    const { repoPath, task } = ctx;

    const gitlabStore = useGitLabStore.getState();
    const { service, currentProject } = gitlabStore;

    if (!service || !currentProject) {
      set({ error: '未配置 GitLab' });
      return;
    }

    try {
      // 版本任务关闭两个 MR
      if (task.taskType === 'version') {
        const closePromises = [];
        if (task.mrMainIid) {
          closePromises.push(service.closeMergeRequest(currentProject.path_with_namespace, task.mrMainIid));
        }
        if (task.mrDevIid) {
          closePromises.push(service.closeMergeRequest(currentProject.path_with_namespace, task.mrDevIid));
        }
        await Promise.allSettled(closePromises);
      } else {
        // Feature 任务关闭一个 MR
        if (!task.mrIid) return;
        await service.closeMergeRequest(currentProject.path_with_namespace, task.mrIid);
      }

      let currentTask = updateStep(task, 'wait', {
        status: 'process', description: 'MR 已关闭',
      });
      currentTask = setTaskStatus(currentTask, 'paused', 'MR 已关闭');
      currentTask = { ...currentTask, phase: 'waiting_merge' as PipelinePhase, mrPollStatus: 'closed' as MrPollStatus };

      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? currentTask : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? currentTask : state.currentTask,
        };
      });

      message.success('MR 已关闭');
    } catch (e) {
      set({ error: `关闭 MR 失败: ${e}` });
    }
  },

  reopenMR: async (taskId: string) => {
    const ctx = getTask(taskId);
    if (!ctx || !ctx.task) return;
    const { repoPath, task } = ctx;

    const gitlabStore = useGitLabStore.getState();
    const { service, currentProject } = gitlabStore;

    if (!service || !currentProject) {
      set({ error: '未配置 GitLab' });
      return;
    }

    try {
      // 版本任务重新打开两个 MR
      if (task.taskType === 'version') {
        const reopenPromises = [];
        if (task.mrMainIid) {
          reopenPromises.push(service.reopenMergeRequest(currentProject.path_with_namespace, task.mrMainIid));
        }
        if (task.mrDevIid) {
          reopenPromises.push(service.reopenMergeRequest(currentProject.path_with_namespace, task.mrDevIid));
        }
        await Promise.allSettled(reopenPromises);
      } else {
        // Feature 任务重新打开一个 MR
        if (!task.mrIid) return;
        await service.reopenMergeRequest(currentProject.path_with_namespace, task.mrIid);
      }

      let currentTask = updateStep(task, 'wait', {
        status: 'process', error: undefined, description: '等待 MR 合并',
      });
      currentTask = setTaskStatus(currentTask, 'paused', '等待 MR 合并');
      currentTask = { ...currentTask, phase: 'waiting_merge' as PipelinePhase, mrPollStatus: 'idle' as MrPollStatus };

      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? currentTask : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? currentTask : state.currentTask,
        };
      });

      message.success('MR 已重新打开');
    } catch (e) {
      set({ error: `重新打开 MR 失败: ${e}` });
    }
  },

  clearError: () => set({ error: null }),
}));

// 辅助函数：执行打 Tag + 清理步骤
async function executeTagAndCleanup(
  currentTask: PipelineTask,
  taskId: string,
  repoPath: string,
) {
  // 先打 Tag
  let task = currentTask;
  if (task.version) {
    // 先将 wait 步骤标记为完成
    task = updateStep(task, 'wait', {
      status: 'finish', endTime: Date.now(), description: '已合并',
    });
    task = updateStep(task, 'tag', {
      status: 'process', startTime: Date.now(), description: '正在打 Tag...',
    });
    task = setTaskStatus(task, 'running');
    task = { ...task, phase: 'tagging' as PipelinePhase };
    updateTaskInStore(task, taskId, repoPath);

    try {
      // 1. Fetch 最新远程
      await invoke('git_fetch', { repoPath });

      // 2. 查找主干分支上最新的非合并提交（squash 提交）
      const mainBranch = task.mrSettings.targetBranch;
      let tagTarget = `origin/${mainBranch}`;
      try {
        const logEntries = await invoke<{hash: string}[]>('get_log', {
          repoPath,
          maxCount: 5,
          branch: `origin/${mainBranch}`,
          baseRef: null,
          firstParent: false,
          noMerges: true,
        });
        if (logEntries && logEntries.length > 0 && logEntries[0].hash) {
          tagTarget = logEntries[0].hash;
        }
      } catch (e) {
        console.warn('查找 squash 提交失败，使用主干分支:', e);
      }

      // 3. 创建 tag（已存在也当作成功）
      try {
        await invoke('git_tag', { repoPath, tag: task.version, message: task.version, target: tagTarget });
      } catch (e) {
        if (String(e).includes('already exists')) {
          console.log(`Tag ${task.version} 已存在，跳过创建`);
        } else {
          throw e;
        }
      }

      // 4. 推送 tag（失败不阻塞）
      try {
        await invoke('git_push_tags', { repoPath });
      } catch (e) {
        console.warn('推送 tag 失败:', e);
      }

      // 5. 标记成功
      task = updateStep(task, 'tag', {
        status: 'finish', endTime: Date.now(), description: task.version,
      });
      updateTaskInStore(task, taskId, repoPath);

    } catch (tagError) {
      console.error('打 Tag 失败:', tagError);
      task = updateStep(task, 'tag', {
        status: 'error', error: String(tagError), endTime: Date.now(),
      });
      updateTaskInStore(task, taskId, repoPath);
    }

    // 切回开发分支
    try {
      const branchTagStore = useBranchTagStore.getState();
      const devBranch = branchTagStore.getTargetBranch(repoPath) || 'develop';
      await invoke('git_checkout', {
        repoPath,
        target: devBranch,
        createBranch: false,
        startPoint: null,
      });
    } catch (e) {
      console.warn('切回开发分支失败:', e);
    }
  } else {
    // 没有版本号，跳过 Tag
    task = updateStep(task, 'tag', {
      status: 'skip', description: '无版本号',
    });
  }

  // 执行清理（使用更新后的 task，保留 tag 步骤的状态）
  await executeCleanup(task, taskId, repoPath);
}

// 辅助函数：执行清理步骤
async function executeCleanup(
  currentTask: PipelineTask,
  taskId: string,
  repoPath: string,
) {
  // 直接开始清理，wait 步骤已经在之前标记为完成
  let task = updateStep(currentTask, 'cleanup', {
    status: 'process', startTime: Date.now(), description: '正在清理分支...',
  });
  task = setTaskStatus(task, 'running');
  task = { ...task, phase: 'cleaning_up' as PipelinePhase, mrPollStatus: 'merged' as MrPollStatus };

  updateTaskInStore(task, taskId, repoPath);

  try {
    // 1. 确保在目标分支上（先切换，避免删除当前分支失败）
    // 版本任务切回 develop，feature 任务切回目标分支
    const cleanupTarget = task.taskType === 'version'
      ? (useBranchTagStore.getState().getTargetBranch(repoPath) || 'develop')
      : task.mrSettings.targetBranch;
    await invoke('git_checkout', {
      repoPath,
      target: cleanupTarget,
      createBranch: false,
      startPoint: null,
    });

    // 2. 删除本地分支（MR 已合并，分支内容已在目标分支中，可安全强制删除）
    try {
      await invoke('git_branch_delete', { repoPath, branch: task.branchName, force: true });
    } catch (e) {
      // 分支可能已经不存在，忽略
      console.warn('删除本地分支失败（可能已删除）:', e);
    }

    // 3. 删除远程分支
    let remoteDeleted = false;
    try {
      await invoke('git_push', {
        repoPath,
        remote: 'origin',
        delete: true,
        branch: task.branchName,
      });
      remoteDeleted = true;
    } catch (e) {
      console.warn('删除远程分支失败（可能已删除）:', e);
      // 检查远程分支是否已不存在
      try {
        const branchOutput = await invoke<string>('git_branch_list', { repoPath });
        remoteDeleted = !branchOutput.includes(`remotes/origin/${task.branchName}`);
      } catch {
        // 忽略
      }
    }

    // 4. 执行 fetch（含 prune）清理远程已删除的分支引用
    await invoke('git_fetch', { repoPath });

    // 5. 静默刷新状态（不触发 loading，避免 UI 卡顿）
    await useRepoStore.getState().refreshStatusSilent();

    // 6. 移除任务分支标签
    try {
      await useBranchTagStore.getState().removeTag(repoPath, task.branchName);
    } catch {
      // 忽略
    }

    // 7. 更新为成功状态
    task = updateStep(task, 'cleanup', {
      status: 'finish', endTime: Date.now(), description: remoteDeleted ? '已清理' : '已清理（远程分支可能未删除）',
    });
    task = setTaskStatus(task, 'success');
    task = { ...task, phase: 'finished' as PipelinePhase };
    updateTaskInStore(task, taskId, repoPath);
    message.success('任务完成，分支已清理');

  } catch (e) {
    console.error('清理分支失败:', e);
    // 清理失败也要标记为完成，避免卡住
    task = updateStep(task, 'cleanup', {
      status: 'error', error: String(e), endTime: Date.now(), description: '清理失败',
    });
    task = setTaskStatus(task, 'success');
    task = { ...task, phase: 'finished' as PipelinePhase };
    updateTaskInStore(task, taskId, repoPath);
    message.warning('分支清理失败，但任务已完成');
  }
}

// 辅助函数：更新任务到 store
function updateTaskInStore(updatedTask: PipelineTask, taskId: string, repoPath: string) {
  usePipelineStore.setState((state) => {
    const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) =>
      t.id === taskId ? updatedTask : t
    );
    const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
    persistTasks(newTasksByRepo);
    return {
      tasksByRepo: newTasksByRepo,
      currentTask: state.currentTask?.id === taskId ? updatedTask : state.currentTask,
    };
  });
}

// 辅助函数：检查 MR 状态并清理
async function checkMRAndCleanup(
  currentTask: PipelineTask,
  taskId: string,
  updateTask: (t: PipelineTask) => void,
  repoPath: string,
  task: PipelineTask,
) {
  const gitlabStore = useGitLabStore.getState();
  const { service, currentProject } = gitlabStore;

  if (!service || !currentProject) return;

  // 版本任务需要检查两个 MR 都合并
  if (task.taskType === 'version') {
    const mrMainIid = task.mrMainIid;
    const mrDevIid = task.mrDevIid;

    if (!mrDevIid) return;

    try {
      // 先检查 MR→main
      if (mrMainIid) {
        const mrMain = await service.getMergeRequest(currentProject.path_with_namespace, mrMainIid);
        if (mrMain.state !== 'merged') {
          // MR→main 还没合并，更新状态提示
          const updated = updateStep(currentTask, 'wait', {
            status: 'process', description: `等待 MR→main 合并 (!${mrMainIid})`,
          });
          updateTask(updated);
          return;
        }
        // MR→main 已合并，更新步骤状态
        currentTask = updateStep(currentTask, 'mr_main', {
          status: 'finish', endTime: Date.now(), description: `MR !${mrMainIid} 已合并`,
        });
      }

      // 再检查 MR→develop
      const mrDev = await service.getMergeRequest(currentProject.path_with_namespace, mrDevIid);

      if (mrDev.state === 'merged') {
        // 两个 MR 都合并，先打 Tag 再清理
        let updated = updateStep(currentTask, 'wait', {
          status: 'finish', endTime: Date.now(), description: '已合并',
        });
        updateTask(updated);
        await executeTagAndCleanup(updated, taskId, repoPath);
      } else if (mrDev.state === 'closed') {
        let updated = updateStep(currentTask, 'wait', {
          status: 'error', error: 'MR→develop 已关闭', endTime: Date.now(),
        });
        updated = setTaskStatus(updated, 'paused', 'MR→develop 已关闭');
        updateTask(updated);
      } else {
        // MR→develop 还没合并，更新状态提示
        const updated = updateStep(currentTask, 'wait', {
          status: 'process', description: `等待 MR→develop 合并 (!${mrDevIid})`,
        });
        updateTask(updated);
      }
    } catch (e) {
      console.error('检查 MR 状态失败:', e);
    }
    return;
  }

  // Feature 任务：检查单个 MR
  const mrIid = task.mrIid;
  if (!mrIid) return;

  try {
    const mr = await service.getMergeRequest(currentProject.path_with_namespace, mrIid);

    if (mr.state === 'merged') {
      let updated = updateStep(currentTask, 'wait', {
        status: 'finish', endTime: Date.now(), description: '已合并',
      });
      updateTask(updated);
      await executeCleanup(updated, taskId, repoPath);

    } else if (mr.state === 'closed') {
      let updated = updateStep(currentTask, 'wait', {
        status: 'error', error: 'MR 已关闭', endTime: Date.now(),
      });
      updated = setTaskStatus(updated, 'paused', 'MR 已关闭');
      updateTask(updated);

    } else {
      updateTask(currentTask);
    }
  } catch (e) {
    console.error('检查 MR 状态失败:', e);
  }
}
