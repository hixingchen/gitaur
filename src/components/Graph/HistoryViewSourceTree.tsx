import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Tooltip, Spin, Empty } from 'antd';
import { SearchOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { computeTopology, BRANCH_COLORS } from '../../utils/topology';
import type { LaneCommit } from '../../utils/topology';
import { copyText } from '../../utils/clipboard';
import { useDebounce } from '../../hooks/useDebounce';
import { CommitDetailPanel } from './CommitDetailPanel';
import { SectionErrorBoundary } from '../SectionErrorBoundary';
import s from './HistoryView.module.css';

const ROW_H = 44;
const LANE_W = 22;
const GRAPH_PAD = 14;
const DOT_R = 4.5;

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

// ====== 高亮搜索文本 ======
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return <>{text.split(regex).map((part, i) =>
    regex.test(part) ? <span key={i} className={s.highlight}>{part}</span> : part
  )}</>;
}

// ====== 单行 SVG 图形 ======
function RowGraph({ commit, commits, maxLane }: { commit: LaneCommit; commits: LaneCommit[]; maxLane: number }) {
  const width = (maxLane + 1) * LANE_W + GRAPH_PAD * 2;
  const cx = commit.lane * LANE_W + GRAPH_PAD + DOT_R;
  const cy = ROW_H / 2;
  const currentIdx = commits.indexOf(commit);

  // 贯穿线：前后是否有同 lane 的提交
  const prev = currentIdx > 0 ? commits[currentIdx - 1] : null;
  const next = currentIdx < commits.length - 1 ? commits[currentIdx + 1] : null;
  const hasAbove = prev?.lane === commit.lane;
  const hasBelow = next?.lane === commit.lane;

  // 父提交连线（只画向下的）
  const hashIndex = useMemo(() => new Map(commits.map((c, i) => [c.hash, i])), [commits]);
  const hashLane = useMemo(() => new Map(commits.map(c => [c.hash, c.lane])), [commits]);

  return (
    <svg width={width} height={ROW_H} style={{ display: 'block' }}>
      {/* 所有 lane 的贯穿线（半透明背景） */}
      {Array.from({ length: maxLane + 1 }, (_, lane) => {
        const laneX = lane * LANE_W + GRAPH_PAD + DOT_R;
        // 检查这个 lane 在当前行前后是否有提交
        const laneAbove = prev && prev.lane >= lane;
        const laneBelow = next && next.lane >= lane;
        if (!laneAbove && !laneBelow && commit.lane !== lane) return null;
        return (
          <line key={`bg-${lane}`}
            x1={laneX} y1={0} x2={laneX} y2={ROW_H}
            stroke={BRANCH_COLORS[lane % BRANCH_COLORS.length]}
            strokeWidth={lane === commit.lane ? 2 : 1}
            opacity={lane === commit.lane ? 0.6 : 0.15}
          />
        );
      })}

      {/* 到父提交的连线 */}
      {commit.parents.map(pHash => {
        const pIdx = hashIndex.get(pHash);
        const pLane = hashLane.get(pHash);
        if (pIdx === undefined || pLane === undefined || pIdx <= currentIdx) return null;

        const px = pLane * LANE_W + GRAPH_PAD + DOT_R;
        const color = BRANCH_COLORS[pLane % BRANCH_COLORS.length];

        if (commit.lane === pLane) {
          return <line key={pHash} x1={cx} y1={cy} x2={px} y2={ROW_H}
            stroke={color} strokeWidth={2} strokeLinecap="round" />;
        }
        // 不同 lane — S 曲线
        const cp = Math.abs(px - cx) * 0.5;
        return (
          <path key={pHash}
            d={`M ${cx} ${cy} C ${cx} ${cy + cp}, ${px} ${ROW_H - cp}, ${px} ${ROW_H}`}
            fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
          />
        );
      })}

      {/* 提交圆点 */}
      <circle cx={cx} cy={cy}
        r={commit.isBranchTip ? DOT_R + 1.5 : DOT_R}
        fill={commit.isBranchTip ? commit.color : 'var(--ant-color-bg-container, #fff)'}
        stroke={commit.color} strokeWidth={2}
      />
      {commit.isMerge && (
        <circle cx={cx} cy={cy} r={2}
          fill="var(--ant-color-bg-container, #fff)" />
      )}
      {commit.isBranchTip && (
        <circle cx={cx} cy={cy} r={DOT_R + 4}
          fill="none" stroke={commit.color} strokeWidth={1.5} opacity={0.15}
        />
      )}
    </svg>
  );
}

// ====== 提交行 ======
const CommitRow = ({ commit, commits, maxLane, isSelected, query, onSelect }: {
  commit: LaneCommit; commits: LaneCommit[]; maxLane: number;
  isSelected: boolean; query: string; onSelect: () => void;
}) => (
  <div
    className={isSelected ? s.commitRowSelected : s.commitRow}
    role="button" tabIndex={-1}
    onClick={onSelect}
  >
    {/* 图形 — 内嵌在行内，天然对齐 */}
    <div className={s.graphCell} style={{ width: (maxLane + 1) * LANE_W + GRAPH_PAD * 2 }}>
      <RowGraph commit={commit} commits={commits} maxLane={maxLane} />
    </div>

    {/* 提交信息 */}
    <div className={s.commitBody}>
      <div className={s.commitMsgRow}>
        <span className={s.commitMsg}>
          <HighlightText text={commit.message.split('\n')[0]} query={query} />
        </span>
        <div className={s.refTags}>
          {commit.refs.filter(r => r.startsWith('tag: ')).map((ref, idx) => (
            <span key={idx} className={s.refTag}
              style={{ color: '#faad14', background: 'rgba(250,173,20,0.1)', border: '1px solid rgba(250,173,20,0.25)' }}>
              {ref.replace('tag: ', '')}
            </span>
          ))}
        </div>
      </div>
      <div className={s.commitMeta}>
        <span className={s.commitAuthor}><HighlightText text={commit.author} query={query} /></span>
        <span className={s.commitDot} />
        <span>{formatRelativeTime(commit.date)}</span>
        <span className={s.commitDot} />
        <span className={s.commitHash}><HighlightText text={commit.hash.slice(0, 7)} query={query} /></span>
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

// ====== 主组件 ======
export function HistoryViewSourceTree() {
  const logEntries = useRepoStore((s) => s.logEntries);
  const logLoading = useRepoStore((s) => s.logLoading);
  const loadLog = useRepoStore((s) => s.loadLog);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const selectedCommit = useRepoStore((s) => s.selectedCommit);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (repoInfo) loadLog(2000); }, [repoInfo]);

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

  useEffect(() => {
    if (!selectedCommit || !listRef.current) return;
    const idx = commits.findIndex(c => c.hash === selectedCommit);
    if (idx < 0) return;
    const rowTop = idx * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const { scrollTop, clientHeight } = listRef.current;
    if (rowTop < scrollTop) listRef.current.scrollTop = rowTop;
    else if (rowBottom > scrollTop + clientHeight) listRef.current.scrollTop = rowBottom - clientHeight;
  }, [selectedCommit, commits]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (commits.length === 0) return;
    const currentIdx = selectedCommit ? commits.findIndex(c => c.hash === selectedCommit) : -1;
    const nextIdx = e.key === 'ArrowDown'
      ? (currentIdx < commits.length - 1 ? currentIdx + 1 : 0)
      : (currentIdx > 0 ? currentIdx - 1 : commits.length - 1);
    setSelectedCommit(commits[nextIdx].hash);
  }, [commits, selectedCommit, setSelectedCommit]);

  return (
    <div className={s.root}>
      <div className={s.listPanel}>
        <div className={s.toolbar}>
          <Input size="small" allowClear placeholder="搜索提交..."
            prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 12 }} />}
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }} variant="borderless"
          />
          <span className={s.toolbarCount}>
            {search ? `${filtered.length}/${logEntries.length}` : `${logEntries.length}`}
          </span>
          <Tooltip title="刷新">
            <Button size="small" type="text" icon={<ReloadOutlined />}
              onClick={() => loadLog(2000)} loading={logLoading}
            />
          </Tooltip>
        </div>

        <div className={s.commitList} ref={listRef} tabIndex={0} onKeyDown={handleKeyDown}>
          {!repoInfo ? (
            <Empty description="未打开仓库" style={{ marginTop: 80 }} />
          ) : logLoading && logEntries.length === 0 ? (
            <div className={s.emptyState}><Spin /></div>
          ) : commits.length === 0 ? (
            <Empty description={search ? '无匹配' : '暂无提交'} style={{ marginTop: 80 }} />
          ) : (
            commits.map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                commits={commits}
                maxLane={maxLane}
                isSelected={selectedCommit === commit.hash}
                query={debouncedSearch.trim().toLowerCase()}
                onSelect={() => setSelectedCommit(selectedCommit === commit.hash ? null : commit.hash)}
              />
            ))
          )}
        </div>
      </div>

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
