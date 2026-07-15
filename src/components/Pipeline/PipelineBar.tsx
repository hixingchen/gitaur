import { useState } from 'react';
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
import { usePipelineStore, type PipelineTask, type TaskStatus, type StepStatus } from '../../stores/pipelineStore';

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

type ActionState =
  | 'pending' | 'developing' | 'sync_error_uncommitted' | 'sync_error_conflict'
  | 'sync_done' | 'push_done' | 'waiting_merge_normal' | 'waiting_merge_conflict'
  | 'waiting_merge_closed' | 'error_commit' | 'error_push' | 'error_mr'
  | 'running' | 'finished' | 'delete_only';

function getActionState(task: PipelineTask): ActionState {
  const developStep = task.steps.find((s) => s.key === 'develop');
  const commitStep = task.steps.find((s) => s.key === 'commit');
  const syncStep = task.steps.find((s) => s.key === 'sync');
  const pushStep = task.steps.find((s) => s.key === 'push');
  const mrStep = task.steps.find((s) => s.key === 'mr');
  const waitStep = task.steps.find((s) => s.key === 'wait');
  const hasError = task.steps.some((s) => s.status === 'error');
  const isRunning = task.status === 'running';
  const isFinished = task.status === 'success' || task.status === 'cancelled';

  if (task.status === 'pending') return 'pending';
  if (developStep?.status === 'process' || (developStep?.status === 'finish' && syncStep?.status === 'wait')) return 'developing';
  if (syncStep?.status === 'error') return (syncStep.error || '').includes('未提交的更改') ? 'sync_error_uncommitted' : 'sync_error_conflict';
  if (syncStep?.status === 'finish' && (pushStep?.status === 'wait' || pushStep?.status === 'process')) return 'sync_done';
  if (pushStep?.status === 'finish' && (mrStep?.status === 'wait' || mrStep?.status === 'process')) return 'push_done';
  if (isRunning && waitStep?.status !== 'process') return 'running';
  if (waitStep?.status === 'process') {
    const ps = task.mrPollStatus;
    if (ps === 'conflict' || ps === 'pipeline_failed' || ps === 'not_approved') return 'waiting_merge_conflict';
    if (ps === 'closed') return 'waiting_merge_closed';
    return 'waiting_merge_normal';
  }
  if (hasError) {
    if (commitStep?.status === 'error') return 'error_commit';
    if (pushStep?.status === 'error') return 'error_push';
    if (mrStep?.status === 'error') return 'error_mr';
    return 'delete_only';
  }
  if (isFinished) return 'finished';
  return 'delete_only';
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
  const loading = usePipelineStore((s) => s.loading);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [closeMRConfirm, setCloseMRConfirm] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  const currentStepIndex = task.currentStep >= 0 ? task.currentStep : 0;
  const actionState = getActionState(task);

  const DeleteBtn = () => (
    <Button danger icon={<DeleteOutlined />} size="small"
      onClick={() => void setDeleteConfirm(true)}>删除任务</Button>
  );

  const renderActions = () => {
    switch (actionState) {
      case 'pending':
        return (
          <Space size={6}>
            <Button type="primary" icon={<PlayCircleOutlined />} size="small"
              onClick={() => startTask(task.id)} loading={loading}>开始</Button>
            <DeleteBtn />
          </Space>
        );
      case 'developing':
        return (
          <Space size={6}>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>提交代码</Button>
            <Button icon={<ReloadOutlined />} size="small"
              onClick={() => syncRemote(task.id)} loading={loading}>同步远程</Button>
            <DeleteBtn />
          </Space>
        );
      case 'sync_error_uncommitted':
        return (
          <Space size={6}>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>提交代码</Button>
            <DeleteBtn />
          </Space>
        );
      case 'sync_error_conflict':
        return (
          <Space size={6}>
            <Button type="primary" icon={<ReloadOutlined />} size="small"
              onClick={() => syncRemote(task.id)} loading={loading}>继续同步</Button>
            <DeleteBtn />
          </Space>
        );
      case 'sync_done':
        return (
          <Space size={6}>
            <Button icon={<EditOutlined />} size="small"
              onClick={() => resumeDevelopment(task.id)}>继续开发</Button>
            <Button type="primary" icon={<CloudUploadOutlined />} size="small"
              onClick={() => pushRemote(task.id)} loading={loading}>推送到远程</Button>
            <DeleteBtn />
          </Space>
        );
      case 'push_done':
        return (
          <Space size={6}>
            <Button icon={<EditOutlined />} size="small"
              onClick={() => resumeDevelopment(task.id)}>继续开发</Button>
            <Button type="primary" icon={<PullRequestOutlined />} size="small"
              onClick={() => createMR(task.id)} loading={loading}>创建MR</Button>
            <DeleteBtn />
          </Space>
        );
      case 'running':
        return <DeleteBtn />;
      case 'waiting_merge_conflict': {
        const ps = task.mrPollStatus;
        const sm: Record<string, { l: string; c: string }> = {
          conflict: { l: '⚠️ 冲突', c: 'error' },
          pipeline_failed: { l: '❌ 流水线失败', c: 'warning' },
          not_approved: { l: '⏳ 等待审批', c: 'processing' },
        };
        const { l, c } = sm[ps!] || { l: '未知', c: 'default' };
        return (
          <Space size={6}>
            <Tag color={c}>{l}</Tag>
            {ps === 'conflict' ? (
              <Button type="primary" icon={<SyncOutlined />} size="small"
                onClick={() => resumeFromConflict(task.id)} loading={loading}>同步远程</Button>
            ) : (
              <>
                <Button type="primary" icon={<EditOutlined />} size="small"
                  onClick={() => setCommitModalOpen(true)}>提交代码</Button>
                <Button icon={<CloudUploadOutlined />} size="small"
                  onClick={() => pushRemote(task.id)} loading={loading}>推送</Button>
              </>
            )}
            <Button icon={<PullRequestOutlined />} size="small"
              onClick={() => createMR(task.id)} loading={loading}>创建MR</Button>
            <DeleteBtn />
          </Space>
        );
      }
      case 'waiting_merge_closed':
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
      case 'waiting_merge_normal': {
        const ps = task.mrPollStatus;
        const sl = ps === 'mergeable' ? '🟢 可合并' : '⏳ 等待合并';
        return (
          <Space size={6}>
            <Tag color="processing">{sl}</Tag>
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
      case 'error_commit':
        return (
          <Space size={6}>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => commitCode(task.id)} loading={loading}>重新提交</Button>
            <DeleteBtn />
          </Space>
        );
      case 'error_push':
        return (
          <Space size={6}>
            <Button type="primary" icon={<CloudUploadOutlined />} size="small"
              onClick={() => pushRemote(task.id)} loading={loading}>重新推送</Button>
            <DeleteBtn />
          </Space>
        );
      case 'error_mr':
        return (
          <Space size={6}>
            <Button type="primary" icon={<PullRequestOutlined />} size="small"
              onClick={() => createMR(task.id)} loading={loading}>重新创建MR</Button>
            <DeleteBtn />
          </Space>
        );
      case 'finished':
      case 'delete_only':
      default:
        return <DeleteBtn />;
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
    </div>
  );
}
