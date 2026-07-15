import { useEffect, useState, useMemo, memo, useCallback, lazy, Suspense } from 'react';
import './App.css';
import { ConfigProvider, theme, App as AntApp, Button, Input, Modal, Space, message, Typography, Popover, Spin } from 'antd';
import { FolderOpenOutlined, PlusOutlined, SearchOutlined, EditOutlined, MoreOutlined, DeleteOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { AppLayout } from './components/Layout/AppLayout';
import { type NavKey } from './stores/viewStore';
import { OpenRepoModal } from './components/Toolbar/OpenRepoModal';
import { CloneModal } from './components/Toolbar/CloneModal';
import { BranchModal } from './components/Toolbar/BranchModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useDebounce } from './hooks/useDebounce';

// 懒加载页面组件
const BranchPanel = lazy(() => import('./components/Layout/BranchPanel').then((m) => ({ default: m.BranchPanel })));
const PipelinePanel = lazy(() => import('./components/Pipeline/PipelinePanel').then((m) => ({ default: m.PipelinePanel })));
const HistoryView = lazy(() => import('./components/Graph/HistoryViewSourceTree').then((m) => ({ default: m.HistoryViewSourceTree })));
const SettingsPage = lazy(() => import('./components/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const HistoryViewDemo = lazy(() => import('./components/Graph/HistoryViewDemo').then((m) => ({ default: m.HistoryViewDemo })));
import { useRepoStore } from './stores/repoStore';
import { useSettingsStore } from './stores/settingsStore';
import { useRepoManagerStore } from './stores/repoManagerStore';
import { usePipelineStore } from './stores/pipelineStore';
import { useBranchTagStore } from './stores/branchTagStore';
import { useGitLabStore } from './stores/gitlabStore';
import { useViewStore } from './stores/viewStore';
import type { SavedRepo } from './stores/repoManagerStore';
import { useFileWatcher } from './hooks/useFileWatcher';
import { invoke } from '@tauri-apps/api/core';

const { Text } = Typography;

// ====== 仓库卡片 — memo 避免编辑别名时全部重渲染 ======
interface RepoCardProps {
  repo: SavedRepo;
  onSwitch: (repo: SavedRepo) => void;
  onRename: (repo: SavedRepo) => void;
  onRemove: (path: string) => void;
}

const RepoCard = memo(function RepoCard({
  repo, onSwitch, onRename, onRemove,
}: RepoCardProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div
      className="repo-card"
      role="button"
      tabIndex={0}
      style={{
        padding: 16, borderRadius: 8,
        border: '1px solid var(--ant-color-border-secondary, #303030)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
      onClick={() => { if (!popoverOpen) onSwitch(repo); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!popoverOpen) onSwitch(repo); } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <FolderOpenOutlined style={{ color: '#1677ff', fontSize: 20, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{repo.alias}</span>

        <Popover
          open={popoverOpen}
          onOpenChange={setPopoverOpen}
          trigger="click"
          placement="bottomRight"
          align={{ offset: [4, 4] }}
          arrow={false}
          overlayStyle={{ paddingTop: 4 }}
          overlayInnerStyle={{
            padding: '6px 0',
            borderRadius: 12,
            border: '1px solid var(--ant-color-border-secondary, #333)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            minWidth: 160,
            background: 'var(--ant-color-bg-elevated, #1f1f1f)',
          }}
          content={
            <div>
              <div
                className="popover-action"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPopoverOpen(false);
                  onRename(repo);
                }}
              >
                <EditOutlined />
                <span className="popover-action-label">修改别名</span>
              </div>
              <div style={{
                margin: '2px 12px', height: 1,
                background: 'var(--ant-color-border-secondary, #333)',
              }} />
              <div
                className="popover-action popover-action-danger"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(repo.path); }}
              >
                <DeleteOutlined />
                <span className="popover-action-label">从列表移除</span>
              </div>
            </div>
          }
        >
          <div
            className="repo-more-btn"
            style={{
              width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.1s', flexShrink: 0,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreOutlined style={{ fontSize: 16, color: '#999' }} />
          </div>
        </Popover>
      </div>

      <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {repo.path}
      </Text>
    </div>
  );
});

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const activeNav = useViewStore((s) => s.activeNav);
  const setActiveNav = useViewStore((s) => s.setActiveNav);
  const [openModalVisible, setOpenModalVisible] = useState(false);
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [branchModalVisible, setBranchModalVisible] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const debouncedRepoSearch = useDebounce(repoSearch, 300);
  const [renameTarget, setRenameTarget] = useState<SavedRepo | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Settings
  const initSettings = useSettingsStore((s) => s.init);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const appTheme = useSettingsStore((s) => s.settings.theme);

  // Repo store
  const repoPath = useRepoStore((s) => s.repoPath);
  const openRepo = useRepoStore((s) => s.openRepo);
  const closeRepo = useRepoStore((s) => s.closeRepo);
  const refreshStatus = useRepoStore((s) => s.refreshStatus);
  const refreshStatusSilent = useRepoStore((s) => s.refreshStatusSilent);
  const loadLog = useRepoStore((s) => s.loadLog);
  const error = useRepoStore((s) => s.error);
  const clearError = useRepoStore((s) => s.clearError);

  // Repo manager
  const savedRepos = useRepoManagerStore((s) => s.repos);
  const initRepoManager = useRepoManagerStore((s) => s.init);
  const addRepo = useRepoManagerStore((s) => s.addRepo);
  const updateAlias = useRepoManagerStore((s) => s.updateAlias);
  const removeRepo = useRepoManagerStore((s) => s.removeRepo);
  const setLastRepo = useRepoManagerStore((s) => s.setLastRepo);

  useEffect(() => {
    (async () => {
      await initSettings();
      // 初始化 GitLab 服务（settings 加载完成后）
      useGitLabStore.getState().init();
      // 并行初始化独立的 store
      await Promise.all([
        initRepoManager(),
        usePipelineStore.getState().init(),
        useBranchTagStore.getState().init(),
      ]);
      // 自动打开上次使用的仓库
      const lastPath = useRepoManagerStore.getState().lastRepoPath;
      if (lastPath) {
        try {
          const valid = await invoke<boolean>('validate_repo_path', { path: lastPath });
          if (valid) {
            await openRepo(lastPath);
            // 并行加载日志和切换流水线
            await Promise.all([
              loadLog(50),
              (async () => usePipelineStore.getState().switchRepo(lastPath))(),
            ]);
            // 异步选择 GitLab 项目（不阻塞 UI）
            const gitlabStore = useGitLabStore.getState();
            if (gitlabStore.service) {
              const repoName = lastPath.replace(/[/\\]$/, '').split(/[/\\]/).pop() || '';
              gitlabStore.searchProjects(repoName).then(() => {
                const matched = gitlabStore.projects.find((p) => p.path === repoName || p.name === repoName);
                if (matched) gitlabStore.selectProject(matched);
              }).catch(() => {});
            }
          } else {
            // 路径不存在，清除记录
            useRepoManagerStore.getState().clearLastRepo();
          }
        } catch (e) {
          console.warn('自动打开上次仓库失败:', e);
          message.warning('自动打开上次仓库失败');
          useRepoManagerStore.getState().clearLastRepo();
        }
      }
    })();
  }, []);
  useEffect(() => { setDarkMode(appTheme === 'dark'); }, [appTheme]);
  const handleRefreshSilent = useCallback(() => { refreshStatusSilent(); }, [refreshStatusSilent]);
  useFileWatcher(handleRefreshSilent, !!repoPath);
  useEffect(() => {
    if (error) { message.error(error); clearError(); }
  }, [error, clearError]);

  // 应用退出时停止 file watcher，释放 OS 资源
  useEffect(() => {
    return () => {
      invoke('stop_file_watcher').catch((e) => console.warn('停止文件监听失败:', e));
    };
  }, []);

  // ====== 仓库操作 ======
  const doOpenRepo = async (path: string, alias?: string, nav?: NavKey) => {
    await openRepo(path);
    await addRepo(path, alias);
    await setLastRepo(path);
    await loadLog(50);
    // 切换流水线到当前仓库（保留各仓库的任务）
    usePipelineStore.getState().switchRepo(path);
    // 自动标记默认分支
    const branches = useRepoStore.getState().repoInfo?.branches.map((b) => b.name) || [];
    await useBranchTagStore.getState().autoTag(path, branches);
    // 自动选择 GitLab 项目（根据仓库路径匹配）
    const gitlabStore = useGitLabStore.getState();
    if (gitlabStore.service) {
      const repoName = path.replace(/[/\\]$/, '').split(/[/\\]/).pop() || '';
      try {
        await gitlabStore.searchProjects(repoName);
        const projects = gitlabStore.projects;
        const matched = projects.find((p) => p.path === repoName || p.name === repoName);
        if (matched) {
          gitlabStore.selectProject(matched);
        }
      } catch (e) {
        console.error('autoSelectProject: error', e);
      }
    }
    if (nav) setActiveNav(nav);
  };

  const handleOpenRepo = async (path: string, alias?: string) => {
    setOpenModalVisible(false);
    await doOpenRepo(path, alias, 'workspace');
  };

  const handleSwitchRepo = async (repo: SavedRepo) => {
    // 同一个仓库：只切页面，不重载
    if (repo.path === repoPath) {
      setActiveNav('workspace');
      return;
    }
    await doOpenRepo(repo.path, repo.alias, 'workspace');
  };

  const handleCloneSuccess = async (path: string, alias?: string) => {
    await doOpenRepo(path, alias, 'workspace');
  };

  const handleRemoveRepo = async (path: string) => {
    // 如果正在打开这个仓库，先关闭工作区
    if (path === repoPath) {
      closeRepo();
      setActiveNav('repos');
    }
    await removeRepo(path);
  };

  const handleNavChange = (key: NavKey) => {
    setActiveNav(key);
    if (key === 'history') loadLog(50);
    if (key === 'branches') refreshStatus();
    if (key === 'workspace') {
      // 检测任务分支是否存在，清理已删除分支的任务
      usePipelineStore.getState().checkAndCleanTasks();
    }
  };

  // 重命名弹窗
  const handleRename = (repo: SavedRepo) => {
    setRenameTarget(repo);
    setRenameValue(repo.alias);
  };
  const confirmRename = async () => {
    if (renameTarget && renameValue.trim()) {
      await updateAlias(renameTarget.path, renameValue.trim());
    }
    setRenameTarget(null);
  };

  // 搜索过滤
  const filteredRepos = useMemo(() => {
    if (!debouncedRepoSearch.trim()) return savedRepos;
    const q = debouncedRepoSearch.toLowerCase();
    return savedRepos.filter(
      (r) => r.alias.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [savedRepos, debouncedRepoSearch]);

  if (settingsLoading) {
    return (
      <ConfigProvider
        theme={{ algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: 'var(--ant-color-bg-layout, #f5f5f5)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🦎</div>
            <div style={{ color: 'var(--ant-color-text-secondary, rgba(0,0,0,0.45))' }}>加载中...</div>
          </div>
        </div>
      </ConfigProvider>
    );
  }

  // ====== 渲染内容 ======
  const renderContent = () => {
    // ---------- 首页 ----------
    if (activeNav === 'home') {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '70vh', gap: 24, padding: 24,
        }}>
          <div style={{ fontSize: 64 }}>🦎</div>
          <h1 style={{ margin: 0, fontWeight: 600 }}>欢迎使用 Gitaur</h1>
          <p style={{ color: '#8c8c8c', maxWidth: 400, textAlign: 'center' }}>
            打开本地 Git 仓库开始工作，或克隆远程仓库到本地
          </p>
          <Space>
            <Button type="primary" size="large" icon={<FolderOpenOutlined />}
              onClick={() => setOpenModalVisible(true)}>打开仓库</Button>
            <Button size="large" icon={<PlusOutlined />}
              onClick={() => setCloneModalVisible(true)}>克隆仓库</Button>
          </Space>

          <OpenRepoModal
            open={openModalVisible}
            onClose={() => setOpenModalVisible(false)}
            onOpen={handleOpenRepo}
          />

          <CloneModal
            open={cloneModalVisible}
            onClose={() => setCloneModalVisible(false)}
            onSuccess={handleCloneSuccess}
          />
        </div>
      );
    }

    // ---------- 仓库管理 ----------
    if (activeNav === 'repos') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* 顶部操作区 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24,
            padding: '16px 20px', borderRadius: 12,
            background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
            border: '1px solid var(--ant-color-border-secondary, #303030)',
          }}>
            <Input
              size="large"
              placeholder="按别名搜索仓库..."
              prefix={<SearchOutlined style={{ color: '#999' }} />}
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              style={{ flex: 1, maxWidth: 420 }}
              allowClear
            />
            <div style={{
              fontSize: 13, color: 'var(--ant-color-text-tertiary, #999)',
              whiteSpace: 'nowrap', marginLeft: 'auto', marginRight: 4,
            }}>
              共 {savedRepos.length} 个仓库
            </div>
          </div>

          {filteredRepos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: '#999' }}>
              <FolderOpenOutlined style={{ fontSize: 56, marginBottom: 16, opacity: 0.2 }} />
              <div style={{ fontSize: 15 }}>
                {repoSearch ? '没有匹配的仓库' : '还没有添加仓库'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {filteredRepos.map((repo) => (
                <RepoCard
                  key={repo.path}
                  repo={repo}
                  onSwitch={handleSwitchRepo}
                  onRename={handleRename}
                  onRemove={handleRemoveRepo}
                />
              ))}
            </div>
          )}

          {/* 重命名别名弹窗 */}
          <Modal
            title="修改别名"
            open={!!renameTarget}
            onOk={confirmRename}
            onCancel={() => setRenameTarget(null)}
            okText="确定" cancelText="取消"
            centered
            width={400}
          >
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onPressEnter={confirmRename}
              placeholder="输入新别名"
              autoFocus
              style={{ marginTop: 8 }}
            />
          </Modal>
        </div>
      );
    }

    // ---------- 工作区 / 分支 / 历史 / 设置 ----------
    if (!repoPath) {
      return (
        <div style={{ textAlign: 'center', padding: 64, color: '#999' }}>
          请先在「首页」或「仓库」中打开一个项目
        </div>
      );
    }

    const PageSpinner = () => (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50%' }}>
        <Spin size="large" />
      </div>
    );

    switch (activeNav) {
      case 'workspace':
      case 'pipeline':
        return <Suspense fallback={<PageSpinner />}><PipelinePanel /></Suspense>;

      case 'branches':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>分支管理</h3>
              <Button type="primary" size="small" onClick={() => setBranchModalVisible(true)}>新建分支</Button>
            </div>
            <BranchModal open={branchModalVisible} onClose={() => setBranchModalVisible(false)} />
            <Suspense fallback={<PageSpinner />}><BranchPanel /></Suspense>
          </div>
        );

      case 'history':
        return <Suspense fallback={<PageSpinner />}><HistoryView /></Suspense>;

      case 'history-demo':
        return <Suspense fallback={<PageSpinner />}><HistoryViewDemo /></Suspense>;

      case 'settings':
        return <Suspense fallback={<PageSpinner />}><SettingsPage /></Suspense>;

      default:
        return null;
    }
  };

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 6 },
      }}
    >
      <ErrorBoundary>
        <AntApp>
          <AppLayout activeNav={activeNav} onNavChange={handleNavChange}>
            {renderContent()}
          </AppLayout>
        </AntApp>
      </ErrorBoundary>
    </ConfigProvider>
  );
}

export default App;
