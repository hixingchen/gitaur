import { useState, useRef, useCallback } from 'react';
import {
  Button, Steps, Tag, Space, Input, Modal, Form, Switch, Select, Divider,
  Typography, Tooltip, theme, message,
} from 'antd';
import {
  PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined,
  ReloadOutlined, StopOutlined, PlusOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined,
  BranchesOutlined, CodeOutlined, CloudUploadOutlined,
  PullRequestOutlined, RocketOutlined, ClearOutlined,
  EditOutlined, StepForwardOutlined, SwapOutlined,
} from '@ant-design/icons';
import { usePipelineStore, type PipelineTask, type TaskStatus, type StepStatus } from '../../stores/pipelineStore';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { useRepoManagerStore } from '../../stores/repoManagerStore';
import { useBranchTagStore } from '../../stores/branchTagStore';
import { FileTree, type PanelTab } from '../FileTree/FileTree';
import { DiffView } from '../DiffView/DiffView';

const { Text } = Typography;

function getStatusIcon(status: StepStatus) {
  switch (status) {
    case 'finish': return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    case 'error': return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    case 'process': return <LoadingOutlined style={{ color: '#1677ff' }} />;
    case 'skip': return <CheckCircleOutlined style={{ color: '#999' }} />;
    default: return null;
  }
}

function getTaskStatusTag(status: TaskStatus) {
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

// ====== 流水线步骤条 ======
interface PipelineBarProps {
  task: PipelineTask;
}

function PipelineBar({ task }: PipelineBarProps) {
  const { token } = theme.useToken();
  const startTask = usePipelineStore((s) => s.startTask);
  const commitCode = usePipelineStore((s) => s.commitCode);
  const syncRemote = usePipelineStore((s) => s.syncRemote);
  const pushRemote = usePipelineStore((s) => s.pushRemote);
  const createMR = usePipelineStore((s) => s.createMR);
  const checkMergeStatus = usePipelineStore((s) => s.checkMergeStatus);
  const deleteTask = usePipelineStore((s) => s.deleteTask);
  const abortRebase = usePipelineStore((s) => s.abortRebase);
  const rebaseContinue = usePipelineStore((s) => s.rebaseContinue);
  const closeMR = usePipelineStore((s) => s.closeMR);
  const loading = usePipelineStore((s) => s.loading);

  // 确认弹窗状态
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [closeMRConfirm, setCloseMRConfirm] = useState(false);
  const [abortRebaseConfirm, setAbortRebaseConfirm] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  const hasError = task.steps.some((s) => s.status === 'error');
  const isRunning = task.status === 'running';
  const isFinished = task.status === 'success' || task.status === 'cancelled';

  // 找到当前应该执行的步骤
  const developStep = task.steps.find((s) => s.key === 'develop');
  const commitStep = task.steps.find((s) => s.key === 'commit');
  const syncStep = task.steps.find((s) => s.key === 'sync');
  const pushStep = task.steps.find((s) => s.key === 'push');
  const mrStep = task.steps.find((s) => s.key === 'mr');
  const waitStep = task.steps.find((s) => s.key === 'wait');

  const currentStepIndex = task.currentStep >= 0 ? task.currentStep : 0;

  const renderActions = () => {
    if (task.status === 'pending') {
      return (
        <Space size={6}>
          <Button type="primary" icon={<PlayCircleOutlined />} size="small"
            onClick={() => startTask(task.id)} loading={loading}>
            开始
          </Button>
          <Button danger icon={<DeleteOutlined />} size="small"
            onClick={() => void setDeleteConfirm(true)}>
            删除任务
          </Button>
        </Space>
      );
    }

    // 开发步骤或已提交但未同步：显示"提交代码"和"同步远程"
    if (developStep?.status === 'process' || (developStep?.status === 'finish' && syncStep?.status === 'wait')) {
      return (
        <Space size={6}>
          <Button type="primary" icon={<EditOutlined />} size="small"
            onClick={() => setCommitModalOpen(true)}>
            提交代码
          </Button>
          <Button icon={<ReloadOutlined />} size="small"
            onClick={() => syncRemote(task.id)} loading={loading}>
            同步远程
          </Button>
          <Button danger icon={<DeleteOutlined />} size="small"
            onClick={() => setDeleteConfirm(true)}>
            删除任务
          </Button>
        </Space>
      );
    }

    // 同步步骤出错：根据错误类型显示不同按钮
    if (syncStep?.status === 'error') {
      const errorMsg = syncStep.error || '';
      // 未提交的更改：显示提交按钮
      if (errorMsg.includes('未提交的更改')) {
        return (
          <Space size={6}>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => setCommitModalOpen(true)}>
              提交代码
            </Button>
            <Button danger icon={<DeleteOutlined />} size="small"
              onClick={() => void setDeleteConfirm(true)}>
              删除任务
            </Button>
          </Space>
        );
      }
      // 冲突：显示继续同步和中止
      return (
        <Space size={6}>
          <Button type="primary" icon={<ReloadOutlined />} size="small"
            onClick={() => rebaseContinue(task.id)} loading={loading}>
            继续同步
          </Button>
          <Button danger icon={<StopOutlined />} size="small"
            onClick={() => void setAbortRebaseConfirm(true)}>
            中止同步
          </Button>
        </Space>
      );
    }

    // 同步完成，等待推送：显示"推送到远程"
    if (syncStep?.status === 'finish' && (pushStep?.status === 'wait' || pushStep?.status === 'process')) {
      return (
        <Space size={6}>
          <Button type="primary" icon={<CloudUploadOutlined />} size="small"
            onClick={() => pushRemote(task.id)} loading={loading}>
            推送到远程
          </Button>
          <Button danger icon={<DeleteOutlined />} size="small"
            onClick={() => void setDeleteConfirm(true)}>
            删除任务
          </Button>
        </Space>
      );
    }

    // 推送完成，等待创建MR：显示"创建MR"
    if (pushStep?.status === 'finish' && (mrStep?.status === 'wait' || mrStep?.status === 'process')) {
      return (
        <Space size={6}>
          <Button type="primary" icon={<PullRequestOutlined />} size="small"
            onClick={() => createMR(task.id)} loading={loading}>
            创建MR
          </Button>
          <Button danger icon={<DeleteOutlined />} size="small"
            onClick={() => void setDeleteConfirm(true)}>
            删除任务
          </Button>
        </Space>
      );
    }

    // 运行中（等待合并时也是 running 状态，但优先显示等待合并按钮）
    if (isRunning && waitStep?.status !== 'process') {
      return (
        <Button danger icon={<DeleteOutlined />} size="small"
          onClick={() => void setDeleteConfirm(true)}>
          删除任务
        </Button>
      );
    }

    // 等待合并：显示"检查合并"和"关闭MR"
    if (waitStep?.status === 'process') {
      return (
        <Space size={6}>
          <Button type="primary" icon={<StepForwardOutlined />} size="small"
            onClick={() => checkMergeStatus(task.id)} loading={loading}>
            检查合并
          </Button>
          {task.mrUrl && (
            <a href={task.mrUrl} target="_blank" rel="noopener noreferrer">
              <Button icon={<PullRequestOutlined />} size="small">查看MR</Button>
            </a>
          )}
          <Button danger icon={<CloseCircleOutlined />} size="small"
            onClick={() => void setCloseMRConfirm(true)}>
            关闭MR
          </Button>
          <Button danger icon={<DeleteOutlined />} size="small"
            onClick={() => void setDeleteConfirm(true)}>
            删除任务
          </Button>
        </Space>
      );
    }

    // 有错误 - 根据失败步骤显示具体操作
    if (hasError) {
      // 提交失败（如 nothing to commit）
      if (commitStep?.status === 'error') {
        return (
          <Space size={6}>
            <Button type="primary" icon={<EditOutlined />} size="small"
              onClick={() => commitCode(task.id)} loading={loading}>
              重新提交
            </Button>
            <Button danger icon={<DeleteOutlined />} size="small"
              onClick={() => void setDeleteConfirm(true)}>
              删除任务
            </Button>
          </Space>
        );
      }

      // 推送失败
      if (pushStep?.status === 'error') {
        return (
          <Space size={6}>
            <Button type="primary" icon={<CloudUploadOutlined />} size="small"
              onClick={() => pushRemote(task.id)} loading={loading}>
              重新推送
            </Button>
            <Button danger icon={<DeleteOutlined />} size="small"
              onClick={() => void setDeleteConfirm(true)}>
              删除任务
            </Button>
          </Space>
        );
      }

      // MR 失败
      if (mrStep?.status === 'error') {
        return (
          <Space size={6}>
            <Button type="primary" icon={<PullRequestOutlined />} size="small"
              onClick={() => createMR(task.id)} loading={loading}>
              重新创建MR
            </Button>
            <Button danger icon={<DeleteOutlined />} size="small"
              onClick={() => void setDeleteConfirm(true)}>
              删除任务
            </Button>
          </Space>
        );
      }

      // 其他错误（包括同步错误，已在上面处理）
      return (
        <Button danger icon={<DeleteOutlined />} size="small"
          onClick={() => void setDeleteConfirm(true)}>
          删除任务
        </Button>
      );
    }

    if (isFinished) {
      return (
        <Button danger icon={<DeleteOutlined />} size="small"
          onClick={() => void setDeleteConfirm(true)}>
          删除任务
        </Button>
      );
    }

    return null;
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

      {/* 删除任务确认弹窗 */}
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

      {/* 关闭 MR 确认弹窗 */}
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

      {/* 中止同步确认弹窗 */}
      <Modal
        title="中止同步"
        open={abortRebaseConfirm}
        onOk={async () => {
          await abortRebase(task.id);
          setAbortRebaseConfirm(false);
        }}
        onCancel={() => setAbortRebaseConfirm(false)}
        okText="中止"
        okType="danger"
        cancelText="取消"
        centered
      >
        <p>确定中止任务 <strong>{task.name}</strong> 的同步？中止将放弃当前同步操作。</p>
      </Modal>

      {/* 提交代码备注弹窗 */}
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

// ====== 创建任务弹窗 ======
interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
}

function CreateTaskModal({ open, onClose }: CreateTaskModalProps) {
  const [form] = Form.useForm();
  const createTask = usePipelineStore((s) => s.createTask);
  const startTask = usePipelineStore((s) => s.startTask);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const repoPath = useRepoStore((s) => s.repoPath);
  const getTargetBranch = useBranchTagStore((s) => s.getTargetBranch);
  const { token } = theme.useToken();

  // 实时监听表单值
  const taskName = Form.useWatch('name', form) || '';
  const branchPrefix = Form.useWatch('branchPrefix', form) || 'feature';
  const branchSuffix = Form.useWatch('branchSuffix', form) || '';

  // 获取远程分支列表
  const remoteBranches = (repoInfo?.branches || [])
    .filter((b) => b.name.startsWith('remotes/'))
    .map((b) => b.name.replace(/^remotes\/[^/]+\//, ''))
    .filter((name, i, arr) => arr.indexOf(name) === i);

  // 获取标签指定的开发分支
  const targetBranch = repoPath ? getTargetBranch(repoPath) : null;
  const hasTargetBranch = targetBranch && remoteBranches.includes(targetBranch);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (!hasTargetBranch) {
        message.error('请先在分支界面标记一个开发分支');
        return;
      }
      // 构建完整分支名：prefix/suffix，后缀为空时用任务名称
      const suffix = values.branchSuffix || values.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-龥-]/g, '');
      const branchName = `${values.branchPrefix}/${suffix}`;
      const task = createTask({
        name: values.name,
        branchName,
        syncStrategy: values.syncStrategy,
        mrSettings: {
          enabled: values.mrEnabled,
          squash: values.squash,
          deleteBranchAfterMerge: values.deleteBranch,
          autoMerge: values.autoMerge,
          targetBranch: targetBranch!,
        },
      });
      if (!task) return;
      form.resetFields();
      onClose();
      await startTask(task.id);
    } catch {
      // validation failed
    }
  };

  return (
    <Modal
      title="新建任务"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="创建并开始"
      cancelText="取消"
      width={480}
      okButtonProps={{ disabled: !hasTargetBranch }}
    >
      {remoteBranches.length === 0 && (
        <div style={{
          padding: '10px 12px', marginBottom: 16,
          background: token.colorWarningBg,
          borderRadius: 8, border: `1px solid ${token.colorWarningBorder}`,
          fontSize: 13, color: token.colorWarningText,
        }}>
          ⚠️ 未检测到远程分支，请先推送代码到远程仓库
        </div>
      )}
      <Form form={form} layout="vertical" initialValues={{
        branchPrefix: 'feature',
        syncStrategy: 'rebase',
        mrEnabled: true,
        squash: true,
        deleteBranch: true,
        autoMerge: false,
      }}>
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder="例：用户登录功能" />
        </Form.Item>
        <Form.Item label="分支名称">
          <Input.Group compact>
            <Form.Item name="branchPrefix" noStyle>
              <Select style={{ width: 120 }}>
                <Select.Option value="feature">feature</Select.Option>
                <Select.Option value="bugfix">bugfix</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="branchSuffix" noStyle>
              <Input style={{ width: 'calc(100% - 120px)' }} placeholder="留空则使用任务名称" />
            </Form.Item>
          </Input.Group>
          <div style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary, #999)', marginTop: 4 }}>
            完整分支名：{branchPrefix}/{branchSuffix || taskName || '...'}
          </div>
        </Form.Item>
        <Form.Item name="syncStrategy" label="同步策略">
          <Select options={[
            { value: 'rebase', label: 'Rebase（变基，历史干净）' },
            { value: 'merge', label: 'Merge（合并，保留历史）' },
          ]} />
        </Form.Item>
        <div style={{
          padding: '12px', marginBottom: 16,
          background: token.colorFillQuaternary,
          borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 13 }}>MR 设置</div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>创建MR</span>
            <Form.Item name="mrEnabled" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: token.colorTextSecondary }}>目标分支</span>
            {hasTargetBranch ? (
              <Tag color="blue" icon={<BranchesOutlined />} style={{ margin: 0 }}>
                🔗 {targetBranch}
              </Tag>
            ) : (
              <Tooltip title="请先在分支界面将一个分支标记为「🔗 开发分支」">
                <Tag color="warning" style={{ margin: 0, cursor: 'pointer' }}>⚠️ 未设置</Tag>
              </Tooltip>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>Squash 提交</span>
            <Form.Item name="squash" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>合并后删除分支</span>
            <Form.Item name="deleteBranch" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>自动合并</span>
            <Form.Item name="autoMerge" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  );
}
// ====== 完成状态页（成功/取消） ======
function FinishedPage({ task, onNewTask }: { task: PipelineTask; onNewTask: () => void }) {
  const { token } = theme.useToken();
  const deleteTask = usePipelineStore((s) => s.deleteTask);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isSuccess = task.status === 'success';
  const icon = isSuccess
    ? <CheckCircleOutlined style={{ fontSize: 56, color: token.colorSuccess }} />
    : <StopOutlined style={{ fontSize: 56, color: token.colorWarning }} />;

  const title = isSuccess ? '任务完成' : '任务已取消';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: 20,
    }}>
      {icon}
      <div style={{ fontSize: 18, fontWeight: 600, color: token.colorText }}>{title}</div>
      <Text type="secondary">{task.name} · {task.branchName}</Text>
      <Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={onNewTask}>
          新建任务
        </Button>
        <Button icon={<DeleteOutlined />} onClick={() => setConfirmOpen(true)}>
          清除记录
        </Button>
      </Space>

      <Modal
        title="清除任务记录"
        open={confirmOpen}
        onOk={async () => {
          await deleteTask(task.id);
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
        okText="清除"
        okType="danger"
        cancelText="取消"
        centered
      >
        <p>确定清除任务 <strong>{task.name}</strong> 的记录？</p>
      </Modal>
    </div>
  );
}

// ====== 空状态页 ======
function EmptyPage({ onNewTask }: { onNewTask: () => void }) {
  const { token } = theme.useToken();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: 20,
    }}>
      <RocketOutlined style={{ fontSize: 56, color: token.colorTextQuaternary }} />
      <div style={{ fontSize: 16, color: token.colorTextSecondary }}>开始一个新任务</div>
      <Button type="primary" icon={<PlusOutlined />} size="large" onClick={onNewTask}>
        新建任务
      </Button>
    </div>
  );
}

// ====== 主组件 ======
export function PipelinePanel() {
  const { token } = theme.useToken();
  const currentTask = usePipelineStore((s) => s.currentTask);
  const tasksByRepo = usePipelineStore((s) => s.tasksByRepo);
  const setCurrentTask = usePipelineStore((s) => s.setCurrentTask);
  const deleteTaskFromStore = usePipelineStore((s) => s.deleteTask);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('changes');
  const [panelWidth, setPanelWidth] = useState(220);
  const resizing = useRef(false);

  const repoPath = useRepoStore((s) => s.repoPath);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const checkout = useRepoStore((s) => s.checkout);
  const refreshStatusSilent = useRepoStore((s) => s.refreshStatusSilent);
  const setSelectedFile = useViewStore((s) => s.setSelectedFile);
  const savedRepos = useRepoManagerStore((s) => s.repos);

  const repoName = repoPath
    ? (savedRepos.find((r) => r.path === repoPath)?.alias || repoPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || repoPath)
    : '';

  // 获取当前仓库的所有任务
  const allTasks = repoPath ? (tasksByRepo[repoPath] || []) : [];

  // 判断是否应该显示文件树（开发阶段或同步出错需要提交时）
  const commitStep = currentTask?.steps.find((s) => s.key === 'commit');
  const syncStep = currentTask?.steps.find((s) => s.key === 'sync');
  const showFileTree = currentTask && (
    // 开发阶段（提交未完成）
    (commitStep && commitStep.status !== 'finish') ||
    // 已提交但未同步
    (commitStep?.status === 'finish' && syncStep?.status === 'wait') ||
    // 同步出错且是未提交的更改（需要提交代码）
    (syncStep?.status === 'error' && (syncStep.error || '').includes('未提交的更改'))
  );
  // 任务是否已成功完成
  const isSuccess = currentTask?.status === 'success';

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
    const onUp = () => { resizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
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
      {/* 顶部：仓库信息 + 任务选择器 */}
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

        {/* 任务选择器 */}
        {allTasks.length > 0 && (
          <Select
            value={currentTask?.id}
            onChange={async (taskId) => {
              const task = allTasks.find((t) => t.id === taskId);
              if (!task) return;

              // 检查任务分支是否存在
              const localBranches = (repoInfo?.branches || [])
                .filter((b) => !b.name.startsWith('remotes/'))
                .map((b) => b.name);

              if (task.status !== 'pending' && !localBranches.includes(task.branchName)) {
                // 分支已被删除，自动清理任务
                await deleteTaskFromStore(task.id);
                message.warning(`任务 "${task.name}" 的分支已不存在，已自动删除`);
                return;
              }

              // 切换到任务分支
              if (task.status !== 'pending') {
                try {
                  await checkout(task.branchName);
                  await refreshStatusSilent();
                } catch (e) {
                  message.error(`切换分支失败: ${String(e)}`);
                  return;
                }
              }

              setCurrentTask(taskId);
              setSelectedFile(null); // 切换任务时重置选中的文件
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
              const task = allTasks.find((t) => t.id === option.value);
              if (!task) return null;
              const statusIcon = task.status === 'running' ? '🔄' :
                task.status === 'paused' ? '⏸️' :
                task.status === 'pending' ? '⏳' :
                task.status === 'success' ? '✅' : '❌';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{statusIcon}</span>
                  <span>{task.name}</span>
                  <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>{task.branchName}</span>
                </div>
              );
            }}
          />
        )}
      </div>

      {/* 流水线步骤条（有任务且未成功完成时显示，包括有错误的状态） */}
      {currentTask && !isSuccess && <PipelineBar task={currentTask} />}

      {/* 主内容区 */}
      {!currentTask ? (
        /* 无任务：空状态 */
        <EmptyPage onNewTask={() => setCreateModalOpen(true)} />
      ) : isSuccess ? (
        /* 已成功：完成页 */
        <FinishedPage task={currentTask} onNewTask={() => setCreateModalOpen(true)} />
      ) : showFileTree ? (
        /* 开发阶段（提交未完成）：文件树 + Diff */
        <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
          <div style={{
            width: panelWidth, flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: token.colorBgContainer,
            borderRadius: 10, padding: 12,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <FileTree
              tab={panelTab}
              onTabChange={setPanelTab}
              onSelectFile={(path) => setSelectedFile(path)}
            />
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
            <DiffView />
          </div>
        </div>
      ) : (
        /* 等待合并等阶段：显示 MR 信息 */
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

      {/* 弹窗 */}
      <CreateTaskModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />
    </div>
  );
}
