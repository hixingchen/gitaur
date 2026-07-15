import { Tag, Button, Space, Dropdown, Tooltip, Typography, theme } from 'antd';
import {
  BranchesOutlined, PushpinOutlined, DeleteOutlined, SwapOutlined,
  CloudOutlined, EditOutlined, ArrowUpOutlined, ArrowDownOutlined,
  MoreOutlined, TagOutlined,
} from '@ant-design/icons';
import { TAG_CONFIG, type BranchTagType } from '../../stores/branchTagStore';
import type { Branch } from '../../types/git';
import s from './BranchPanel.module.css';

const { Text } = Typography;

export function shortBranchName(name: string): string {
  return name.replace(/^remotes\/[^/]+\//, '');
}

export function renderAheadBehind(ahead: number, behind: number) {
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
}

interface LocalBranchItemProps {
  branch: Branch;
  branchTag: string | null;
  isCurrent: boolean;
  compact?: boolean;
  isDropdownOpen: boolean;
  onSwitch: () => void;
  onRename: () => void;
  onTag: () => void;
  onPush: () => void;
  onDelete: () => void;
  onDropdownChange: (open: boolean) => void;
}

export function LocalBranchItem({
  branch, branchTag, isCurrent, compact, isDropdownOpen,
  onSwitch, onRename, onTag, onPush, onDelete, onDropdownChange,
}: LocalBranchItemProps) {
  const { token } = theme.useToken();
  const tagConfig = branchTag ? TAG_CONFIG[branchTag as BranchTagType] : null;

  const menuItems = [
    { key: 'switch', label: '切换', icon: <SwapOutlined /> },
    { key: 'rename', label: '重命名', icon: <EditOutlined /> },
    { key: 'tag', label: branchTag ? '修改标签' : '设置标签', icon: <TagOutlined /> },
    { key: 'push', label: '推送', icon: <PushpinOutlined /> },
    { type: 'divider' as const },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
  ];

  const rowStyle = isCurrent
    ? { background: token.colorPrimaryBg, border: `1px solid ${token.colorPrimaryBorder}` }
    : undefined;

  return (
    <div
      className={s.branchRow}
      style={rowStyle}
      onClick={() => { if (!isDropdownOpen) onSwitch(); }}
    >
      <div className={s.flexRow}>
        <BranchesOutlined style={{ color: isCurrent ? token.colorPrimary : token.colorTextSecondary, fontSize: 14 }} />
        <div className={s.branchName}>
          <div className={isCurrent ? s.branchNameTextCurrent : s.branchNameText}>
            {branch.name}
            {tagConfig && (
              <Tag color={tagConfig.color} className={s.tagSm}>
                {tagConfig.icon} {tagConfig.label}
              </Tag>
            )}
          </div>
          {branch.upstream && (
            <div className={s.upstreamText} style={{ color: token.colorTextTertiary }}>
              <CloudOutlined style={{ marginRight: 4 }} />
              {branch.upstream}
            </div>
          )}
        </div>
        <Space size={4}>
          {isCurrent && (
            <Tag color="blue" className={s.tagSm}>当前</Tag>
          )}
          {renderAheadBehind(branch.ahead, branch.behind)}
          {!compact && (
            <Dropdown
              menu={{
                items: menuItems.filter((item) => {
                  if (isCurrent && item.key === 'switch') return false;
                  if (isCurrent && item.key === 'delete') return false;
                  return true;
                }),
                onClick: ({ key }) => {
                  onDropdownChange(false);
                  if (key === 'switch') onSwitch();
                  else if (key === 'rename') onRename();
                  else if (key === 'tag') onTag();
                  else if (key === 'push') onPush();
                  else if (key === 'delete') onDelete();
                },
              }}
              trigger={['click']}
              onOpenChange={(open) => onDropdownChange(open)}
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
    </div>
  );
}

interface RemoteBranchItemProps {
  branch: Branch;
  branchTag: string | null;
  compact?: boolean;
  onTrack: () => void;
  onFork: () => void;
  onDelete: () => void;
}

export function RemoteBranchItem({
  branch, branchTag, compact, onTrack, onFork, onDelete,
}: RemoteBranchItemProps) {
  const { token } = theme.useToken();
  const branchName = shortBranchName(branch.name);
  const tagConfig = branchTag ? TAG_CONFIG[branchTag as BranchTagType] : null;

  const menuItems = [
    { key: 'track', label: '创建本地分支', icon: <BranchesOutlined /> },
    { key: 'fork', label: '创建远程分支', icon: <BranchesOutlined /> },
    { type: 'divider' as const },
    { key: 'delete', label: '删除远程分支', icon: <DeleteOutlined />, danger: true },
  ];

  return (
    <div className={s.remoteBranchRow}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
        <CloudOutlined style={{ color: token.colorTextSecondary, fontSize: 13 }} />
        <span className={s.remoteBranchName}>
          {branchName}
          {tagConfig && (
            <Tag color={tagConfig.color} className={s.tagSm}>
              {tagConfig.icon} {tagConfig.label}
            </Tag>
          )}
        </span>
        {!compact && (
          <Dropdown
            menu={{
              items: menuItems,
              onClick: ({ key }) => {
                if (key === 'track') onTrack();
                else if (key === 'fork') onFork();
                else if (key === 'delete') onDelete();
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
    </div>
  );
}
