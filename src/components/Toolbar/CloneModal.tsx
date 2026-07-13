import { useState, useMemo } from 'react';
import { Modal, Input, Form, Typography, message } from 'antd';
import { FolderOpenOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const { Text } = Typography;

interface CloneModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (path: string, alias?: string) => void;
}

export function CloneModal({ open, onClose, onSuccess }: CloneModalProps) {
  const [url, setUrl] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [alias, setAlias] = useState('');
  const [cloning, setCloning] = useState(false);

  const inferredName = useMemo(() => {
    const match = url.trim().match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : '';
  }, [url]);

  const suggestedPath = useMemo(() => {
    if (!targetPath || !inferredName) return '';
    if (targetPath.endsWith('/' + inferredName) || targetPath.endsWith('\\' + inferredName)) {
      return targetPath;
    }
    return `${targetPath.replace(/[/\\]$/, '')}/${inferredName}`;
  }, [targetPath, inferredName]);

  const handleSelectFolder = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: '选择克隆目标目录' });
      if (selected && typeof selected === 'string') setTargetPath(selected);
    } catch { /* ignore */ }
  };

  const handleClone = async () => {
    if (!url.trim()) { message.warning('请输入远程仓库地址'); return; }
    const finalPath = suggestedPath || targetPath.trim();
    if (!finalPath) { message.warning('请选择目标路径'); return; }

    setCloning(true);
    try {
      await invoke('git_clone', { url: url.trim(), targetPath: finalPath });
      message.success('克隆成功');
      onSuccess?.(finalPath, alias.trim() || undefined);
      setUrl(''); setTargetPath(''); setAlias('');
      onClose();
    } catch (e) {
      message.error(`克隆失败: ${String(e)}`);
    } finally {
      setCloning(false);
    }
  };

  return (
    <Modal
      title={null}
      open={open}
      onOk={handleClone}
      onCancel={onClose}
      okText="开始克隆"
      cancelText="取消"
      confirmLoading={cloning}
      width={520}
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
          <CloudDownloadOutlined style={{ fontSize: 28, color: '#1677ff' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>克隆远程仓库</div>
        <Text type="secondary" style={{ fontSize: 13 }}>
          输入远程地址，克隆到本地
        </Text>
      </div>

      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="远程仓库地址" required>
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              const name = inferredName;
              if (name && !alias) setAlias(name);
            }}
            placeholder="https://github.com/user/repo.git"
            size="large"
            allowClear
          />
        </Form.Item>

        <Form.Item label="本地目标路径" required>
          <Input.Search
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="选择或输入目标目录..."
            enterButton={<FolderOpenOutlined />}
            onSearch={handleSelectFolder}
            size="large"
          />

          {inferredName && targetPath && (
            <div style={{
              marginTop: 8, padding: '6px 10px', borderRadius: 6,
              background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
              fontSize: 12,
            }}>
              <Text type="secondary">克隆目标：</Text>
              <code style={{ color: '#1677ff', fontSize: 12 }}>{suggestedPath}</code>
            </div>
          )}
        </Form.Item>

        <Form.Item label="项目别名" extra="留空则自动使用仓库名">
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder={inferredName || '输入别名方便搜索...'}
            size="large"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
