import { useState } from 'react';
import { Modal, Input, Form, Checkbox, Space, Tag, message } from 'antd';
import { BranchesOutlined, PushpinOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';

interface BranchModalProps {
  open: boolean;
  onClose: () => void;
}

export function BranchModal({ open, onClose }: BranchModalProps) {
  const [branchName, setBranchName] = useState('');
  const [pushAfterCreate, setPushAfterCreate] = useState(true);
  const [creating, setCreating] = useState(false);

  const repoInfo = useRepoStore((s) => s.repoInfo);
  const checkout = useRepoStore((s) => s.checkout);
  const push = useRepoStore((s) => s.push);

  const handleCreate = async () => {
    if (!branchName.trim()) {
      message.warning('请输入分支名称');
      return;
    }
    setCreating(true);
    try {
      // 1. 创建并切换
      await checkout(branchName.trim(), true);

      if (pushAfterCreate) {
        // 2. 推送到远程（设置上游）
        await push('origin');
        message.success(`分支 "${branchName}" 已创建、切换并推送到远程`);
      } else {
        message.success(`已创建并切换到分支 "${branchName}"`);
      }
      setBranchName('');
      setPushAfterCreate(true);
      onClose();
    } catch (e) {
      Modal.warning({
        title: '无法创建分支',
        content: String(e),
        centered: true,
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title="新建分支"
      open={open}
      onOk={handleCreate}
      onCancel={onClose}
      okText="创建"
      cancelText="取消"
      confirmLoading={creating}
      width={440}
    >
      <Form layout="vertical">
        {repoInfo && (
          <div style={{ marginBottom: 12 }}>
            <Space size={4}>
              <span style={{ fontSize: 12, color: '#999' }}>基于:</span>
              <Tag color="blue" icon={<BranchesOutlined />} style={{ margin: 0 }}>
                {repoInfo.currentBranch}
              </Tag>
            </Space>
          </div>
        )}

        <Form.Item label="分支名称" required>
          <Input
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="feature/new-feature"
            onPressEnter={handleCreate}
            autoFocus
          />
        </Form.Item>

        <Form.Item>
          <Checkbox
            checked={pushAfterCreate}
            onChange={(e) => setPushAfterCreate(e.target.checked)}
          >
            <Space size={4}>
              <PushpinOutlined />
              <span>创建后推送到远程</span>
            </Space>
          </Checkbox>
        </Form.Item>

        <div style={{ fontSize: 12, color: '#999' }}>
          新分支将基于 <b>{repoInfo?.currentBranch || '当前分支'}</b> 创建
          {pushAfterCreate && '，并自动推送到 origin'}
        </div>
      </Form>
    </Modal>
  );
}
