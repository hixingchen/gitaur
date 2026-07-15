import { useState, useMemo, useRef, useEffect } from 'react';
import { Input, Select, Button, Typography, Tooltip, Spin, Empty } from 'antd';
import { SearchOutlined, ReloadOutlined, CopyOutlined, DownOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { computeTopology, BRANCH_COLORS } from '../../utils/topology';
import type { LaneCommit } from '../../utils/topology';
import { copyText } from '../../utils/clipboard';
import { useDebounce } from '../../hooks/useDebounce';
import { CommitDetailPanel } from './CommitDetailPanel';
import { SectionErrorBoundary } from '../SectionErrorBoundary';
import s from './HistoryView.module.css';

const { Text } = Typography;

const PAGE_SIZE = 50;
const MAX_LOG_COUNT = 1000;
const ROW_H = 48;
const LANE_W = 20;
const DOT_R = 5;

// ====== 相对时间 ======
function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const min = Math.floor(diff / 60000);
    const hr = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    if (hr < 24) return `${hr}小时前`;
    if (day < 30) return `${day}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ====== SVG 图形组件 ======
function CommitGraph({ commit, maxLane, commits }: { commit: LaneCommit; maxLane: number; commits: LaneCommit[] }) {
  const width = (maxLane + 1) * LANE_W + 16;
  const cx = commit.lane * LANE_W + 10;
  const cy = ROW_H / 2;

  // 找到父提交的位置
  const hashIndex = new Map(commits.map((c, i) => [c.hash, i]));
  const hashLane = new Map(commits.map(c => [c.hash, c.lane]));
  const currentIdx = commits.indexOf(commit);

  return (
    <svg width={width} height={ROW_H} style={{ display: 'block' }}>
      {/* 垂直贯穿线 — 所有 lane */}
      {Array.from({ length: maxLane + 1 }, (_, i) => {
        // 检查这个 lane 在当前行附近是否有提交
        const hasCommitNearby = commits.some((c, idx) =>
          c.lane === i && Math.abs(idx - currentIdx) <= 1
        );
        if (!hasCommitNearby) return null;
        return (
          <line
            key={`lane-${i}`}
            x1={i * LANE_W + 10} y1={0}
            x2={i * LANE_W + 10} y2={ROW_H}
            stroke={BRANCH_COLORS[i % BRANCH_COLORS.length]}
            strokeWidth={2}
            opacity={0.3}
          />
        );
      })}

      {/* 到父提交的连线 */}
      {commit.parents.map(pHash => {
        const pIdx = hashIndex.get(pHash);
        const pLane = hashLane.get(pHash);
        if (pIdx === undefined || pLane === undefined) return null;
        if (pIdx <= currentIdx) return null; // 只画向下的线

        const px = pLane * LANE_W + 10;
        const color = BRANCH_COLORS[pLane % BRANCH_COLORS.length];

        if (commit.lane === pLane) {
          // 同 lane 直线
          return (
            <line key={pHash} x1={cx} y1={cy} x2={px} y2={ROW_H}
              stroke={color} strokeWidth={2} />
          );
        }
        // 不同 lane 曲线
        return (
          <path key={pHash}
            d={`M ${cx} ${cy} C ${cx} ${cy + 16}, ${px} ${ROW_H - 16}, ${px} ${ROW_H}`}
            fill="none" stroke={color} strokeWidth={2}
          />
        );
      })}

      {/* 提交圆点 */}
      <circle
        cx={cx} cy={cy}
        r={commit.isBranchTip ? DOT_R + 1.5 : DOT_R}
        fill={commit.isBranchTip ? commit.color : '#fff'}
        stroke={commit.color}
        strokeWidth={2}
      />
      {/* 合并提交内点 */}
      {commit.isMerge && (
        <circle cx={cx} cy={cy} r={2.5} fill="#fff" />
      )}
    </svg>
  );
}

// ====== 提交行组件 ======
function CommitRow({
  commit, index, isSelected, query, maxLane, commits, onSelect,
}: {
  commit: LaneCommit; index: number; isSelected: boolean; query: string;
  maxLane: number; commits: LaneCommit[]; onSelect: () => void;
}) {
  const highlightText = (text: string) => {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.split(regex).map((part, i) =>
      regex.test(part) ? <span key={i} className={s.highlight}>{part}</span> : part
    );
  };

  const graphWidth = (maxLane + 1) * LANE_W + 16;

  return (
    <div
      className={isSelected ? s.commitRowSelected : s.commitRow}
      role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      {/* 图形 */}
      <div className={s.graphCell} style={{ width: graphWidth }}>
        <CommitGraph commit={commit} maxLane={maxLane} commits={commits} />
      </div>

      {/* 提交信息 */}
      <div className={s.commitBody}>
        {/* 消息 + 标签 */}
        <div className={s.commitMsgRow}>
          <span className={s.commitMsg}>{highlightText(commit.message.split('\n')[0])}</span>
          <div className={s.refTags}>
            {commit.refs.map((ref, idx) => {
              const isTag = ref.startsWith('tag: ');
              const name = isTag ? ref.replace('tag: ', '') : ref.replace('origin/', 'o/');
              const color = isTag ? '#faad14' : commit.color;
              return (
                <span key={idx} className={s.refTag}
                  style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>
                  {name}
                </span>
              );
            })}
          </div>
        </div>

        {/* 作者 + 时间 + hash */}
        <div className={s.commitMeta}>
          <span className={s.commitAuthor}>{highlightText(commit.author)}</span>
          <span className={s.commitDot} />
          <span>{formatRelativeTime(commit.date)}</span>
          <span className={s.commitDot} />
          <span className={s.commitHash}>{highlightText(commit.hash.slice(0, 7))}</span>
          <Tooltip title="复制完整 hash">
            <Button type="text" size="small" className={s.copyBtn}
              icon={<CopyOutlined />}
              onClick={(e) => { e.stopPropagation(); copyText(commit.hash); }}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

// ====== 主组件 ======
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
  const listRef = useRef<HTMLDivElement>(null);

  const branchOptions = useMemo(() => {
    const locals = repoInfo?.branches.filter((b) => !b.name.startsWith('remotes/')) ?? [];
    return [
      { value: '__all__', label: '全部分支' },
      ...locals.map((b) => ({ value: b.name, label: b.name })),
    ];
  }, [repoInfo?.branches]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return logEntries;
    return logEntries.filter((e) =>
      e.message.toLowerCase().includes(q) ||
      e.author.toLowerCase().includes(q) ||
      e.hash.toLowerCase().includes(q)
    );
  }, [logEntries, debouncedSearch]);

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

  const reachedEnd = logEntries.length < count;

  // 选中时滚动到可视区域
  useEffect(() => {
    if (!selectedCommit || !listRef.current) return;
    const idx = commits.findIndex(c => c.hash === selectedCommit);
    if (idx < 0) return;
    const rowTop = idx * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const { scrollTop, clientHeight } = listRef.current;
    if (rowTop < scrollTop) {
      listRef.current.scrollTop = rowTop;
    } else if (rowBottom > scrollTop + clientHeight) {
      listRef.current.scrollTop = rowBottom - clientHeight;
    }
  }, [selectedCommit, commits]);

  return (
    <div className={s.root}>
      {/* 左侧：提交列表 */}
      <div className={s.listPanel}>
        {/* 工具栏 */}
        <div className={s.toolbar}>
          <Select
            size="small"
            value={logBranch ?? '__all__'}
            onChange={handleBranchChange}
            style={{ width: 160 }}
            options={branchOptions}
            showSearch
            optionFilterProp="label"
            variant="borderless"
          />
          <Input
            size="small"
            allowClear
            placeholder="搜索..."
            prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 12 }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 200 }}
            variant="borderless"
          />
          <span className={s.toolbarCount}>
            {search ? `${filtered.length}/${logEntries.length}` : `${logEntries.length}`}
          </span>
          <Tooltip title="加载更多">
            <Button size="small" type="text" icon={<DownOutlined />}
              onClick={handleLoadMore}
              disabled={reachedEnd || logLoading || count >= MAX_LOG_COUNT}
              loading={logLoading}
            />
          </Tooltip>
          <Tooltip title="刷新">
            <Button size="small" type="text" icon={<ReloadOutlined />}
              onClick={() => loadLog(count, logBranch)}
              loading={logLoading}
            />
          </Tooltip>
        </div>

        {/* 提交列表 */}
        <div className={s.commitList} ref={listRef}>
          {!repoInfo ? (
            <Empty description="未打开仓库" style={{ marginTop: 80 }} />
          ) : logLoading && logEntries.length === 0 ? (
            <div className={s.emptyState}><Spin /></div>
          ) : commits.length === 0 ? (
            <Empty description={search ? '无匹配' : '暂无提交'} style={{ marginTop: 80 }} />
          ) : (
            commits.map((commit, index) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                index={index}
                isSelected={selectedCommit === commit.hash}
                query={debouncedSearch.trim().toLowerCase()}
                maxLane={maxLane}
                commits={commits}
                onSelect={() => setSelectedCommit(selectedCommit === commit.hash ? null : commit.hash)}
              />
            ))
          )}
        </div>
      </div>

      {/* 右侧：提交详情 */}
      {selectedCommit && (
        <div className={s.detailPanel}>
          <SectionErrorBoundary fallbackTitle="提交详情加载失败">
            <CommitDetailPanel />
          </SectionErrorBoundary>
        </div>
      )}
    </div>
  );
}
