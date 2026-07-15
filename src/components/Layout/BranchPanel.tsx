import { useState } from 'react';
import {
  List, Tag, Button, Space, Empty, message,
  Typography, Input, Modal, Divider, Select, theme,
} from 'antd';
import {
  CheckCircleOutlined, CloudOutlined, SearchOutlined,
  DownloadOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useRepoStore } from '../../stores/repoStore';
import { useBranchTagStore, TAG_CONFIG, type BranchTagType } from '../../stores/branchTagStore';
import { useDebounce } from '../../hooks/useDebounce';
import { LocalBranchItem, RemoteBranchItem, shortBranchName, renderAheadBehind } from './BranchItem';
import type { Branch } from '../../types/git';

const { Text } = Typography;

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

  const quickRefresh = async () => { await refreshStatusSilent(); };
  const fullRefresh = async () => {
    if (repoPath) await invoke('git_fetch', { repoPath });
    await refreshStatusSilent();
  };

  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [openDropdownBranch, setOpenDropdownBranch] = useState<string | null>(null);

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

  if (!repoInfo || !repoPath) return <Empty description="未打开仓库" />;

  const branches = repoInfo.branches;
  const currentBranch = branches.find((b) => b.isCurrent);
  const localBranches = branches.filter((b) => !b.name.startsWith('remotes/'));
  const remoteBranches = branches.filter((b) => b.name.startsWith('remotes/'));

  const q = debouncedSearch.trim().toLowerCase();
  const filteredLocal = q ? localBranches.filter((b) => b.name.toLowerCase().includes(q)) : localBranches;
  const filteredRemote = q ? remoteBranches.filter((b) => shortBranchName(b.name).toLowerCase().includes(q)) : remoteBranches;

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
      Modal.warning({ title: '无法切换分支', content: String(e), centered: true });
    } finally {
      setSwitchingBranch(null);
    }
  };

  const handlePush = async () => {
    setOpenDropdownBranch(null);
    try {
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
      await fullRefresh();
      message.success('拉取成功');
    } catch (e) {
      message.error(`拉取失败: ${String(e)}`);
    }
  };

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

  const handleDeleteRemote = async () => {
    if (!deleteTarget?.branchName || !repoPath) return;
    const branchName = deleteTarget.branchName;
    setDeleteTarget(null);
    setOpenDropdownBranch(null);
    message.loading({ content: `正在删除远程分支 "${branchName}"...`, key: 'deleteRemote' });
    try {
      await invoke('git_push', { repoPath, remote: 'origin', force: false, delete: true, branch: branchName });
      await fullRefresh();
      message.success({ content: `已删除远程分支 "${branchName}"`, key: 'deleteRemote' });
    } catch (e) {
      message.error({ content: `删除失败: ${String(e)}`, key: 'deleteRemote' });
    }
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
      Modal.warning({ title: '无法创建分支', content: String(e), centered: true });
    } finally {
      setSwitchingBranch(null);
      setTrackTarget(null);
    }
  };

  const confirmTag = async () => {
    if (!tagTarget) return;
    const isUniqueTag = tagValue === 'mainline' || tagValue === 'integration';
    const existingBranch = isUniqueTag ? getTagsForRepo(repoPath).find((t) => t.tag === tagValue)?.branchName : null;

    if (isUniqueTag && existingBranch && existingBranch !== tagTarget.name) {
      Modal.confirm({
        title: `修改${TAG_CONFIG[tagValue as BranchTagType].label}`,
        content: `当前 "${existingBranch}" 已标记为${TAG_CONFIG[tagValue as BranchTagType].label}，将改为 "${tagTarget.name}"。确定？`,
        okText: '确定', cancelText: '取消', centered: true,
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

  const confirmFork = async () => {
    if (!forkTarget || !forkName.trim()) return;
    setForkLoading(true);
    try {
      const sourceBranch = forkTarget.name.replace(/^remotes\//, '');
      await checkout(forkName.trim(), true, sourceBranch);
      await push('origin');
      await fullRefresh();
      message.success(`已从 ${shortBranchName(forkTarget.name)} 创建远程分支 "${forkName.trim()}"`);
    } catch (e) {
      Modal.warning({ title: '无法创建分支', content: String(e), centered: true });
    } finally {
      setForkLoading(false);
      setForkTarget(null);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{
          padding: '12px', marginBottom: 12,
          background: token.colorPrimaryBg, borderRadius: 8,
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
                const config = tag ? TAG_CONFIG[tag as BranchTagType] : null;
                return config ? (
                  <Tag color={config.color} style={{ margin: 0, fontSize: 10 }}>{config.icon} {config.label}</Tag>
                ) : null;
              })()}
            </Space>
            {renderAheadBehind(repoInfo.ahead, repoInfo.behind)}
          </div>
          {currentBranch?.upstream && (
            <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
              <CloudOutlined style={{ marginRight: 4 }} />跟踪: {currentBranch.upstream}
            </div>
          )}
          <Space size={6}>
            <Button size="small" icon={<DownloadOutlined />} onClick={handlePull}>拉取</Button>
            <Button size="small" icon={<CheckCircleOutlined />} type="primary"
              onClick={handlePush} disabled={repoInfo.ahead === 0}>
              推送 {repoInfo.ahead > 0 ? `↑${repoInfo.ahead}` : ''}
            </Button>
          </Space>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            allowClear placeholder="搜索分支..."
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, borderRadius: 8, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}` }}
          />
          <Button icon={<ReloadOutlined />} onClick={async () => {
            if (repoPath) { await invoke('git_fetch', { repoPath }); await fullRefresh(); message.success('已刷新远程分支'); }
          }}>刷新</Button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 8, padding: '0 4px' }}>
            本地分支 ({filteredLocal.length}{q && `/${localBranches.length}`})
          </Text>
          <List
            dataSource={filteredLocal}
            renderItem={(branch) => (
              <LocalBranchItem
                branch={branch}
                branchTag={getTag(repoPath, branch.name)}
                isCurrent={branch.isCurrent}
                compact={compact}
                isDropdownOpen={openDropdownBranch === branch.name}
                onSwitch={() => handleSwitchBranch(branch)}
                onRename={() => { setRenameTarget(branch); setRenameValue(branch.name); }}
                onTag={() => { setTagTarget(branch); setTagValue(getTag(repoPath, branch.name) || ''); }}
                onPush={handlePush}
                onDelete={() => setDeleteTarget({ type: 'local', branch })}
                onDropdownChange={(open) => setOpenDropdownBranch(open ? branch.name : null)}
              />
            )}
            split={false} size="small"
            locale={{ emptyText: q ? '无匹配' : '暂无本地分支' }}
          />
        </div>

        {remoteBranches.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0 16px' }} />
            <div>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 8, padding: '0 4px' }}>
                远程分支 ({filteredRemote.length}{q && `/${remoteBranches.length}`})
              </Text>
              <List
                dataSource={filteredRemote}
                renderItem={(branch) => {
                  const branchName = shortBranchName(branch.name);
                  return (
                    <RemoteBranchItem
                      branch={branch}
                      branchTag={getTag(repoPath, branchName)}
                      compact={compact}
                      onTrack={() => { setTrackTarget(branch); setTrackName(branchName); }}
                      onFork={() => { setForkTarget(branch); setForkName(''); }}
                      onDelete={() => setDeleteTarget({ type: 'remote', branch: null, branchName })}
                    />
                  );
                }}
                split={false} size="small"
                locale={{ emptyText: q ? '无匹配' : '暂无远程分支' }}
              />
            </div>
          </>
        )}
      </div>

      {/* 重命名弹窗 */}
      <Modal title="重命名分支" open={!!renameTarget} onOk={confirmRename} onCancel={() => setRenameTarget(null)}
        okText="确定" cancelText="取消" centered width={400}>
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onPressEnter={confirmRename} autoFocus style={{ marginTop: 8 }} />
      </Modal>

      {/* 从远程创建本地分支弹窗 */}
      <Modal title="创建本地分支" open={!!trackTarget} onOk={confirmTrack} onCancel={() => setTrackTarget(null)}
        okText={trackPush ? "创建并推送" : "创建并切换"} cancelText="取消" confirmLoading={switchingBranch !== null} centered width={440}>
        {trackTarget && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text type="secondary">基于远程分支：</Text>
            <Tag icon={<CloudOutlined />} style={{ margin: 0 }}>{shortBranchName(trackTarget.name)}</Tag>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>本地分支名称</Text>
        <Input value={trackName} onChange={(e) => setTrackName(e.target.value)} onPressEnter={confirmTrack} autoFocus />
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={trackPush} onChange={(e) => setTrackPush(e.target.checked)} />
            <span style={{ fontSize: 13 }}>推送到远程</span>
          </label>
        </div>
      </Modal>

      {/* 设置标签弹窗 */}
      <Modal title="设置分支标签" open={!!tagTarget} onOk={confirmTag} onCancel={() => setTagTarget(null)}
        okText="确定" cancelText="取消" centered width={400}>
        {tagTarget && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text type="secondary">分支：</Text>
            <Tag style={{ margin: 0 }}>{tagTarget.name}</Tag>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>选择标签（标识分支用途）</Text>
        <Select value={tagValue || undefined} onChange={(v) => setTagValue(v as BranchTagType)} placeholder="请选择标签" style={{ width: '100%' }}
          options={Object.entries(TAG_CONFIG).map(([key, config]) => ({
            value: key,
            label: <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>{config.icon}</span><span>{config.label}</span></div>,
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
      <Modal title="创建远程分支" open={!!forkTarget} onOk={confirmFork} onCancel={() => setForkTarget(null)}
        okText="创建" cancelText="取消" confirmLoading={forkLoading} centered width={440}>
        {forkTarget && (
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Text type="secondary">基于远程分支：</Text>
            <Tag icon={<CloudOutlined />} style={{ margin: 0 }}>{shortBranchName(forkTarget.name)}</Tag>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>新分支名称（将同时创建本地和远程分支）</Text>
        <Input value={forkName} onChange={(e) => setForkName(e.target.value)} onPressEnter={confirmFork} placeholder="release/v1.0" autoFocus />
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
