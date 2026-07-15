import { Form, Input, Switch, Select, Space, Tag, Tooltip, Modal, Typography, theme, message } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { useBranchTagStore } from '../../stores/branchTagStore';

const { Text } = Typography;

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateTaskModal({ open, onClose }: CreateTaskModalProps) {
  const [form] = Form.useForm();
  const createTask = usePipelineStore((s) => s.createTask);
  const startTask = usePipelineStore((s) => s.startTask);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const repoPath = useRepoStore((s) => s.repoPath);
  const getTargetBranch = useBranchTagStore((s) => s.getTargetBranch);
  const setSelectedFile = useViewStore((s) => s.setSelectedFile);
  const { token } = theme.useToken();

  const taskName = Form.useWatch('name', form) || '';
  const branchPrefix = Form.useWatch('branchPrefix', form) || 'feature';
  const branchSuffix = Form.useWatch('branchSuffix', form) || '';

  const remoteBranches = (repoInfo?.branches || [])
    .filter((b) => b.name.startsWith('remotes/'))
    .map((b) => b.name.replace(/^remotes\/[^/]+\//, ''))
    .filter((name, i, arr) => arr.indexOf(name) === i);

  const targetBranch = repoPath ? getTargetBranch(repoPath) : null;
  const hasTargetBranch = targetBranch && remoteBranches.includes(targetBranch);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (!hasTargetBranch) {
        message.error('请先在分支界面标记一个开发分支');
        return;
      }
      const suffix = values.branchSuffix || values.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-龥-]/g, '');
      const branchName = `${values.branchPrefix}/${suffix}`;
      const task = createTask({
        name: values.name,
        branchName,
        syncStrategy: values.syncStrategy,
        mrSettings: {
          enabled: true,
          squash: values.squash,
          deleteBranchAfterMerge: values.deleteBranch,
          autoMerge: values.autoMerge,
          targetBranch: targetBranch!,
        },
      });
      if (!task) return;
      form.resetFields();
      setSelectedFile(null);
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
        squash: true,
        deleteBranch: true,
        autoMerge: true,
      }}>
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder="例：用户登录功能" />
        </Form.Item>
        <Form.Item label="分支名称">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="branchPrefix" noStyle>
              <Select style={{ width: 120 }}>
                <Select.Option value="feature">feature</Select.Option>
                <Select.Option value="bugfix">bugfix</Select.Option>
                <Select.Option value="hotfix">hotfix</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="branchSuffix" noStyle>
              <Input style={{ flex: 1 }} placeholder="留空则使用任务名称" />
            </Form.Item>
          </Space.Compact>
          <div style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary, #999)', marginTop: 4 }}>
            完整分支名：{branchPrefix}/{branchSuffix || taskName || '...'}
          </div>
        </Form.Item>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 6, color: token.colorTextSecondary }}>目标分支</div>
          {hasTargetBranch ? (
            <Tag color="blue" icon={<BranchesOutlined />} style={{ margin: 0 }}>
              🔗 {targetBranch}
            </Tag>
          ) : (
            <Tooltip title="请先在分支界面将一个分支标记为「🔗 开发分支」">
              <Tag color="warning" style={{ margin: 0, cursor: 'pointer' }}>⚠️ 未设置</Tag>
            </Tooltip>
          )}
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
            创建分支、同步远程、创建MR 都基于此分支
          </div>
        </div>
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
