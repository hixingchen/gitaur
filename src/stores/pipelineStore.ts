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

/** 同步策略 */
export type SyncStrategy = 'rebase' | 'merge';

/** MR 设置 */
export interface MRSettings {
  enabled: boolean;
  title?: string;
  description?: string;
  squash: boolean;
  deleteBranchAfterMerge: boolean;
  autoMerge: boolean;
  targetBranch: string;
}

/** 流水线任务 */
export interface PipelineTask {
  id: string;
  name: string;
  branchName: string;
  status: TaskStatus;
  steps: PipelineStep[];
  currentStep: number;
  syncStrategy: SyncStrategy;
  mrSettings: MRSettings;
  mrIid?: number;
  mrUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** 创建任务参数 */
export interface CreateTaskParams {
  name: string;
  branchName?: string;
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
  createTask: (params: CreateTaskParams) => PipelineTask;
  startTask: (taskId: string) => Promise<void>;
  commitCode: (taskId: string, message?: string) => Promise<void>;
  syncRemote: (taskId: string) => Promise<void>;
  pushRemote: (taskId: string) => Promise<void>;
  createMR: (taskId: string) => Promise<void>;
  checkMergeStatus: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  switchRepo: (repoPath: string | null) => void;
  setCurrentTask: (taskId: string | null) => void;
  abortRebase: (taskId: string) => Promise<void>;
  rebaseContinue: (taskId: string) => Promise<void>;
  closeMR: (taskId: string) => Promise<void>;
  checkAndCleanTasks: () => Promise<void>;
  clearError: () => void;
}

function createSteps(): PipelineStep[] {
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

function getRepoPath(): string | null {
  return useRepoStore.getState().repoPath;
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

async function persistTasks(tasksByRepo: Record<string, PipelineTask[]>, store?: Store | null): Promise<void> {
  try {
    const s = store || await ensureStore();
    await s.set('tasksByRepo', tasksByRepo);
    await s.save();
  } catch (e) {
    console.error('持久化任务数据失败:', e);
  }
}

let taskCounter = 0;

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
        // 恢复任务状态：运行中的任务标记为暂停
        const restored: Record<string, PipelineTask[]> = {};
        for (const [repo, tasks] of Object.entries(saved)) {
          restored[repo] = tasks.map((t) => {
            if (t.status === 'running') {
              return { ...t, status: 'paused' as TaskStatus, error: '程序重启，任务已暂停' };
            }
            return t;
          });
        }
        set({ tasksByRepo: restored, _store: store });
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
      return null as any;
    }

    const id = `task_${Date.now()}_${++taskCounter}`;
    const branchName = params.branchName || `feature/${params.name.toLowerCase().replace(/\s+/g, '-')}`;

    const task: PipelineTask = {
      id,
      name: params.name,
      branchName,
      status: 'pending',
      steps: createSteps(),
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
      const repoTasks = [...(state.tasksByRepo[repoPath] || []), task];
      const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
      // 异步持久化
      persistTasks(newTasksByRepo, state._store);
      return { tasksByRepo: newTasksByRepo, currentTask: task };
    });

    // 给分支打上任务分支标签
    useBranchTagStore.getState().setTag(repoPath, branchName, 'task');

    return task;
  },

  startTask: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === 'running') return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = (updated: PipelineTask) => {
      currentTask = updated;
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
        };
      });
    };

    updateTask(currentTask);

    try {
      // Step 1: 创建分支（基于远程开发分支）
      currentTask = updateStep(currentTask, 'branch', { status: 'process', startTime: Date.now() });
      updateTask(currentTask);

      // 先 fetch 确保有最新的远程分支
      await invoke('git_fetch', { repoPath });

      await invoke('git_checkout', {
        repoPath,
        target: task.branchName,
        createBranch: true,
        startPoint: `origin/${task.mrSettings.targetBranch}`,  // 基于远程开发分支
      });

      await useRepoStore.getState().refreshStatus();

      currentTask = updateStep(currentTask, 'branch', {
        status: 'finish', endTime: Date.now(), description: task.branchName,
      });
      updateTask(currentTask);

      // Step 2: 开发修改 — 暂停等待用户操作
      currentTask = updateStep(currentTask, 'develop', {
        status: 'process', description: '请在工作区修改代码，完成后点击"提交代码"',
      });
      currentTask = setTaskStatus(currentTask, 'paused');
      updateTask(currentTask);
      return;

    } catch (e) {
      const errorMsg = String(e);
      console.error('startTask error:', errorMsg);
      currentTask = updateStep(currentTask, 'branch', {
        status: 'error', error: errorMsg, endTime: Date.now(),
      });
      currentTask = setTaskStatus(currentTask, 'paused', errorMsg);
      updateTask(currentTask);
    }
  },

  // 提交代码（开发步骤完成后）
  commitCode: async (taskId: string, message?: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = (updated: PipelineTask) => {
      currentTask = updated;
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
        };
      });
    };

    updateTask(currentTask);

    try {
      const repoStore = useRepoStore.getState();
      await repoStore.refreshStatus();
      const repoInfo = repoStore.repoInfo;

      // 检查是否有变更
      const hasChanges = repoInfo && repoInfo.status.length > 0;
      if (!hasChanges) {
        currentTask = setTaskStatus(currentTask, 'paused', '没有代码变更');
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
      // 提交完成后暂停，等待用户继续操作
      currentTask = setTaskStatus(currentTask, 'paused');
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
      updateTask(currentTask);
    }
  },

  // 同步远程（fetch + rebase/merge）
  syncRemote: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = (updated: PipelineTask) => {
      currentTask = updated;
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
        };
      });
    };

    updateTask(currentTask);

    try {
      // 检查是否有未提交的更改
      const repoInfo = useRepoStore.getState().repoInfo;
      if (repoInfo && repoInfo.status.length > 0) {
        throw new Error('当前有未提交的更改，请先提交代码再同步');
      }

      currentTask = updateStep(currentTask, 'sync', { status: 'process', startTime: Date.now() });
      updateTask(currentTask);

      await invoke('git_fetch', { repoPath });

      const strategy = task.syncStrategy;
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
        currentTask = setTaskStatus(currentTask, 'paused');
        updateTask(currentTask);

      } catch (syncError) {
        const errorMsg = String(syncError);
        if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict') || errorMsg.includes('could not apply')) {
          currentTask = updateStep(currentTask, 'sync', {
            status: 'error', error: '存在冲突，请手动解决后点击"继续同步"', endTime: Date.now(),
          });
          currentTask = setTaskStatus(currentTask, 'paused', '存在冲突');
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
        currentTask = updateStep(currentTask, 'sync', {
          status: 'error', error: friendlyMsg, endTime: Date.now(),
        });
      } else if (errorMsg.includes('Could not resolve host')) {
        friendlyMsg = '网络连接失败，请检查网络';
        currentTask = updateStep(currentTask, 'sync', {
          status: 'error', error: friendlyMsg, endTime: Date.now(),
        });
      } else if (errorMsg.includes('未提交的更改')) {
        friendlyMsg = '当前有未提交的更改，请先提交代码再同步';
        currentTask = updateStep(currentTask, 'sync', {
          status: 'error', error: friendlyMsg, endTime: Date.now(),
        });
      } else {
        currentTask = updateStep(currentTask, 'sync', {
          status: 'error', error: friendlyMsg, endTime: Date.now(),
        });
      }

      currentTask = setTaskStatus(currentTask, 'paused', friendlyMsg);
      updateTask(currentTask);
    }
  },

  // 推送到远程
  pushRemote: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = (updated: PipelineTask) => {
      currentTask = updated;
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
        };
      });
    };

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
      currentTask = setTaskStatus(currentTask, 'paused');
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
      currentTask = setTaskStatus(currentTask, 'paused');
      updateTask(currentTask);
    }
  },

  // 创建 MR
  createMR: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = (updated: PipelineTask) => {
      currentTask = updated;
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
        };
      });
    };

    updateTask(currentTask);

    try {
      if (task.mrSettings.enabled) {
        currentTask = updateStep(currentTask, 'mr', { status: 'process', startTime: Date.now() });
        updateTask(currentTask);

        const gitlabStore = useGitLabStore.getState();
        let { service, currentProject } = gitlabStore;

        console.log('createMR: service=', !!service, 'currentProject=', currentProject?.path_with_namespace);

        // 如果没有选择项目，尝试自动选择
        if (service && !currentProject) {
          const repoPath = getRepoPath();
          if (repoPath) {
            const repoName = repoPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || '';
            console.log('createMR: auto searching for project', repoName);
            try {
              await gitlabStore.searchProjects(repoName);
              const matched = gitlabStore.projects.find((p) => p.path === repoName || p.name === repoName);
              if (matched) {
                console.log('createMR: auto matched', matched.path_with_namespace);
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
            console.log('createMR: creating MR', {
              project: currentProject.path_with_namespace,
              source: task.branchName,
              target: task.mrSettings.targetBranch,
              title: mrTitle,
            });
            const mr = await service.createMergeRequest(
              currentProject.path_with_namespace,
              {
                source_branch: task.branchName,
                target_branch: task.mrSettings.targetBranch,
                title: mrTitle,
                description: task.mrSettings.description || '',
                remove_source_branch: task.mrSettings.deleteBranchAfterMerge,
                squash: task.mrSettings.squash,
              },
            );

            console.log('createMR: success', mr);
            currentTask = { ...currentTask, mrIid: mr.iid, mrUrl: mr.web_url };
            currentTask = updateStep(currentTask, 'mr', {
              status: 'finish', endTime: Date.now(), description: `MR !${mr.iid}`,
            });
            updateTask(currentTask);

            // 自动进入等待合并步骤
            currentTask = updateStep(currentTask, 'wait', { status: 'process', description: '等待 MR 合并' });
            currentTask = setTaskStatus(currentTask, 'paused', '等待 MR 合并');
            updateTask(currentTask);
            return;

          } catch (mrError) {
            console.error('createMR: error', mrError);
            message.error(`创建 MR 失败: ${mrError}`);
            currentTask = updateStep(currentTask, 'mr', { status: 'error', error: String(mrError), endTime: Date.now() });
            currentTask = setTaskStatus(currentTask, 'paused');
            updateTask(currentTask);
            return;
          }
        } else {
          console.log('createMR: skipped - no service or project');
          currentTask = updateStep(currentTask, 'mr', { status: 'skip', description: '未配置 GitLab' });
          updateTask(currentTask);
        }
      } else {
        currentTask = updateStep(currentTask, 'mr', { status: 'skip', description: '已禁用' });
        updateTask(currentTask);
      }

      // MR 禁用或未配置 GitLab，直接清理
      await executeCleanup(currentTask, taskId, updateTask, repoPath, repoPath);

    } catch (e) {
      const errorMsg = String(e);
      message.error(errorMsg);
      currentTask = setTaskStatus(currentTask, 'paused');
      updateTask(currentTask);
    }
  },

  // 检查 MR 合并状态
  checkMergeStatus: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    let currentTask = setTaskStatus(task, 'running');
    const updateTask = (updated: PipelineTask) => {
      currentTask = updated;
      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? updated : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
        return {
          tasksByRepo: newTasksByRepo,
          currentTask: state.currentTask?.id === taskId ? updated : state.currentTask,
        };
      });
    };

    updateTask(currentTask);

    try {
      await checkMRAndCleanup(currentTask, taskId, updateTask, repoPath, task, repoPath);
    } catch (e) {
      console.error('检查 MR 状态失败:', e);
      currentTask = setTaskStatus(currentTask, 'paused');
      updateTask(currentTask);
    }
  },

  deleteTask: async (taskId: string) => {
    console.log('deleteTask called with taskId:', taskId);
    const repoPath = getRepoPath();
    if (!repoPath) {
      console.error('deleteTask: repoPath is null');
      return;
    }

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      console.error('deleteTask: task not found', taskId);
      return;
    }

    try {
      // 1. 中止 rebase（如果正在进行）
      const syncStep = task.steps.find((s) => s.key === 'sync');
      if (syncStep?.status === 'error' || syncStep?.status === 'process') {
        try {
          await invoke('git_abort_rebase', { repoPath });
        } catch {
          // 忽略
        }
      }

      // 2. 关闭 MR（如果存在）
      const mrStep = task.steps.find((s) => s.key === 'mr');
      if (mrStep?.status === 'finish' && task.mrIid) {
        const gitlabStore = useGitLabStore.getState();
        const { service, currentProject } = gitlabStore;
        if (service && currentProject) {
          try {
            await service.closeMergeRequest(currentProject.path_with_namespace, task.mrIid);
          } catch {
            // MR 可能已经关闭，忽略
          }
        }
      }

      // 3. 切回目标分支
      try {
        await invoke('git_checkout', {
          repoPath,
          target: task.mrSettings.targetBranch,
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
        persistTasks(newTasksByRepo, state._store);
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
        persistTasks(newTasksByRepo, state._store);
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

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    if (tasks.length === 0) return;

    try {
      // 刷新状态获取最新分支信息
      await useRepoStore.getState().refreshStatusSilent();

      // 从store中获取更新后的repoInfo
      const repoInfo = useRepoStore.getState().repoInfo;
      if (!repoInfo) return;

      const branches = repoInfo.branches.map((b: any) => b.name);
      const localBranches = branches.filter((b: string) => !b.startsWith('remotes/'));

      // 找出任务分支已不存在的任务
      const tasksToRemove = tasks.filter((task) => {
        if (task.status === 'pending') return false;
        return !localBranches.includes(task.branchName);
      });

      // 逐个清理任务（远程分支、标签）
      for (const task of tasksToRemove) {
        try {
          // 1. 尝试删除远程分支（不管 pipeline 有没有记录推送，都尝试删）
          try {
            await invoke('git_push', {
              repoPath, remote: 'origin', force: false,
              delete: true, branch: task.branchName,
            });
          } catch { /* 远程分支可能不存在，忽略 */ }

          // 2. 移除任务分支标签
          try {
            await useBranchTagStore.getState().removeTag(repoPath, task.branchName);
          } catch { /* 忽略 */ }
        } catch { /* 忽略 */ }
      }

      // 从列表中移除
      const removeIds = new Set(tasksToRemove.map((t) => t.id));
      const remainingTasks = tasks.filter((t) => !removeIds.has(t.id));
      const newTasksByRepo = { ...tasksByRepo, [repoPath]: remainingTasks };

      set((state) => {
        persistTasks(newTasksByRepo, state._store);
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
        set((state) => {
          const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? resetTask : t));
          const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
          persistTasks(newTasksByRepo, state._store);
          return { tasksByRepo: newTasksByRepo };
        });
      }
    } catch (e) {
      set({ error: `中止 rebase 失败: ${e}` });
    }
  },

  rebaseContinue: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    try {
      await invoke('git_rebase_continue', { repoPath });

      const { tasksByRepo } = get();
      const tasks = tasksByRepo[repoPath] || [];
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        const updatedTask = updateStep(task, 'sync', {
          status: 'finish', endTime: Date.now(), description: '已变基',
        });
        // 同步完成，设置为暂停，等待用户点击下一步
        const pausedTask = setTaskStatus(updatedTask, 'paused');
        set((state) => {
          const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? pausedTask : t));
          const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
          persistTasks(newTasksByRepo, state._store);
          return { tasksByRepo: newTasksByRepo };
        });
      }
    } catch (e) {
      set({ error: `继续 rebase 失败: ${e}` });
    }
  },

  closeMR: async (taskId: string) => {
    const repoPath = getRepoPath();
    if (!repoPath) return;

    const { tasksByRepo } = get();
    const tasks = tasksByRepo[repoPath] || [];
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !task.mrIid) return;

    const gitlabStore = useGitLabStore.getState();
    const { service, currentProject } = gitlabStore;

    if (!service || !currentProject) {
      set({ error: '未配置 GitLab' });
      return;
    }

    try {
      await service.closeMergeRequest(currentProject.path_with_namespace, task.mrIid);

      let currentTask = updateStep(task, 'wait', {
        status: 'error', error: 'MR 已关闭', endTime: Date.now(),
      });
      currentTask = setTaskStatus(currentTask, 'paused', 'MR 已关闭');

      set((state) => {
        const repoTasks = (state.tasksByRepo[repoPath] || []).map((t) => (t.id === taskId ? currentTask : t));
        const newTasksByRepo = { ...state.tasksByRepo, [repoPath]: repoTasks };
        persistTasks(newTasksByRepo, state._store);
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

  clearError: () => set({ error: null }),
}));

// 辅助函数：执行清理步骤
async function executeCleanup(
  currentTask: PipelineTask,
  _taskId: string,
  updateTask: (t: PipelineTask) => void,
  repoPath: string,
  _repoKey: string,
) {
  const cleanupStep = currentTask.steps.find((s) => s.key === 'cleanup');
  if (cleanupStep?.status === 'wait' || cleanupStep?.status === 'process') {
    let task = updateStep(currentTask, 'cleanup', { status: 'process', startTime: Date.now() });
    updateTask(task);

    try {
      await invoke('git_branch_delete', { repoPath, branch: task.branchName, force: false });
      await invoke('git_checkout', {
        repoPath,
        target: task.mrSettings.targetBranch,
        createBranch: false,
        startPoint: null,
      });
      await invoke('git_pull', { repoPath, remote: 'origin', rebase: false });

      await useRepoStore.getState().refreshStatus();

      task = updateStep(task, 'cleanup', {
        status: 'finish', endTime: Date.now(), description: '已清理',
      });
      task = setTaskStatus(task, 'success');
      updateTask(task);

    } catch (e) {
      task = updateStep(task, 'cleanup', {
        status: 'error', error: String(e), endTime: Date.now(),
      });
      task = setTaskStatus(task, 'success');
      updateTask(task);
    }
  }
}

// 辅助函数：检查 MR 状态并清理
async function checkMRAndCleanup(
  currentTask: PipelineTask,
  taskId: string,
  updateTask: (t: PipelineTask) => void,
  repoPath: string,
  task: PipelineTask,
  _repoKey: string,
) {
  if (!task.mrIid) return;

  const gitlabStore = useGitLabStore.getState();
  const { service, currentProject } = gitlabStore;

  if (!service || !currentProject) return;

  try {
    const mr = await service.getMergeRequest(currentProject.path_with_namespace, task.mrIid);

    if (mr.state === 'merged') {
      let updated = updateStep(currentTask, 'wait', {
        status: 'finish', endTime: Date.now(), description: '已合并',
      });
      updateTask(updated);
      await executeCleanup(updated, taskId, updateTask, repoPath, _repoKey);

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
