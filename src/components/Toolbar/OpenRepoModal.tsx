import { useState } from 'react';
import { Modal, Form, Input, Typography, message } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { defaultAlias } from '../../stores/repoManagerStore';
import { invoke } from '@tauri-apps/api/core';

const { Text } = Typography;

interface OpenRepoModalProps {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string, alias?: string) => Promise<void>;
}

export function OpenRepoModal({ open, onClose, onOpen }: OpenRepoModalProps) {
  const [path, setPath] = useState('');
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSelectFolder = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: '选择 Git 仓库目录' });
      if (selected && typeof selected === 'string') {
        setPath(selected);
        if (!alias) setAlias(defaultAlias(selected));
      }
    } catch { /* ignore */ }
  };

  const handleOpen = async () => {
    if (!path.trim()) {
      message.warning('请选择或输入仓库路径');
      return;
    }
    setLoading(true);
    try {
      const valid = await invoke<boolean>('validate_repo_path', { path: path.trim() });
      if (!valid) {
        message.error('不是有效的 Git 仓库');
        setLoading(false);
        return;
      }
    } catch {
      message.error('路径验证失败');
      setLoading(false);
      return;
    }

    await onOpen(path.trim(), alias.trim() || undefined);
    setPath('');
    setAlias('');
    setLoading(false);
    onClose();
  };

  return (
    <Modal
      title={null}
      open={open}
      onOk={handleOpen}
      onCancel={onClose}
      okText="打开仓库"
      cancelText="取消"
      confirmLoading={loading}
      width={500}
      centered
      footer={(_, { OkBtn, CancelBtn }) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <CancelBtn />
          <OkBtn />
        </div>
      )}
    >
      {/* 头部图标 */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, margin: '0 auto 12',
          background: 'var(--ant-color-primary-bg, #e6f4ff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FolderOpenOutlined style={{ fontSize: 28, color: '#1677ff' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>打开本地仓库</div>
        <Text type="secondary" style={{ fontSize: 13 }}>
          选择一个本地 Git 仓库目录
        </Text>
      </div>

      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="仓库路径" required>
          <Input.Search
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              if (!alias) setAlias(defaultAlias(e.target.value));
            }}
            placeholder="D:/projects/my-repo"
            enterButton={<FolderOpenOutlined />}
            onSearch={handleSelectFolder}
            size="large"
          />
        </Form.Item>

        <Form.Item label="项目别名" extra="留空则自动使用目录名">
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder={path ? defaultAlias(path) : '输入别名方便搜索...'}
            size="large"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
