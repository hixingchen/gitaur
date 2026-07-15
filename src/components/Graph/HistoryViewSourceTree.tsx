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
const GRAPH_PAD = 16;
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

// ====== 高亮 ======
function HL({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return <>{text.split(re).map((p, i) =>
    re.test(p) ? <span key={i} className={s.highlight}>{p}</span> : p
  )}</>;
}

// ====== 统一 SVG 图形 — 直角连接（地铁图风格） ======
function GraphSVG({ commits, maxLane }: { commits: LaneCommit[]; maxLane: number }) {
  const width = (maxLane + 1) * LANE_W + GRAPH_PAD * 2;
  const height = commits.length * ROW_H;
  const LX = (lane: number) => lane * LANE_W + GRAPH_PAD;
  const RY = (i: number) => i * ROW_H + ROW_H / 2;

  const hashIndex = useMemo(() => new Map(commits.map((c, i) => [c.hash, i])), [commits]);
  const hashLane = useMemo(() => new Map(commits.map(c => [c.hash, c.lane])), [commits]);

  // 每个 lane 的首尾行
  const laneRanges = useMemo(() => {
    const m = new Map<number, { first: number; last: number }>();
    for (let i = 0; i < commits.length; i++) {
      const l = commits[i].lane;
      const e = m.get(l);
      if (!e) m.set(l, { first: i, last: i });
      else e.last = i;
    }
    return m;
  }, [commits]);

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* 贯穿垂直线 */}
      {Array.from(laneRanges.entries()).map(([lane, range]) => (
        <line key={`v-${lane}`}
          x1={LX(lane)} y1={RY(range.first)}
          x2={LX(lane)} y2={RY(range.last)}
          stroke={BRANCH_COLORS[lane % BRANCH_COLORS.length]}
          strokeWidth={2} strokeLinecap="round"
        />
      ))}

      {/* 父子连线 — 直角：先水平再垂直 */}
      {commits.map((c, i) => {
        const cx = LX(c.lane);
        const cy = RY(i);
        return c.parents.map(pHash => {
          const pIdx = hashIndex.get(pHash);
          const pLane = hashLane.get(pHash);
          if (pIdx === undefined || pLane === undefined || pIdx <= i) return null;
          if (c.lane === pLane) return null; // 同 lane 已有贯穿线

          const px = LX(pLane);
          const py = RY(pIdx);
          const color = BRANCH_COLORS[pLane % BRANCH_COLORS.length];
          // 在父子中间行做拐点
          const midY = cy + (py - cy) * 0.5;

          return (
            <path key={`${c.hash}-${pHash}`}
              d={`M ${cx} ${cy} L ${cx} ${midY} L ${px} ${midY} L ${px} ${py}`}
              fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            />
          );
        });
      })}

      {/* 圆点 */}
      {commits.map((c, i) => {
        const cx = LX(c.lane);
        const cy = RY(i);
        return (
          <g key={c.hash}>
            {c.isBranchTip && (
              <circle cx={cx} cy={cy} r={DOT_R + 5}
                fill="none" stroke={c.color} strokeWidth={1.5} opacity={0.15} />
            )}
            <circle cx={cx} cy={cy}
              r={c.isBranchTip ? DOT_R + 1.5 : DOT_R}
              fill={c.isBranchTip ? c.color : 'var(--ant-color-bg-container, #fff)'}
              stroke={c.color} strokeWidth={2}
            />
            {c.isMerge && (
              <circle cx={cx} cy={cy} r={2}
                fill="var(--ant-color-bg-container, #fff)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ====== 提交行（纯文字） ======
const CommitRow = ({ commit, isSelected, query, onSelect }: {
  commit: LaneCommit; isSelected: boolean; query: string; onSelect: () => void;
}) => (
  <div
    className={isSelected ? s.commitRowSelected : s.commitRow}
    role="button" tabIndex={-1} onClick={onSelect}
  >
    <div className={s.commitBody}>
      <div className={s.commitMsgRow}>
        <span className={s.commitMsg}><HL text={commit.message.split('\n')[0]} q={query} /></span>
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
        <span className={s.commitAuthor}><HL text={commit.author} q={query} /></span>
        <span className={s.commitDot} />
        <span>{formatRelativeTime(commit.date)}</span>
        <span className={s.commitDot} />
        <span className={s.commitHash}><HL text={commit.hash.slice(0, 7)} q={query} /></span>
        <Tooltip title="复制完整 hash">
          <Button type="text" size="small" className={s.copyBtn} icon={<CopyOutlined />}
            onClick={(e) => { e.stopPropagation(); copyText(commit.hash); }} />
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
  const graphWidth = (maxLane + 1) * LANE_W + GRAPH_PAD * 2;

  useEffect(() => {
    if (!selectedCommit || !listRef.current) return;
    const idx = commits.findIndex(c => c.hash === selectedCommit);
    if (idx < 0) return;
    const top = idx * ROW_H;
    const bottom = top + ROW_H;
    const { scrollTop, clientHeight } = listRef.current;
    if (top < scrollTop) listRef.current.scrollTop = top;
    else if (bottom > scrollTop + clientHeight) listRef.current.scrollTop = bottom - clientHeight;
  }, [selectedCommit, commits]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (commits.length === 0) return;
    const cur = selectedCommit ? commits.findIndex(c => c.hash === selectedCommit) : -1;
    const next = e.key === 'ArrowDown'
      ? (cur < commits.length - 1 ? cur + 1 : 0)
      : (cur > 0 ? cur - 1 : commits.length - 1);
    setSelectedCommit(commits[next].hash);
  }, [commits, selectedCommit, setSelectedCommit]);

  return (
    <div className={s.root}>
      <div className={s.listPanel}>
        <div className={s.toolbar}>
          <Input size="small" allowClear placeholder="搜索提交..."
            prefix={<SearchOutlined style={{ color: '#bbb', fontSize: 12 }} />}
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }} variant="borderless" />
          <span className={s.toolbarCount}>
            {search ? `${filtered.length}/${logEntries.length}` : `${logEntries.length}`}
          </span>
          <Tooltip title="刷新">
            <Button size="small" type="text" icon={<ReloadOutlined />}
              onClick={() => loadLog(2000)} loading={logLoading} />
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
            <div style={{ position: 'relative' }}>
              {/* SVG 背景层 */}
              <div style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                <GraphSVG commits={commits} maxLane={maxLane} />
              </div>

              {/* 提交行 — 左侧留出图形空间 */}
              {commits.map((commit) => (
                <div key={commit.hash} style={{ marginLeft: graphWidth }}>
                  <CommitRow
                    commit={commit}
                    isSelected={selectedCommit === commit.hash}
                    query={debouncedSearch.trim().toLowerCase()}
                    onSelect={() => setSelectedCommit(selectedCommit === commit.hash ? null : commit.hash)}
                  />
                </div>
              ))}
            </div>
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
