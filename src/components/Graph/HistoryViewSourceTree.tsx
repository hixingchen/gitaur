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
const GRAPH_PAD = 12;
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

// ====== 统一 SVG 图形画布 ======
function CommitGraphCanvas({ commits, maxLane }: { commits: LaneCommit[]; maxLane: number }) {
  const hashIndex = useMemo(() => new Map(commits.map((c, i) => [c.hash, i])), [commits]);
  const hashLane = useMemo(() => new Map(commits.map(c => [c.hash, c.lane])), [commits]);

  const width = (maxLane + 1) * LANE_W + GRAPH_PAD * 2;
  const height = commits.length * ROW_H;

  const getLaneX = (lane: number) => lane * LANE_W + GRAPH_PAD + DOT_R;
  const getRowY = (idx: number) => idx * ROW_H + ROW_H / 2;

  // 收集所有连线段
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; isCurve: boolean }> = [];
  const dots: Array<{ x: number; y: number; color: string; isTip: boolean; isMerge: boolean }> = [];

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const cx = getLaneX(c.lane);
    const cy = getRowY(i);

    // 到父提交的连线
    for (const pHash of c.parents) {
      const pIdx = hashIndex.get(pHash);
      const pLane = hashLane.get(pHash);
      if (pIdx === undefined || pLane === undefined || pIdx <= i) continue;

      const px = getLaneX(pLane);
      const py = getRowY(pIdx);
      const color = BRANCH_COLORS[pLane % BRANCH_COLORS.length];

      lines.push({ x1: cx, y1: cy, x2: px, y2: py, color, isCurve: c.lane !== pLane });
    }

    // 提交圆点
    dots.push({
      x: cx, y: cy,
      color: c.color,
      isTip: c.isBranchTip,
      isMerge: c.isMerge,
    });
  }

  return (
    <svg
      width={width} height={height}
      style={{ display: 'block', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    >
      {/* 连线层 */}
      {lines.map((line, i) => {
        if (!line.isCurve) {
          // 同 lane 直线
          return (
            <line key={i}
              x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
              stroke={line.color} strokeWidth={2} strokeLinecap="round"
            />
          );
        }
        // 不同 lane — 三次贝塞尔，中间段水平过渡
        const midY = (line.y1 + line.y2) / 2;
        const cpOffset = Math.abs(line.x2 - line.x1) * 0.4;
        return (
          <path key={i}
            d={`M ${line.x1} ${line.y1}
                C ${line.x1} ${line.y1 + cpOffset},
                  ${line.x2} ${line.y2 - cpOffset},
                  ${line.x2} ${line.y2}`}
            fill="none" stroke={line.color} strokeWidth={2} strokeLinecap="round"
          />
        );
      })}

      {/* 圆点层 */}
      {dots.map((dot, i) => (
        <g key={i}>
          {/* 分支 tip 光晕 */}
          {dot.isTip && (
            <circle cx={dot.x} cy={dot.y} r={DOT_R + 4}
              fill="none" stroke={dot.color} strokeWidth={1.5} opacity={0.15}
            />
          )}
          {/* 外圈 */}
          <circle cx={dot.x} cy={dot.y}
            r={dot.isTip ? DOT_R + 1 : DOT_R}
            fill={dot.isTip ? dot.color : 'var(--ant-color-bg-container, #fff)'}
            stroke={dot.color} strokeWidth={2}
          />
          {/* 合并内点 */}
          {dot.isMerge && (
            <circle cx={dot.x} cy={dot.y} r={2}
              fill="var(--ant-color-bg-container, #fff)"
            />
          )}
        </g>
      ))}
    </svg>
  );
}

// ====== 提交行组件 ======
const CommitRow = ({ commit, isSelected, query, onSelect }: {
  commit: LaneCommit; isSelected: boolean; query: string; onSelect: () => void;
}) => (
  <div
    className={isSelected ? s.commitRowSelected : s.commitRow}
    role="button" tabIndex={-1}
    onClick={onSelect}
  >
    {/* 消息 + tag */}
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
  const graphWidth = (maxLane + 1) * LANE_W + GRAPH_PAD * 2;

  // 选中时滚动到可视区域
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

  // 键盘导航
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
        {/* 工具栏 */}
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

        {/* 提交列表 — 相对定位容器，SVG 绝对定位覆盖 */}
        <div className={s.commitList} ref={listRef} tabIndex={0} onKeyDown={handleKeyDown}
          style={{ position: 'relative' }}
        >
          {!repoInfo ? (
            <Empty description="未打开仓库" style={{ marginTop: 80 }} />
          ) : logLoading && logEntries.length === 0 ? (
            <div className={s.emptyState}><Spin /></div>
          ) : commits.length === 0 ? (
            <Empty description={search ? '无匹配' : '暂无提交'} style={{ marginTop: 80 }} />
          ) : (
            <>
              {/* 统一 SVG 画布 */}
              <div style={{ width: graphWidth, height: commits.length * ROW_H, position: 'absolute', left: 0, top: 0 }}>
                <CommitGraphCanvas commits={commits} maxLane={maxLane} />
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
            </>
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
