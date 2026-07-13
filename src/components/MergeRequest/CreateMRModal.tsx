import { useState, useEffect } from 'react';
import { Modal, Form, Input, Switch, Button, Space, message } from 'antd';
import { useGitLabStore } from '../../stores/gitlabStore';
import { useRepoStore } from '../../stores/repoStore';
import type { CreateMergeRequestParams } from '../../services/gitlab';

interface CreateMRModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreateMRModal({ open, onClose, onSuccess }: CreateMRModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const createMergeRequest = useGitLabStore((s) => s.createMergeRequest);
  const repoInfo = useRepoStore((s) => s.repoInfo);

  useEffect(() => {
    if (open && repoInfo) {
      // Auto-fill source branch with current branch
      form.setFieldsValue({
        source_branch: repoInfo.currentBranch,
        target_branch: 'develop',
        remove_source_branch: true,
        squash: false,
      });
    }
  }, [open, repoInfo]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const params: CreateMergeRequestParams = {
        source_branch: values.source_branch,
        target_branch: values.target_branch,
        title: values.title,
        description: values.description,
        remove_source_branch: values.remove_source_branch,
        squash: values.squash,
      };

      const mr = await createMergeRequest(params);
      if (mr) {
        message.success('MR 创建成功');
        form.resetFields();
        onClose();
        onSuccess?.();
      }
    } catch (e) {
      console.error('创建 MR 失败:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建 Merge Request"
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: '请输入 MR 标题' }]}
        >
          <Input placeholder="feat: 新功能描述" />
        </Form.Item>

        <Form.Item
          name="description"
          label="描述"
        >
          <Input.TextArea
            placeholder={`## 变更说明
- 变更 1
- 变更 2

## 测试
- [ ] 单元测试通过
- [ ] 手动测试通过`}
            rows={6}
          />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            name="source_branch"
            label="源分支"
            rules={[{ required: true, message: '请选择源分支' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="feature/xxx" />
          </Form.Item>

          <Form.Item
            name="target_branch"
            label="目标分支"
            rules={[{ required: true, message: '请选择目标分支' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="develop" />
          </Form.Item>
        </div>

        <div style={{ display: 'flex', gap: 24 }}>
          <Form.Item
            name="remove_source_branch"
            label="合并后删除源分支"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="squash"
            label="Squash 提交"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </div>

        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              创建
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}
