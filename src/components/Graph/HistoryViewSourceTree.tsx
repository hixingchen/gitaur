import { useState, useMemo } from 'react';
import { Input, Select, Button, Space, Typography, Tooltip, Tag, Empty, Spin } from 'antd';
import { SearchOutlined, ReloadOutlined, VerticalAlignBottomOutlined, CopyOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { computeTopology } from '../../utils/topology';
import type { LaneCommit } from '../../utils/topology';
import { copyText } from '../../utils/clipboard';
import { useDebounce } from '../../hooks/useDebounce';
import { CommitDetailPanel } from './CommitDetailPanel';
import { SectionErrorBoundary } from '../SectionErrorBoundary';
import hs from './HistoryView.module.css';

const { Text } = Typography;

const PAGE_SIZE = 50;
const MAX_LOG_COUNT = 1000;

// 相对时间格式化
function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 30) return `${days}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function HistoryViewSourceTree() {
  const logEntries = useRepoStore((s) => s.logEntries);
  const logLoading = useRepoStore((s) => s.logLoading);
  const logBranch = useRepoStore((s) => s.logBranch);
  const loadLog = useRepoStore((s) => s.loadLog);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const selectedCommit = useRepoStore((s) => s.selectedCommit);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [count, setCount] = useState(PAGE_SIZE);

  // 本地分支列表
  const branchOptions = useMemo(() => {
    const locals = repoInfo?.branches.filter((b) => !b.name.startsWith('remotes/')) ?? [];
    return [
      { value: '__all__', label: '全部分支' },
      ...locals.map((b) => ({ value: b.name, label: b.name })),
    ];
  }, [repoInfo?.branches]);

  // 前端搜索过滤
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return logEntries;
    return logEntries.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q) ||
        e.hash.toLowerCase().includes(q),
    );
  }, [logEntries, debouncedSearch]);

  // 计算拓扑
  const { commits, maxLane } = useMemo(() => computeTopology(filtered), [filtered]);

  const handleBranchChange = (value: string) => {
    const branch = value === '__all__' ? null : value;
    setCount(PAGE_SIZE);
    loadLog(PAGE_SIZE, branch);
  };

  const handleLoadMore = () => {
    const next = Math.min(count + PAGE_SIZE, MAX_LOG_COUNT);
    setCount(next);
    loadLog(next, logBranch);
  };

  const handleRefresh = () => loadLog(count, logBranch);

  const reachedEnd = logEntries.length < count;

  // 高亮搜索文本
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <span key={i} className={hs.highlight}>
          {part}
        </span>
      ) : part
    );
  };

  // 渲染提交行
  const renderCommitRow = (commit: LaneCommit, index: number) => {
    const isSelected = selectedCommit === commit.hash;
    const query = debouncedSearch.trim();

    return (
      <div
        key={commit.hash}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedCommit(isSelected ? null : commit.hash)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCommit(isSelected ? null : commit.hash); } }}
        className={isSelected ? hs.commitRowSelected : hs.commitRow}
      >
        {/* 左侧：图形区域 */}
        <div className={hs.graphArea} style={{ width: (maxLane + 1) * 24 + 16 }}>
          {/* 绘制连接线 */}
          {Array.from({ length: maxLane }, (_, laneIdx) => {
            const laneCommits = commits.filter(c => c.lane === laneIdx);
            const isInLane = laneCommits.some(c => c.hash === commit.hash);
            if (!isInLane) return null;

            return (
              <div
                key={laneIdx}
                className={hs.laneLine}
                style={{ left: laneIdx * 24 + 8, background: commit.color }}
              />
            );
          })}

          {/* 提交点 */}
          <div
            className={commit.isBranchTip ? hs.commitDotTip : hs.commitDot}
            style={{
              left: commit.lane * 24 + 2,
              width: commit.isBranchTip ? 14 : 10,
              height: commit.isBranchTip ? 14 : 10,
              background: commit.isBranchTip ? commit.color : commit.isMerge ? '#666' : '#fff',
              border: `2px solid ${commit.color}`,
              '--dot-shadow': commit.isBranchTip ? `0 0 0 2px ${commit.color}40` : 'none',
            } as React.CSSProperties}
          />

          {/* 合并提交的第二个点 */}
          {commit.isMerge && (
            <div className={hs.commitDotInner} style={{ left: commit.lane * 24 + 6 }} />
          )}
        </div>

        {/* 右侧：提交信息 */}
        <div className={hs.commitInfo}>
          {/* 第一行：提交消息 */}
          <div className={hs.commitMessage}>
            {highlightText(commit.message.split('\n')[0], query)}
          </div>

          {/* 第二行：作者、时间、引用标签 */}
          <div className={hs.commitMeta}>
            <span>{highlightText(commit.author, query)}</span>
            <span>·</span>
            <span>{formatRelativeTime(commit.date)}</span>

            {/* 引用标签 */}
            {commit.refs.length > 0 && (
              <>
                <span>·</span>
                <Space size={4} wrap>
                  {commit.refs.map((ref, idx) => {
                    const isTag = ref.startsWith('tag: ');
                    const displayName = isTag ? ref.replace('tag: ', '') : ref.replace('origin/', 'o/');
                    return (
                      <Tag
                        key={idx}
                        style={{
                          margin: 0,
                          fontSize: 10,
                          lineHeight: '16px',
                          padding: '0 4px',
                          color: commit.color,
                          borderColor: `${commit.color}40`,
                          background: `${commit.color}10`,
                        }}
                      >
                        {displayName}
                      </Tag>
                    );
                  })}
                </Space>
              </>
            )}
          </div>

          {/* 第三行：Hash */}
          <div className={hs.commitHash}>
            <span>{highlightText(commit.hash.slice(0, 7), query)}</span>
            <Tooltip title="复制完整 hash">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                aria-label="复制完整 hash"
                onClick={(e) => {
                  e.stopPropagation();
                  copyText(commit.hash);
                }}
                style={{ color: '#8c8c8c', padding: 0, height: 16, width: 16 }}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={hs.root}>
      {/* 左侧：提交列表 */}
      <div className={hs.listPanel}>
        {/* 工具栏 */}
        <div className={hs.toolbar}>
          <Select
            size="small"
            value={logBranch ?? '__all__'}
            onChange={handleBranchChange}
            style={{ width: 180 }}
            options={branchOptions}
            showSearch
            optionFilterProp="label"
          />
          <Input
            size="small"
            allowClear
            placeholder="搜索提交 (消息/作者/hash)"
            prefix={<SearchOutlined style={{ color: '#999' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {search ? `${filtered.length} / ${logEntries.length} 条` : `${logEntries.length} 条`}
          </Text>
          <Space size={4} style={{ marginLeft: 'auto' }}>
            <Tooltip title="加载更多提交">
              <Button
                size="small"
                icon={<VerticalAlignBottomOutlined />}
                onClick={handleLoadMore}
                disabled={reachedEnd || logLoading || count >= MAX_LOG_COUNT}
                loading={logLoading}
              >
                更多
              </Button>
            </Tooltip>
            <Tooltip title="刷新">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
                loading={logLoading}
              />
            </Tooltip>
          </Space>
        </div>

        {/* 提交列表 */}
        <div className={hs.commitList}>
          {!repoInfo ? (
            <Empty description="未打开仓库" />
          ) : logLoading && logEntries.length === 0 ? (
            <div className={hs.emptyState}><Spin /></div>
          ) : commits.length === 0 ? (
            <Empty description={search ? '无匹配的提交' : '暂无提交记录'} />
          ) : (
            commits.map((commit, index) => renderCommitRow(commit, index))
          )}
        </div>
      </div>

      {/* 右侧：提交详情 */}
      {selectedCommit && (
        <div className={hs.detailPanel}>
          <SectionErrorBoundary fallbackTitle="提交详情加载失败">
            <CommitDetailPanel />
          </SectionErrorBoundary>
        </div>
      )}
    </div>
  );
}
