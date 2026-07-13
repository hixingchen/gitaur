import { useState } from 'react';
import { Layout, Menu, Button, theme } from 'antd';
import {
  FolderOpenOutlined,
  HomeOutlined,
  BranchesOutlined,
  HistoryOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PullRequestOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Titlebar } from './Titlebar';

const { Sider, Content, Header } = Layout;

export type NavKey = 'home' | 'repos' | 'workspace' | 'branches' | 'history' | 'diff' | 'settings' | 'mergerequests' | 'pipeline';

interface AppLayoutProps {
  children: React.ReactNode;
  activeNav: NavKey;
  onNavChange: (key: NavKey) => void;
}

export function AppLayout({ children, activeNav, onNavChange }: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();

  const menuItems = [
    { key: 'home', icon: <HomeOutlined />, label: '首页' },
    { key: 'repos', icon: <FolderOpenOutlined />, label: '仓库' },
    { type: 'divider' as const },
    { key: 'workspace', icon: <RocketOutlined />, label: '工作区' },
    { key: 'branches', icon: <BranchesOutlined />, label: '分支' },
    { key: 'history', icon: <HistoryOutlined />, label: '历史' },
    { key: 'mergerequests', icon: <PullRequestOutlined />, label: 'MR' },
    { type: 'divider' as const },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Titlebar />

      <Layout style={{ flex: 1, minHeight: 0 }}>
        <Sider trigger={null} collapsible collapsed={collapsed}
          style={{
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
          }}>
          <div style={{
            height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: collapsed ? 16 : 20, color: token.colorPrimary,
          }}>
            {collapsed ? 'G' : 'Gitaur'}
          </div>
          <Menu mode="inline" selectedKeys={[activeNav]}
            onClick={({ key }) => onNavChange(key as NavKey)}
            items={menuItems}
            style={{
              borderInlineEnd: 'none',
              background: token.colorBgContainer,
            }} />
        </Sider>

        <Layout>
          <Header style={{
            padding: '0 16px',
            height: 40,
            lineHeight: '40px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
          }}>
            <Button type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)} />
          </Header>

          <Content style={{
            margin: 16,
            padding: 16,
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            overflow: 'auto',
          }}>
            {children}
          </Content>
        </Layout>
      </Layout>
    </div>
  );
}
