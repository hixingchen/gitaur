import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Button, Tag, Space, Select, Divider, Typography, Tooltip, theme, message,
} from 'antd';
import {
  PlusOutlined, SwapOutlined, BranchesOutlined,
  PullRequestOutlined,
} from '@ant-design/icons';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { useRepoManagerStore } from '../../stores/repoManagerStore';
import { useMrPolling } from '../../hooks/useMrPolling';
import { FileTree, type PanelTab } from '../FileTree/FileTree';
import { DiffView } from '../DiffView/DiffView';
import { SectionErrorBoundary } from '../SectionErrorBoundary';
import { PipelineBar, getTaskStatusTag } from './PipelineBar';
import { CreateTaskModal } from './CreateTaskModal';
import { FinishedPage, EmptyPage } from './PipelinePages';

const { Text } = Typography;

export function PipelinePanel() {
  const { token } = theme.useToken();
  const currentTask = usePipelineStore((s) => s.currentTask);
  const repoPath = useRepoStore((s) => s.repoPath);
  const setCurrentTask = usePipelineStore((s) => s.setCurrentTask);
  const deleteTaskFromStore = usePipelineStore((s) => s.deleteTask);
  const pipelineError = usePipelineStore((s) => s.error);
  const clearPipelineError = usePipelineStore((s) => s.clearError);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('changes');
  const [panelWidth, setPanelWidth] = useState(220);
  const resizing = useRef(false);

  useMrPolling();

  useEffect(() => {
    if (pipelineError) {
      message.error(pipelineError);
      clearPipelineError();
    }
  }, [pipelineError, clearPipelineError]);

  const repoInfo = useRepoStore((s) => s.repoInfo);
  const checkout = useRepoStore((s) => s.checkout);
  const refreshStatusSilent = useRepoStore((s) => s.refreshStatusSilent);
  const setSelectedFile = useViewStore((s) => s.setSelectedFile);
  const savedRepos = useRepoManagerStore((s) => s.repos);

  const repoName = repoPath
    ? (savedRepos.find((r) => r.path === repoPath)?.alias || repoPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || repoPath)
    : '';

  const currentRepoTasks = usePipelineStore((s) => repoPath ? (s.tasksByRepo[repoPath] || []) : []);
  const allTasks = useMemo(
    () => currentRepoTasks.filter((t) => t.status !== 'success' && t.status !== 'cancelled'),
    [currentRepoTasks]
  );
  const taskById = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);

  const currentBranch = repoInfo?.currentBranch;
  useEffect(() => {
    if (!currentBranch || allTasks.length === 0) return;
    const hasError = currentTask?.steps.some((s) => s.status === 'error');
    if (hasError) return;

    const matchedTask = allTasks.find((t) =>
      t.branchName === currentBranch && t.status !== 'success' && t.status !== 'cancelled'
    );

    if (matchedTask && currentTask?.id !== matchedTask.id) {
      setCurrentTask(matchedTask.id);
      setSelectedFile(null);
    } else if (!matchedTask && currentTask) {
      const currentTaskStillValid = allTasks.find((t) =>
        t.id === currentTask.id && t.branchName === currentBranch
      );
      if (!currentTaskStillValid) {
        setCurrentTask(null);
        setSelectedFile(null);
      }
    }
  }, [currentBranch]);

  const commitStep = currentTask?.steps.find((s) => s.key === 'commit');
  const syncStep = currentTask?.steps.find((s) => s.key === 'sync');
  const waitStep = currentTask?.steps.find((s) => s.key === 'wait');
  const showFileTree = currentTask && (
    (commitStep && commitStep.status !== 'finish') ||
    (commitStep?.status === 'finish' && syncStep?.status === 'wait') ||
    (syncStep?.status === 'error' && (
      (syncStep.error || '').includes('冲突') ||
      (syncStep.error || '').includes('未提交的更改')
    )) ||
    (waitStep?.status === 'process' && currentTask.mrPollStatus === 'conflict')
  );
  const isSuccess = currentTask?.status === 'success';

  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const handlePanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(180, Math.min(400, startW + (ev.clientX - startX)));
      setPanelWidth(w);
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  if (!repoPath) {
    return (
      <div style={{ textAlign: 'center', padding: 64, color: token.colorTextSecondary }}>
        请先打开仓库
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
      }}>
        <Space size={8}>
          <Tooltip title="切换仓库">
            <Button type="text" size="small" icon={<SwapOutlined />}
              style={{ fontWeight: 600, fontSize: 13 }}>
              {repoName}
            </Button>
          </Tooltip>
          <Tag color="blue" icon={<BranchesOutlined />} style={{ margin: 0 }}>
            {repoInfo?.currentBranch}
          </Tag>
          {repoInfo && repoInfo.ahead > 0 && <Tag color="orange" style={{ margin: 0 }}>↑ {repoInfo.ahead}</Tag>}
          {repoInfo && repoInfo.behind > 0 && <Tag color="red" style={{ margin: 0 }}>↓ {repoInfo.behind}</Tag>}
        </Space>

        {allTasks.length > 0 && (
          <Select
            value={currentTask?.id}
            onChange={async (taskId) => {
              const task = allTasks.find((t) => t.id === taskId);
              if (!task) return;

              const localBranches = (repoInfo?.branches || [])
                .filter((b) => !b.name.startsWith('remotes/'))
                .map((b) => b.name);

              if (task.status !== 'pending' && !localBranches.includes(task.branchName)) {
                await deleteTaskFromStore(task.id);
                message.warning(`任务 "${task.name}" 的分支已不存在，已自动删除`);
                return;
              }

              setCurrentTask(taskId);
              setSelectedFile(null);

              if (task.status !== 'pending' && currentBranch !== task.branchName) {
                try {
                  await checkout(task.branchName);
                  await refreshStatusSilent();
                } catch (e) {
                  console.warn('切换分支失败:', e);
                }
              }
            }}
            style={{ minWidth: 200 }}
            placeholder="选择任务"
            optionLabelProp="label"
            popupMatchSelectWidth={false}
            dropdownRender={(menu) => (
              <>
                {menu}
                <Divider style={{ margin: '8px 0' }} />
                <div
                  style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => setCreateModalOpen(true)}
                >
                  <PlusOutlined />
                  <span>新建任务</span>
                </div>
              </>
            )}
            options={allTasks.map((task) => ({
              value: task.id,
              label: `${task.name} (${task.branchName})`,
              disabled: false,
            }))}
            optionRender={(option) => {
              const task = taskById.get(option.value as string);
              if (!task) return null;
              const statusIcon = getTaskStatusTag(task.status);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{statusIcon}</span>
                  <span>{task.name}</span>
                  <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{task.branchName}</span>
                </div>
              );
            }}
          />
        )}
      </div>

      {currentTask && !isSuccess && <PipelineBar task={currentTask} />}

      {!currentTask ? (
        <EmptyPage onNewTask={() => setCreateModalOpen(true)} />
      ) : isSuccess ? (
        <FinishedPage task={currentTask} onNewTask={() => setCreateModalOpen(true)} />
      ) : showFileTree ? (
        <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
          <div style={{
            width: panelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: token.colorBgContainer,
            borderRadius: 10, padding: 12,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <SectionErrorBoundary fallbackTitle="文件树加载失败">
              <FileTree
                tab={panelTab}
                onTabChange={setPanelTab}
                onSelectFile={(path) => setSelectedFile(path)}
              />
            </SectionErrorBoundary>
          </div>

          <div
            onMouseDown={handlePanelResize}
            style={{
              width: 8, flexShrink: 0, cursor: 'col-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 2, height: 36, borderRadius: 1,
              background: token.colorBorderSecondary,
            }} />
          </div>

          <div style={{
            flex: 1, minWidth: 0,
            background: token.colorBgContainer,
            borderRadius: 10,
            border: `1px solid ${token.colorBorderSecondary}`,
            padding: 12,
            display: 'flex', flexDirection: 'column',
          }}>
            <SectionErrorBoundary fallbackTitle="代码编辑器加载失败">
              <DiffView />
            </SectionErrorBoundary>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 16,
          background: token.colorBgContainer,
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}>
          {currentTask?.mrUrl && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                MR !{currentTask.mrIid}
              </div>
              <a href={currentTask.mrUrl} target="_blank" rel="noopener noreferrer">
                <Button type="primary" icon={<PullRequestOutlined />}>
                  在 GitLab 中查看
                </Button>
              </a>
            </div>
          )}
          {!currentTask?.mrUrl && currentTask?.steps.find((s) => s.key === 'wait')?.status === 'process' && (
            <div style={{ color: token.colorTextSecondary, fontSize: 13 }}>
              等待 MR 合并...
            </div>
          )}
        </div>
      )}

      <CreateTaskModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />
    </div>
  );
}
