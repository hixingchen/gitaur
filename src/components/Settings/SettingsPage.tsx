import { useState, useEffect } from 'react';
import {
  Form, Input, Button, Card, Space, Typography, message,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, BranchesOutlined,
  CloudOutlined, SettingOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { appDataDir } from '@tauri-apps/api/path';

const { Text, Title } = Typography;

export function SettingsPage() {
  const [form] = Form.useForm();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const [saving, setSaving] = useState(false);
  const [dataPath, setDataPath] = useState<string>('');

  useEffect(() => {
    form.setFieldsValue(settings);
    // 获取数据存储路径（Roaming目录）
    appDataDir().then((path) => {
      setDataPath(path);
    }).catch(() => {
      setDataPath('无法获取路径');
    });
  }, [settings, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await updateSettings(values);
      message.success('设置已保存');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          <SettingOutlined style={{ marginRight: 8 }} />
          设置
        </Title>
        <Text type="secondary">配置全局选项（与仓库无关）</Text>
      </div>

      <Form form={form} layout="vertical" initialValues={settings}>
        {/* Git 用户信息 */}
        <Card
          title={
            <Space>
              <BranchesOutlined />
              <span>Git 用户信息</span>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="gitUserName" label="用户名" extra="提交时显示的作者名称">
            <Input placeholder="张三" />
          </Form.Item>
          <Form.Item name="gitUserEmail" label="邮箱" extra="提交时显示的作者邮箱">
            <Input placeholder="zhangsan@example.com" />
          </Form.Item>
        </Card>

        {/* GitLab 配置 */}
        <Card
          title={
            <Space>
              <CloudOutlined />
              <span>GitLab 配置</span>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Form.Item name="gitlabUrl" label="GitLab 地址">
            <Input placeholder="https://gitlab.com" />
          </Form.Item>
          <Form.Item name="gitlabToken" label="Personal Access Token" extra="用于访问 GitLab API">
            <Input.Password placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" />
          </Form.Item>
        </Card>

        {/* 数据存储路径 */}
        <Card
          title={
            <Space>
              <FolderOpenOutlined />
              <span>数据存储</span>
            </Space>
          }
          size="small"
          style={{ marginBottom: 24 }}
        >
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>应用数据存储位置：</Text>
          </div>
          <div style={{
            padding: '8px 12px',
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 6,
            fontFamily: 'monospace',
            fontSize: 12,
            wordBreak: 'break-all',
            marginBottom: 12,
          }}>
            {dataPath || '加载中...'}
          </div>
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => {
              // 复制路径到剪贴板
              navigator.clipboard.writeText(dataPath).then(() => {
                message.success('路径已复制到剪贴板');
              }).catch(() => {
                message.error('复制失败');
              });
            }}
          >
            复制路径
          </Button>
        </Card>

        {/* 保存按钮 */}
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => form.setFieldsValue(settings)}
            >
              重置
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
            >
              保存设置
            </Button>
          </Space>
        </div>
      </Form>
    </div>
  );
}
