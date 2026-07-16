import { useState, useCallback } from 'react';
import {
  Button, Steps, Tag, Space, Input, Modal, Typography, Tooltip, theme, message,
} from 'antd';
import {
  PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined,
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined,
  BranchesOutlined, CodeOutlined, CloudUploadOutlined,
  PullRequestOutlined, RocketOutlined, ClearOutlined,
  EditOutlined, SyncOutlined,
} from '@ant-design/icons';
import { usePipelineStore, type PipelineTask, type TaskStatus, type StepStatus, type PipelinePhase, type MrPollStatus } from '../../stores/pipelineStore';
import { useRepoStore } from '../../stores/repoStore';

const { Text } = Typography;

function getStatusIcon(status: StepStatus) {
  switch (status) {
    case 'finish': return <CheckCircleOutlined style={{ color: 'var(--ant-color-success, #52c41a)' }} />;
    case 'error': return <CloseCircleOutlined style={{ color: 'var(--ant-color-error, #ff4d4f)' }} />;
    case 'process': return <LoadingOutlined style={{ color: 'var(--ant-color-primary, #1677ff)' }} />;
    case 'skip': return <CheckCircleOutlined style={{ color: 'var(--ant-color-text-tertiary, rgba(0,0,0,0.25))' }} />;
    default: return null;
  }
}

export function getTaskStatusTag(status: TaskStatus) {
  switch (status) {
    case 'pending': return <Tag color="default">待执行</Tag>;
    case 'running': return <Tag color="processing" icon={<LoadingOutlined />}>运行中</Tag>;
    case 'paused': return <Tag color="warning" icon={<PauseCircleOutlined />}>已暂停</Tag>;
    case 'success': return <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>;
    case 'cancelled': return <Tag color="warning">已取消</Tag>;
    default: return null;
  }
}

function getStepIcon(key: string) {
  switch (key) {
    case 'branch': return <BranchesOutlined />;
    case 'develop': return <CodeOutlined />;
    case 'commit': return <EditOutlined />;
    case 'sync': return <ReloadOutlined />;
    case 'push': return <CloudUploadOutlined />;
    case 'mr': return <PullRequestOutlined />;
    case 'wait': return <PauseCircleOutlined />;
    case 'cleanup': return <ClearOutlined />;
    default: return null;
  }
}

interface PipelineBarProps {
  task: PipelineTask;
}

export function PipelineBar({ task }: PipelineBarProps) {
  const { token } = theme.useToken();
  const startTask = usePipelineStore((s) => s.startTask);
  const commitCode = usePipelineStore((s) => s.commitCode);
  const syncRemote = usePipelineStore((s) => s.syncRemote);
  const pushRemote = usePipelineStore((s) => s.pushRemote);
  const createMR = usePipelineStore((s) => s.createMR);
  const deleteTask = usePipelineStore((s) => s.deleteTask);
  const closeMR = usePipelineStore((s) => s.closeMR);
  const reopenMR = usePipelineStore((s) => s.reopenMR);
  const resumeDevelopment = usePipelineStore((s) => s.resumeDevelopment);
  const resumeFromConflict = usePipelineStore((s) => s.resumeFromConflict);
  const abortRebase = usePipelineStore((s) => s.abortRebase);
  const rebaseContinue = usePipelineStore((s) => s.rebaseContinue);
  const loading = usePipelineStore((s) => s.loading);
  const logEntries = useRepoStore((s) => s.logEntries);
  const loadLog = useRepoStore((s) => s.loadLog);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [closeMRConfirm, setCloseMRConfirm] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [createMRModalOpen, setCreateMRModalOpen] = useState(false);
  const [mrCommitMessage, setMrCommitMessage] = useState('');

  // 获取提交历史并生成默认的提交消息
  const getDefaultCommitMessage = useCallback(async () => {
    try {
      // 用 baseRef 只加载任务分支独有的提交（排除目标分支的提交）
      const baseRef = `origin/${task.mrSettings.targetBranch}`;
      await loadLog(50, task.branchName, baseRef);

      // 等待一下让 logEntries 更新
      await new Promise(resolve => setTimeout(resolve, 200));

      const currentLogEntries = useRepoStore.getState().logEntries;

      if (currentLogEntries.length === 0) {
        return '';
      }

      if (task.mrSettings.squash) {
        // Squash 模式：拼接所有提交消息（按时间正序，先提交的在上）
        const messages = [...currentLogEntries].reverse().map((entry) => entry.message);
        return messages.join('\n');
      } else {
        // 非 Squash 模式：使用最新的提交消息
        return currentLogEntries[0].message;
      }
    } catch (error) {
      console.warn('获取提交历史失败:', error);
      return '';
    }
  }, [loadLog, task.branchName, task.mrSettings.squash, task.mrSettings.targetBranch]);

  // 打开创建 MR 弹窗（自动合并时需要填消息，否则直接创建）
  const handleOpenCreateMRModal = useCallback(async () => {
    if (task.mrSettings.autoMerge) {
      const defaultMessage = await getDefaultCommitMessage();
      setMrCommitMessage(defaultMessage);
      setCreateMRModalOpen(true);
    } else {
      createMR(task.id);
    }
  }, [getDefaultCommitMessage, task.mrSettings.autoMerge, task.id, createMR]);

  const currentStepIndex = task.currentStep >= 0 ? task.currentStep : 0;
  const phase: PipelinePhase = task.phase || 'developing';
  const mrPoll = task.mrPollStatus;

  const DeleteBtn = () => (
    <Button danger icon={<DeleteOutlined />} size="small"
      onClick={() => void setDeleteConfirm(true)}>删除任务</Button>
  );

  /** 根据 phase 直接渲染按钮 — 每个 phase 有明确的主/次操作 */
  const renderActions = () => {
    switch (phase) {
      // ====== 未开始 / 第一步失败重试 ======
      case 'pending': {
        if (task.status === 'running') return null; // 正在执行，不显示按钮
        const branchError = task.steps.find(s => s.key === 'branch')?.status === 'error';
        return (
          <Space size={6}>
            <Button type="primary" icon={<PlayCircleOutlined />} size="small"
              onClick={() => startTask(task.id)} loading={loading}>
              {branchError ? '重试' : '开始'}
            </Button>
            <DeleteBtn />
          </Space>
        );
      }

      // ====== 开发中（分支已创建，用户可操作） ======
      case 'developing': {
        const commitStep = task.steps.find(s => s.key === 'commit');
        const syncStep = task.steps.find(s => s.key === 'sync');
        const pushStep = task.steps.find(s => s.key === 'push');
        const mrStep = task.steps.find(s => s.key === 'mr');

        const commitDone = commitStep?.status === 'finish';
        const syncDone = syncStep?.status === 'finish';
        const pushDone = pushStep?.status === 'finish';
        const pushError = pushStep?.status === 'error';
        const mrError = mrStep?.status === 'error';

        // 推送已完成 → 主操作是创建MR，可回退继续开发
        if (pushDone) {
          return (
            <Space size={6}>
              <Button type="primary" icon={<PullRequestOutlined />} size="small"
                onClick={handleOpenCreateMRModal} loading={loading}>
                {mrError ? '重试创建MR' : '创建MR'}
              </Button>
              <Button icon={<EditOutlined />} size="small"
                onClick={() => resumeDevelopment(task.id)}>继续开发</Button>
              <DeleteBtn />
            </Space>
          );
        }

        // 推送失败 → 显示重试推送 + 同步
        if (pushError) {
          return (
            <Space size={6}>
              <Button type="primary" icon={<CloudUploadOutlined />} size="small"
                onClick={() => pushRemote(task.id)} loading={loading}>重试推送</Button>
              <Button icon={<ReloadOutlined />} size="small"
                onClick={() => syncRemote(task.id)} loading={loading}>同步远程</Button>
              <DeleteBtn />
            </Space>
          );
        }

        // 同步已完成 → 主操作是推送，可回退继续开发
        if (syncDone) {
          return (
            <Space size={6}>
              <Button type="primary" icon={<CloudUploadOutlined />} size="small"
                onClick={() => pushRemote(task.id)} loading={loading}>推送到远程</Button>
              <Button icon={<EditOutlined />} size="small"
                onClick={() => resumeDevelopment(task.id)}>继续开发</Button>
              <DeleteBtn />
            </Space>
          );
        }

        // 提交已完成 → 主操作是同步
        if (commitDone) {
          return (
            <Space size={6}>
              <Button type="primary" icon={<ReloadOutlined />} size="small"
                onClick={() => syncRemote(task.id)} loading={loading}>同步远程</Button>
              <Button icon={<EditOutlined />} size="small"
                onClick={() => setCommitModalOpen(true)}>提交代码</Button>
              <DeleteBtn />
            </Space>
          );
        }

        // 未提交 → 主操作是提交代码，可跳过直接同步
        return (
          <Space size={6}>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>提交代码</Button>
            <Button icon={<ReloadOutlined />} size="small"
              onClick={() => syncRemote(task.id)} loading={loading}>同步远程</Button>
            <DeleteBtn />
          </Space>
        );
      }

      // ====== 同步中（自动） ======
      case 'syncing':
      case 'pushing':
      case 'creating_mr':
      case 'cleaning_up':
        return <DeleteBtn />;

      // ====== 同步错误暂停 ======
      case 'paused_sync_error': {
        const isConflict = (task.error || '').includes('冲突');
        // 冲突：在工作区解决冲突后点击"已解决，继续"；也可取消变基
        // 未提交：先提交代码，再同步
        return (
          <Space size={6}>
            {isConflict ? (
              <>
                <Button type="primary" icon={<CheckCircleOutlined />} size="small"
                  onClick={() => rebaseContinue(task.id)} loading={loading}>
                  已解决，继续
                </Button>
                <Button danger icon={<CloseCircleOutlined />} size="small"
                  onClick={() => abortRebase(task.id)} loading={loading}>
                  取消变基
                </Button>
              </>
            ) : (
              <>
                <Button type="primary" icon={<EditOutlined />} size="small"
                  onClick={() => setCommitModalOpen(true)} loading={loading}>
                  提交代码
                </Button>
                <Button icon={<ReloadOutlined />} size="small"
                  onClick={() => syncRemote(task.id)} loading={loading}>
                  同步远程
                </Button>
              </>
            )}
            <DeleteBtn />
          </Space>
        );
      }

      // ====== 等待合并 ======
      case 'waiting_merge':
        return renderWaitingMergeActions();

      // ====== 完成 ======
      case 'finished':
        return <DeleteBtn />;

      // ====== 仅可删除 ======
      case 'delete_only':
      default:
        return <DeleteBtn />;
    }
  };

  /** 等待合并阶段的按钮 — 根据 mrPollStatus 细分 */
  const renderWaitingMergeActions = () => {
    switch (mrPoll) {
      case 'conflict':
        return (
          <Space size={6}>
            <Tag color="error">⚠️ 冲突</Tag>
            <Button type="primary" icon={<SyncOutlined />} size="small"
              onClick={() => resumeFromConflict(task.id)} loading={loading}>同步远程</Button>
            <Button icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>提交代码</Button>
            <DeleteBtn />
          </Space>
        );

      case 'pipeline_failed':
        return (
          <Space size={6}>
            <Tag color="warning">❌ 流水线失败</Tag>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>提交代码</Button>
            <Button icon={<CloudUploadOutlined />} size="small"
              onClick={() => pushRemote(task.id)} loading={loading}>推送</Button>
            <DeleteBtn />
          </Space>
        );

      case 'not_approved':
        return (
          <Space size={6}>
            <Tag color="processing">⏳ 等待审批</Tag>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>提交代码</Button>
            <Button icon={<CloudUploadOutlined />} size="small"
              onClick={() => pushRemote(task.id)} loading={loading}>推送</Button>
            <DeleteBtn />
          </Space>
        );

      case 'closed':
        return (
          <Space size={6}>
            <Tag color="default">🚫 MR 已关闭</Tag>
            <Button icon={<EditOutlined />} size="small"
              onClick={() => resumeDevelopment(task.id)}>继续开发</Button>
            <Button type="primary" icon={<PullRequestOutlined />} size="small"
              onClick={() => reopenMR(task.id)} loading={loading}>重新打开MR</Button>
            <DeleteBtn />
          </Space>
        );

      case 'mergeable':
        return (
          <Space size={6}>
            <Tag color="processing">🟢 可合并</Tag>
            {task.mrUrl && (
              <a href={task.mrUrl} target="_blank" rel="noopener noreferrer">
                <Button icon={<PullRequestOutlined />} size="small">查看MR</Button>
              </a>
            )}
            <Button danger icon={<CloseCircleOutlined />} size="small"
              onClick={() => void setCloseMRConfirm(true)}>关闭MR</Button>
            <DeleteBtn />
          </Space>
        );

      default:
        return (
          <Space size={6}>
            <Tag color="processing">⏳ 等待合并</Tag>
            {task.mrUrl && (
              <a href={task.mrUrl} target="_blank" rel="noopener noreferrer">
                <Button icon={<PullRequestOutlined />} size="small">查看MR</Button>
              </a>
            )}
            <Button danger icon={<CloseCircleOutlined />} size="small"
              onClick={() => void setCloseMRConfirm(true)}>关闭MR</Button>
            <DeleteBtn />
          </Space>
        );
    }
  };

  return (
    <div style={{
      padding: '12px 16px', marginBottom: 12,
      background: token.colorBgContainer,
      border: `1px solid ${token.colorBorderSecondary}`,
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Space size={8}>
          <RocketOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 14 }}>{task.name}</Text>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>{task.branchName}</Text>
          {getTaskStatusTag(task.status)}
        </Space>
        <Space size={6}>
          {renderActions()}
        </Space>
      </div>
      <Steps
        size="small"
        current={currentStepIndex}
        items={task.steps.map((step) => ({
          title: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              {getStepIcon(step.key)}
              <span>{step.title}</span>
              {getStatusIcon(step.status)}
            </span>
          ),
          description: step.description ? (
            <span style={{ fontSize: 11 }}>{step.description}</span>
          ) : step.error ? (
            <span style={{ fontSize: 11, color: token.colorError }}>{step.error}</span>
          ) : null,
          status: step.status === 'error' ? 'error' : step.status === 'finish' ? 'finish' : step.status === 'process' ? 'process' : step.status === 'skip' ? 'finish' : 'wait',
        }))}
      />

      <Modal
        title="删除任务"
        open={deleteConfirm}
        onOk={async () => {
          setDeleteLoading(true);
          await deleteTask(task.id);
          setDeleteLoading(false);
          setDeleteConfirm(false);
        }}
        onCancel={() => setDeleteConfirm(false)}
        okText="删除"
        okType="danger"
        cancelText="取消"
        centered
        confirmLoading={deleteLoading}
      >
        <p>确定删除任务 <strong>{task.name}</strong>？</p>
        <p style={{ color: '#faad14', fontSize: 12, marginTop: 8 }}>
          ⚠️ 将同时清理本地/远程分支和MR，此操作不可撤销
        </p>
      </Modal>

      <Modal
        title="关闭 MR"
        open={closeMRConfirm}
        onOk={async () => {
          await closeMR(task.id);
          setCloseMRConfirm(false);
        }}
        onCancel={() => setCloseMRConfirm(false)}
        okText="关闭"
        okType="danger"
        cancelText="取消"
        centered
      >
        <p>确定关闭任务 <strong>{task.name}</strong> 的 MR？关闭后不会合并到目标分支。</p>
      </Modal>

      <Modal
        title="提交代码"
        open={commitModalOpen}
        onOk={async () => {
          if (!commitMessage.trim()) {
            message.warning('请填写提交备注');
            return;
          }
          await commitCode(task.id, commitMessage.trim());
          setCommitModalOpen(false);
          setCommitMessage('');
        }}
        onCancel={() => {
          setCommitModalOpen(false);
          setCommitMessage('');
        }}
        okText="提交"
        cancelText="取消"
        okButtonProps={{ disabled: !commitMessage.trim() }}
        centered
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>提交备注（必填）</Text>
        </div>
        <Input.TextArea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="请填写提交备注"
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={200}
        />
      </Modal>

      <Modal
        title="创建 MR"
        open={createMRModalOpen}
        onOk={() => {
          setCreateMRModalOpen(false);
          setMrCommitMessage('');
          createMR(task.id, mrCommitMessage.trim() || undefined);
        }}
        onCancel={() => {
          setCreateMRModalOpen(false);
          setMrCommitMessage('');
        }}
        okText="创建"
        cancelText="取消"
        centered
      >
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {task.mrSettings.squash ? '压缩提交消息（可选）' : '合并提交消息（可选）'}
          </Text>
        </div>
        <Input.TextArea
          value={mrCommitMessage}
          onChange={(e) => setMrCommitMessage(e.target.value)}
          placeholder={task.mrSettings.squash ? '留空则自动拼接所有提交消息' : '留空则使用默认消息'}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={500}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
          提示：此消息将作为自动合并时的提交消息
        </div>
      </Modal>
    </div>
  );
}
