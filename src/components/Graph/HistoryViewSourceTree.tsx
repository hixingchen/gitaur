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

const LANE_W = 24;

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    const hr = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    if (hr < 24) return `${hr}小时前`;
    if (day < 30) return `${day}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function HL({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return <>{text.split(re).map((p, i) =>
    re.test(p) ? <span key={i} className={s.highlight}>{p}</span> : p
  )}</>;
}

// ====== 图形区域 — 纯 CSS div ======
function GraphLane({ commit, maxLane }: { commit: LaneCommit; maxLane: number }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      height: '100%',
      width: maxLane * LANE_W,
      flexShrink: 0,
      position: 'relative',
    }}>
      {/* 每个 lane 一列 */}
      {Array.from({ length: maxLane }, (_, lane) => {
        const isCurrent = lane === commit.lane;
        const color = BRANCH_COLORS[lane % BRANCH_COLORS.length];

        return (
          <div key={lane} style={{
            width: LANE_W,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            {/* 垂直线 */}
            <div style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 2,
              marginLeft: -1,
              background: color,
              opacity: isCurrent ? 1 : 0.3,
            }} />

            {/* 当前 commit 的圆点 */}
            {isCurrent && (
              <div style={{
                width: commit.isBranchTip ? 12 : 10,
                height: commit.isBranchTip ? 12 : 10,
                borderRadius: '50%',
                background: commit.isBranchTip ? color : 'var(--ant-color-bg-container, #fff)',
                border: `2px solid ${color}`,
                zIndex: 1,
                boxShadow: commit.isBranchTip ? `0 0 0 3px ${color}20` : 'none',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ====== 提交行 ======
const CommitRow = ({ commit, maxLane, isSelected, query, onSelect }: {
  commit: LaneCommit; maxLane: number;
  isSelected: boolean; query: string; onSelect: () => void;
}) => (
  <div className={isSelected ? s.commitRowSelected : s.commitRow}
    role="button" tabIndex={-1} onClick={onSelect}>
    <GraphLane commit={commit} maxLane={maxLane} />
    <div className={s.commitBody}>
      <div className={s.commitMsgRow}>
        <span className={s.commitMsg}>
          <HL text={commit.message.split('\n')[0]} q={query} />
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

  useEffect(() => {
    if (!selectedCommit || !listRef.current) return;
    const idx = commits.findIndex(c => c.hash === selectedCommit);
    if (idx < 0) return;
    const el = listRef.current.children[0]?.children[idx] as HTMLElement;
    if (el) el.scrollIntoView({ block: 'nearest' });
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
            commits.map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
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
