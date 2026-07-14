import { useState, useEffect, useRef } from 'react';
import {
  List, Tag, Button, Space, Empty, message,
  Typography, Input, Modal, Tooltip, Divider, Dropdown, Select, theme,
} from 'antd';
import {
  BranchesOutlined, PushpinOutlined, DeleteOutlined, SwapOutlined,
  CloudOutlined, EditOutlined, SearchOutlined, ArrowUpOutlined,
  ArrowDownOutlined, CheckCircleOutlined, MoreOutlined,
  DownloadOutlined, TagOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useRepoStore } from '../../stores/repoStore';
import { useBranchTagStore, TAG_CONFIG, type BranchTagType } from '../../stores/branchTagStore';
import type { Branch } from '../../types/git';

const { Text } = Typography;

function shortBranchName(name: string): string {
  return name.replace(/^remotes\/[^/]+\//, '');
}

export function BranchPanel({ compact }: { compact?: boolean }) {
  const { token } = theme.useToken();
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const repoPath = useRepoStore((s) => s.repoPath);
  const checkout = useRepoStore((s) => s.checkout);
  const push = useRepoStore((s) => s.push);
  const pull = useRepoStore((s) => s.pull);
  const refreshStatusSilent = useRepoStore((s) => s.refreshStatusSilent);
  const deleteBranch = useRepoStore((s) => s.deleteBranch);
  const renameBranch = useRepoStore((s) => s.renameBranch);

  // 快速刷新（只更新本地状态，不 fetch）
  const quickRefresh = async () => {
    await refreshStatusSilent();
  };

  // 完整刷新（fetch + 更新状态，用于需要远程信息的操作）
  const fullRefresh = async () => {
    if (repoPath) {
      await invoke('git_fetch', { repoPath });
    }
    await refreshStatusSilent();
  };

  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openDropdownBranch, setOpenDropdownBranch] = useState<string | null>(null);

  // 防抖：300ms 内多次输入只执行最后一次
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);
  const getTag = useBranchTagStore((s) => s.getTag);
  const setTag = useBranchTagStore((s) => s.setTag);
  const removeTag = useBranchTagStore((s) => s.removeTag);
  const getTagsForRepo = useBranchTagStore((s) => s.getTagsForRepo);

  const [renameTarget, setRenameTarget] = useState<Branch | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [trackTarget, setTrackTarget] = useState<Branch | null>(null);
  const [trackName, setTrackName] = useState('');
  const [trackPush, setTrackPush] = useState(false);
  const [tagTarget, setTagTarget] = useState<Branch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'local' | 'remote'; branch: Branch | null; branchName?: string } | null>(null);
  const [tagValue, setTagValue] = useState<BranchTagType | ''>('');
  const [forkTarget, setForkTarget] = useState<Branch | null>(null);
  const [forkName, setForkName] = useState('');
  const [forkLoading, setForkLoading] = useState(false);

  if (!repoInfo || !repoPath) {
    return <Empty description="未打开仓库" />;
  }

  const branches = repoInfo.branches;
  const currentBranch = branches.find((b) => b.isCurrent);
  const localBranches = branches.filter((b) => !b.name.startsWith('remotes/'));
  const remoteBranches = branches.filter((b) => b.name.startsWith('remotes/'));

  // 搜索
  const q = debouncedSearch.trim().toLowerCase();
  const filteredLocal = q
    ? localBranches.filter((b) => b.name.toLowerCase().includes(q))
    : localBranches;
  const filteredRemote = q
    ? remoteBranches.filter((b) => shortBranchName(b.name).toLowerCase().includes(q))
    : remoteBranches;

  // ====== 操作 ======
  const handleSwitchBranch = async (branch: Branch) => {
    if (branch.isCurrent) return;
    setOpenDropdownBranch(null);
    setSwitchingBranch(branch.name);
    try {
      await checkout(branch.name);
      await quickRefresh();
      message.success(`已切换到 "${branch.name}"`);
    } catch (e) {
      Modal.warning({
        title: '无法切换分支',
        content: String(e),
        centered: true,
      });
    } finally {
      setSwitchingBranch(null);
    }
  };

  const handlePush = async (branchName?: string) => {
    setOpenDropdownBranch(null);
    try {
      if (branchName && branches.find((b) => b.isCurrent)?.name !== branchName) {
        await checkout(branchName);
      }
      await push('origin');
      await quickRefresh();
      message.success('推送成功');
    } catch (e) {
      message.error(`推送失败: ${String(e)}`);
    }
  };

  const handlePull = async () => {
    try {
      await pull('origin');
      await fullRefresh();  // pull 后需要完整刷新获取远程更新
      message.success('拉取成功');
    } catch (e) {
      message.error(`拉取失败: ${String(e)}`);
    }
  };

  // 删除本地分支
  const handleDeleteLocal = async (force: boolean) => {
    if (!deleteTarget?.branch) return;
    setOpenDropdownBranch(null);
    try {
      await deleteBranch(deleteTarget.branch.name, force);
      await quickRefresh();
      message.success(`已删除 "${deleteTarget.branch.name}"`);
      setDeleteTarget(null);
    } catch (e) {
      const msg = String(e);
      if (!force && /not fully merged|not found|contains/i.test(msg)) {
        setDeleteTarget({ ...deleteTarget, type: 'local', branch: deleteTarget.branch, branchName: 'force' });
      } else {
        message.error(`删除失败: ${msg}`);
        setDeleteTarget(null);
      }
    }
  };

  // 删除远程分支（先关弹窗，后台执行）
  const handleDeleteRemote = async () => {
    if (!deleteTarget?.branchName || !repoPath) return;
    const branchName = deleteTarget.branchName;

    // 立即关闭弹窗和 Dropdown
    setDeleteTarget(null);
    setOpenDropdownBranch(null);
    message.loading({ content: `正在删除远程分支 "${branchName}"...`, key: 'deleteRemote' });

    try {
      await invoke('git_push', {
        repoPath,
        remote: 'origin',
        force: false,
        delete: true,
        branch: branchName,
      });
      await fullRefresh();
      message.success({ content: `已删除远程分支 "${branchName}"`, key: 'deleteRemote' });
    } catch (e) {
      message.error({ content: `删除失败: ${String(e)}`, key: 'deleteRemote' });
    }
  };

  const openRename = (branch: Branch) => {
    setRenameTarget(branch);
    setRenameValue(branch.name);
  };

  const confirmRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    if (renameValue.trim() === renameTarget.name) { setRenameTarget(null); return; }
    try {
      await renameBranch(renameTarget.name, renameValue.trim());
      message.success(`已重命名为 "${renameValue.trim()}"`);
    } catch (e) {
      message.error(`重命名失败: ${String(e)}`);
    } finally {
      setRenameTarget(null);
    }
  };

  const openTrack = (branch: Branch) => {
    setTrackTarget(branch);
    setTrackName(shortBranchName(branch.name));
  };

  const confirmTrack = async () => {
    if (!trackTarget || !trackName.trim()) return;
    setSwitchingBranch(trackName);
    try {
      await checkout(trackName.trim(), true, trackTarget.name.replace(/^remotes\//, ''));

      if (trackPush) {
        await push('origin');
        await fullRefresh();
        message.success(`已创建并推送到远程 "${trackName.trim()}"`);
      } else {
        message.success(`已创建并切换到 "${trackName.trim()}"`);
      }
    } catch (e) {
      Modal.warning({
        title: '无法创建分支',
        content: String(e),
        centered: true,
      });
    } finally {
      setSwitchingBranch(null);
      setTrackTarget(null);
    }
  };

  const openTag = (branch: Branch) => {
    setTagTarget(branch);
    const existing = getTag(repoPath, branch.name);
    setTagValue(existing || '');
  };

  const confirmTag = async () => {
    if (!tagTarget) return;

    // 检查是否是唯一性标签（主干分支、开发分支）
    const isUniqueTag = tagValue === 'mainline' || tagValue === 'integration';
    const existingBranch = isUniqueTag
      ? getTagsForRepo(repoPath).find((t) => t.tag === tagValue)?.branchName
      : null;

    // 如果已有其他分支标记了该标签，提示用户
    if (isUniqueTag && existingBranch && existingBranch !== tagTarget.name) {
      Modal.confirm({
        title: `修改${TAG_CONFIG[tagValue as BranchTagType].label}`,
        content: `当前 "${existingBranch}" 已标记为${TAG_CONFIG[tagValue as BranchTagType].label}，将改为 "${tagTarget.name}"。确定？`,
        okText: '确定',
        cancelText: '取消',
        centered: true,
        onOk: async () => {
          await setTag(repoPath, tagTarget.name, tagValue as BranchTagType);
          message.success(`已将 ${tagTarget.name} 标记为 ${TAG_CONFIG[tagValue as BranchTagType].label}`);
          setTagTarget(null);
        },
      });
      return;
    }

    if (tagValue) {
      await setTag(repoPath, tagTarget.name, tagValue as BranchTagType);
      message.success(`已标记为 ${TAG_CONFIG[tagValue as BranchTagType].label}`);
    } else {
      await removeTag(repoPath, tagTarget.name);
      message.success('已移除标签');
    }
    setTagTarget(null);
  };

  const openFork = (branch: Branch) => {
    setForkTarget(branch);
    setForkName('');
  };

  const confirmFork = async () => {
    if (!forkTarget || !forkName.trim()) return;

    setForkLoading(true);
    try {
      const sourceBranch = forkTarget.name.replace(/^remotes\//, '');

      // 1. 创建本地分支（基于远程源分支）
      await checkout(forkName.trim(), true, sourceBranch);

      // 2. 推送到远程
      await push('origin');

      // 3. 刷新
      await fullRefresh();

      message.success(`已从 ${shortBranchName(forkTarget.name)} 创建远程分支 "${forkName.trim()}"`);
    } catch (e) {
      Modal.warning({
        title: '无法创建分支',
        content: String(e),
        centered: true,
      });
    } finally {
      setForkLoading(false);
      setForkTarget(null);
    }
  };

  // ====== 渲染 ======
  const renderAheadBehind = (ahead: number, behind: number) => {
    if (ahead === 0 && behind === 0) return null;
    return (
      <Space size={4}>
        {ahead > 0 && (
          <Tooltip title={`领先上游 ${ahead} 个提交`}>
            <Tag color="orange" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              <ArrowUpOutlined /> {ahead}
            </Tag>
          </Tooltip>
        )}
        {behind > 0 && (
          <Tooltip title={`落后上游 ${behind} 个提交`}>
            <Tag color="red" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              <ArrowDownOutlined /> {behind}
            </Tag>
          </Tooltip>
        )}
      </Space>
    );
  };

  // 本地分支项
  const renderLocalItem = (branch: Branch) => {
    const branchTag = getTag(repoPath, branch.name);
    const tagConfig = branchTag ? TAG_CONFIG[branchTag] : null;

    const menuItems = [
      { key: 'switch', label: '切换', icon: <SwapOutlined /> },
      { key: 'rename', label: '重命名', icon: <EditOutlined /> },
      { key: 'tag', label: branchTag ? '修改标签' : '设置标签', icon: <TagOutlined /> },
      { key: 'push', label: '推送', icon: <PushpinOutlined /> },
      { type: 'divider' as const },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
    ];

    const isDropdownOpen = openDropdownBranch === branch.name;

    return (
      <List.Item
        style={{
          padding: '8px 10px', cursor: branch.isCurrent ? 'default' : 'pointer', borderRadius: 8,
          background: branch.isCurrent ? token.colorPrimaryBg : undefined,
          border: branch.isCurrent ? `1px solid ${token.colorPrimaryBorder}` : '1px solid transparent',
          marginBottom: 4, transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!branch.isCurrent) e.currentTarget.style.background = token.colorFillTertiary;
        }}
        onMouseLeave={(e) => {
          if (!branch.isCurrent) e.currentTarget.style.background = 'transparent';
        }}
        onClick={() => {
          if (openDropdownBranch !== branch.name) {
            handleSwitchBranch(branch);
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
          <BranchesOutlined style={{
            color: branch.isCurrent ? token.colorPrimary : token.colorTextSecondary,
            fontSize: 14,
          }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: branch.isCurrent ? 600 : 400,
              fontSize: 13, fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {branch.name}
              {tagConfig && (
                <Tag color={tagConfig.color} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                  {tagConfig.icon} {tagConfig.label}
                </Tag>
              )}
            </div>
            {branch.upstream && (
              <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                <CloudOutlined style={{ marginRight: 4 }} />
                {branch.upstream}
              </div>
            )}
          </div>

          <Space size={4}>
            {branch.isCurrent && (
              <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>当前</Tag>
            )}
            {renderAheadBehind(branch.ahead, branch.behind)}

            {!compact && (
              <Dropdown
                menu={{
                  items: menuItems.filter((item) => {
                    if (branch.isCurrent && item.key === 'switch') return false;
                    if (branch.isCurrent && item.key === 'delete') return false;
                    return true;
                  }),
                  onClick: ({ key }) => {
                    setOpenDropdownBranch(null);
                    if (key === 'switch') handleSwitchBranch(branch);
                    else if (key === 'rename') openRename(branch);
                    else if (key === 'tag') openTag(branch);
                    else if (key === 'push') handlePush(branch.name);
                    else if (key === 'delete') setDeleteTarget({ type: 'local', branch });
                  },
                }}
                trigger={['click']}
                onOpenChange={(open) => {
                  setOpenDropdownBranch(open ? branch.name : null);
                }}
                open={isDropdownOpen}
              >
                <Button
                  type="text" size="small" icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: token.colorTextSecondary }}
                />
              </Dropdown>
            )}
          </Space>
        </div>
      </List.Item>
    );
  };

  // 远程分支项
  const renderRemoteItem = (branch: Branch) => {
    const branchName = shortBranchName(branch.name);
    const branchTag = getTag(repoPath, branchName);
    const tagConfig = branchTag ? TAG_CONFIG[branchTag] : null;

    const menuItems = [
      { key: 'track', label: '创建本地分支', icon: <BranchesOutlined /> },
      { key: 'fork', label: '创建远程分支', icon: <BranchesOutlined /> },
      { type: 'divider' as const },
      { key: 'delete', label: '删除远程分支', icon: <DeleteOutlined />, danger: true },
    ];

    return (
      <List.Item
        className="branch-item"
        style={{
          padding: '6px 10px', borderRadius: 8, marginBottom: 4, cursor: 'default',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = token.colorFillTertiary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
          <CloudOutlined style={{ color: 'var(--ant-color-text-secondary, #8c8c8c)', fontSize: 13 }} />
          <span style={{
            flex: 1, fontSize: 12, fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {branchName}
            {tagConfig && (
              <Tag color={tagConfig.color} style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                {tagConfig.icon} {tagConfig.label}
              </Tag>
            )}
          </span>

          {!compact && (
            <Dropdown
              menu={{
                items: menuItems,
                onClick: ({ key }) => {
                  if (key === 'track') openTrack(branch);
                  else if (key === 'fork') openFork(branch);
                  else if (key === 'delete') setDeleteTarget({ type: 'remote', branch: null, branchName });
                },
              }}
              trigger={['click']}
            >
              <Button
                type="text" size="small" icon={<MoreOutlined />}
                onClick={(e) => e.stopPropagation()}
                style={{ color: token.colorTextSecondary }}
              />
            </Dropdown>
          )}
        </div>
      </List.Item>
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
          {/* 当前分支信息 */}
          <div style={{
            padding: '12px', marginBottom: 12,
            background: token.colorPrimaryBg,
            borderRadius: 8,
            border: `1px solid ${token.colorPrimaryBorder}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Space size={8}>
                <CheckCircleOutlined style={{ color: token.colorPrimary }} />
                <Text style={{ color: token.colorTextSecondary }}>当前分支：</Text>
                <Text strong style={{ fontFamily: 'monospace' }}>
                  {repoInfo.currentBranch || currentBranch?.name || '未检测到'}
                </Text>
                {(() => {
                  const branchName = repoInfo.currentBranch || currentBranch?.name;
                  if (!branchName) return null;
                  const tag = getTag(repoPath, branchName);
                  const config = tag ? TAG_CONFIG[tag] : null;
                  return config ? (
                    <Tag color={config.color} style={{ margin: 0, fontSize: 10 }}>{config.icon} {config.label}</Tag>
                  ) : null;
                })()}
              </Space>
              {renderAheadBehind(repoInfo.ahead, repoInfo.behind)}
            </div>
            {currentBranch?.upstream && (
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
                <CloudOutlined style={{ marginRight: 4 }} />
                跟踪: {currentBranch.upstream}
              </div>
            )}
            <Space size={6}>
              <Button size="small" icon={<DownloadOutlined />} onClick={handlePull}>拉取</Button>
              <Button size="small" icon={<PushpinOutlined />} type="primary"
                onClick={() => handlePush()} disabled={repoInfo.ahead === 0}>
                推送 {repoInfo.ahead > 0 ? `↑${repoInfo.ahead}` : ''}
              </Button>
            </Space>
          </div>

          {/* 搜索 + 刷新 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Input
              allowClear
              placeholder="搜索分支..."
              prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                borderRadius: 8,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={async () => {
                if (repoPath) {
                  await invoke('git_fetch', { repoPath });
                  await fullRefresh();
                  message.success('已刷新远程分支');
                }
              }}
            >
              刷新
            </Button>
          </div>

          {/* 本地分支 */}
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{
              fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 8, padding: '0 4px',
            }}>
              本地分支 ({filteredLocal.length}{q && `/${localBranches.length}`})
            </Text>
            <List
              dataSource={filteredLocal}
              renderItem={renderLocalItem}
              split={false} size="small"
              locale={{ emptyText: q ? '无匹配' : '暂无本地分支' }}
            />
          </div>

          {/* 远程分支 */}
          {remoteBranches.length > 0 && (
            <>
              <Divider style={{ margin: '8px 0 16px' }} />
              <div>
                <Text type="secondary" style={{
                  fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 8, padding: '0 4px',
                }}>
                  远程分支 ({filteredRemote.length}{q && `/${remoteBranches.length}`})
                </Text>
                <List
                  dataSource={filteredRemote}
                  renderItem={renderRemoteItem}
                  split={false} size="small"
                  locale={{ emptyText: q ? '无匹配' : '暂无远程分支' }}
                />
              </div>
            </>
          )}
        </div>

      {/* 重命名弹窗 */}
      <Modal
        title="重命名分支"
        open={!!renameTarget}
        onOk={confirmRename}
        onCancel={() => setRenameTarget(null)}
        okText="确定" cancelText="取消"
        centered width={400}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={confirmRename}
          autoFocus style={{ marginTop: 8 }}
        />
      </Modal>

      {/* 从远程创建本地分支弹窗 */}
      <Modal
        title="创建本地分支"
        open={!!trackTarget}
        onOk={confirmTrack}
        onCancel={() => setTrackTarget(null)}
        okText={trackPush ? "创建并推送" : "创建并切换"}
        cancelText="取消"
        confirmLoading={switchingBranch !== null}
        centered width={440}
      >
        {trackTarget && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text type="secondary">基于远程分支：</Text>
            <Tag icon={<CloudOutlined />} style={{ margin: 0 }}>{shortBranchName(trackTarget.name)}</Tag>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>本地分支名称</Text>
        <Input
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          onPressEnter={confirmTrack}
          autoFocus
        />
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={trackPush}
              onChange={(e) => setTrackPush(e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>推送到远程</span>
          </label>
        </div>
      </Modal>

      {/* 设置标签弹窗 */}
      <Modal
        title="设置分支标签"
        open={!!tagTarget}
        onOk={confirmTag}
        onCancel={() => setTagTarget(null)}
        okText="确定" cancelText="取消"
        centered width={400}
      >
        {tagTarget && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text type="secondary">分支：</Text>
            <Tag style={{ margin: 0 }}>{tagTarget.name}</Tag>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          选择标签（标识分支用途）
        </Text>
        <Select
          value={tagValue || undefined}
          onChange={(value) => setTagValue(value as BranchTagType)}
          placeholder="请选择标签"
          style={{ width: '100%' }}
          options={Object.entries(TAG_CONFIG).map(([key, config]) => ({
            value: key,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{config.icon}</span>
                <span>{config.label}</span>
              </div>
            ),
          }))}
        />
        <div style={{ marginTop: 12, fontSize: 12, color: token.colorTextTertiary }}>
          <div>🔗 开发分支：feature 分支合并的目标（通常是 develop）</div>
          <div>🏗️ 主干分支：线上代码（通常是 master/main）</div>
          <div>🚀 任务分支：当前正在开发的 feature 分支</div>
          <div>📦 发布分支：release/x.x.x</div>
          <div>🔧 热修复分支：hotfix/xxx</div>
        </div>
      </Modal>

      {/* 创建远程分支弹窗 */}
      <Modal
        title="创建远程分支"
        open={!!forkTarget}
        onOk={confirmFork}
        onCancel={() => setForkTarget(null)}
        okText="创建" cancelText="取消"
        confirmLoading={forkLoading}
        centered width={440}
      >
        {forkTarget && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text type="secondary">基于远程分支：</Text>
            <Tag icon={<CloudOutlined />} style={{ margin: 0 }}>{shortBranchName(forkTarget.name)}</Tag>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          新分支名称（将同时创建本地和远程分支）
        </Text>
        <Input
          value={forkName}
          onChange={(e) => setForkName(e.target.value)}
          onPressEnter={confirmFork}
          placeholder="release/v1.0"
          autoFocus
        />
      </Modal>

      {/* 删除分支确认弹窗 */}
      <Modal
        title={deleteTarget?.type === 'remote' ? '删除远程分支' : deleteTarget?.branchName === 'force' ? '分支未合并' : '删除本地分支'}
        open={!!deleteTarget}
        onOk={() => {
          if (deleteTarget?.type === 'remote') handleDeleteRemote();
          else handleDeleteLocal(deleteTarget?.branchName === 'force');
        }}
        onCancel={() => setDeleteTarget(null)}
        okText={deleteTarget?.branchName === 'force' ? '强制删除' : '删除'}
        okButtonProps={{ danger: true }}
        cancelText="取消"
        centered
      >
        {deleteTarget && (
          <div>
            {deleteTarget.type === 'remote' ? (
              <div>
                <p>确定删除远程分支 <strong>{deleteTarget.branchName}</strong>？</p>
                <p style={{ color: '#faad14', fontSize: 12 }}>⚠️ 此操作会影响所有团队成员，且不可撤销</p>
              </div>
            ) : deleteTarget.branchName === 'force' ? (
              <p>分支 "{deleteTarget.branch?.name}" 含未合并提交，强制删除将丢失这些提交。确定？</p>
            ) : (
              <p>确定删除分支 <strong>{deleteTarget.branch?.name}</strong>？</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
