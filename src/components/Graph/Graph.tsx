import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Empty, Spin } from 'antd';
import { useRepoStore } from '../../stores/repoStore';
import { computeTopology, BRANCH_COLORS } from '../../utils/topology';
import type { LogEntry } from '../../types/git';

interface GraphProps {
  /** 可选的过滤后提交列表；不传则用 store 中的 logEntries */
  entries?: LogEntry[];
}

const ROW_H = 40;
const LANE_W = 22;
const DOT_R = 4;
const PAD_L = 18;
const PAD_TOP = 12;
const COLORS = BRANCH_COLORS;

export function Graph({ entries }: GraphProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const logEntries = useRepoStore((s) => s.logEntries);
  const logLoading = useRepoStore((s) => s.logLoading);
  const hasRepo = useRepoStore((s) => !!s.repoInfo);
  const selectedCommit = useRepoStore((s) => s.selectedCommit);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);

  const sourceEntries = entries ?? logEntries;
  const { commits, maxLane } = useMemo(() => computeTopology(sourceEntries), [sourceEntries]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || commits.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const W = rect.width;
    const totalH = commits.length * ROW_H + PAD_TOP * 2;
    canvas.width = W * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    const isDark = document.documentElement.classList.contains('dark') ||
      document.body.style.backgroundColor !== '';
    const textColor = isDark ? '#c0c0c0' : '#262626';
    const subColor = isDark ? '#6b6b6b' : '#8c8c8c';
    const bgColor = isDark ? '#141414' : '#ffffff';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, totalH);

    // 高亮选中行
    if (selectedCommit) {
      const idx = commits.findIndex((c) => c.hash === selectedCommit);
      if (idx >= 0) {
        const y = idx * ROW_H + PAD_TOP;
        ctx.fillStyle = isDark ? 'rgba(22,119,255,0.15)' : 'rgba(22,119,255,0.08)';
        ctx.fillRect(0, y, W, ROW_H);
      }
    }

    const graphRight = PAD_L + maxLane * LANE_W + 8;
    const textX = graphRight + 10;

    // Draw lanes (vertical lines)
    for (let lane = 0; lane < maxLane; lane++) {
      // Find the continuous segments for this lane
      const laneCommits = commits.filter(c => c.lane === lane).map(c => c.hash);
      const laneSet = new Set(laneCommits);

      let inSegment = false;
      let segStart = -1;

      for (let i = 0; i < commits.length; i++) {
        const inLane = laneSet.has(commits[i].hash);
        if (inLane && !inSegment) {
          inSegment = true;
          segStart = i;
        }
        if ((!inLane || i === commits.length - 1) && inSegment) {
          const endI = inLane ? i : i - 1;
          const y1 = segStart * ROW_H + PAD_TOP + ROW_H / 2;
          const y2 = endI * ROW_H + PAD_TOP + ROW_H / 2;
          const x = PAD_L + lane * LANE_W;

          ctx.strokeStyle = COLORS[lane % COLORS.length];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y1);
          ctx.lineTo(x, y2);
          ctx.stroke();
          inSegment = false;
        }
      }
    }

    // Draw merge/branch curves
    const hashLane = new Map(commits.map(c => [c.hash, c.lane]));
    const hashIndex = new Map(commits.map((c, i) => [c.hash, i]));
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      const cy = i * ROW_H + PAD_TOP + ROW_H / 2;
      const cx = PAD_L + c.lane * LANE_W;

      // Draw lines to parents
      for (const pHash of c.parents) {
        const pLane = hashLane.get(pHash);
        const pIdx = hashIndex.get(pHash);
        if (pLane === undefined || pIdx === undefined) continue;

        const py = pIdx * ROW_H + PAD_TOP + ROW_H / 2;
        const px = PAD_L + pLane * LANE_W;

        ctx.strokeStyle = COLORS[pLane % COLORS.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        // Curved line from commit to parent
        const midY = cy + (py - cy) / 2;
        if (c.lane === pLane) {
          // Straight vertical (same lane)
          ctx.lineTo(cx, py);
        } else {
          // S-curve to different lane
          ctx.bezierCurveTo(cx, midY, px, midY, px, py);
        }
        ctx.stroke();
      }

      // Commit dot
      const refNames = c.refs.filter(r => r !== 'HEAD' && r !== 'HEAD -> main' && r !== 'HEAD -> master').map(r => r.replace('HEAD -> ', ''));
      const isBranchTip = refNames.length > 0 && !refNames[0].startsWith('tag:');
      const isMerge = c.parents.length > 1;

      ctx.fillStyle = isBranchTip ? COLORS[c.lane % COLORS.length] : isMerge ? '#666' : '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, isBranchTip ? DOT_R + 2 : DOT_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS[c.lane % COLORS.length];
      ctx.lineWidth = 2;
      ctx.stroke();

      // Second dot for merge commits
      if (isMerge) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }

      // Commit message
      const msg = c.message.split('\n')[0].slice(0, 45);
      ctx.fillStyle = textColor;
      ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(msg, textX, cy + 4);

      // Hash
      ctx.fillStyle = subColor;
      ctx.font = '10px "SF Mono", "Fira Code", "JetBrains Mono", monospace';
      ctx.fillText(c.hash.slice(0, 7), textX, cy - 11);

      // Author + date
      ctx.fillStyle = subColor;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`${c.author} · ${c.date}`, textX, cy + 18);

      // Ref tags
      let tagOffset = textX + ctx.measureText(msg).width + 16;
      for (const ref of refNames) {
        const display = ref.startsWith('tag: ') ? ref : ref.replace('origin/', 'o/');
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const tw = ctx.measureText(display).width + 10;
        const tx = tagOffset;

        const refColor = COLORS[c.lane % COLORS.length];
        ctx.fillStyle = refColor + '20';
        ctx.beginPath();
        const r = 4;
        ctx.moveTo(tx + r, cy - 10);
        ctx.lineTo(tx + tw - r, cy - 10);
        ctx.quadraticCurveTo(tx + tw, cy - 10, tx + tw, cy - 10 + r);
        ctx.lineTo(tx + tw, cy + 4 - r);
        ctx.quadraticCurveTo(tx + tw, cy + 4, tx + tw - r, cy + 4);
        ctx.lineTo(tx + r, cy + 4);
        ctx.quadraticCurveTo(tx, cy + 4, tx, cy + 4 - r);
        ctx.lineTo(tx, cy - 10 + r);
        ctx.quadraticCurveTo(tx, cy - 10, tx + r, cy - 10);
        ctx.fill();

        ctx.fillStyle = refColor;
        ctx.fillText(display, tx + 5, cy + 2);
        tagOffset += tw + 6;
      }
    }
  }, [commits, maxLane, selectedCommit]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => draw());
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [draw]);

  if (!hasRepo) return <Empty description="未打开仓库" />;
  if (logLoading && logEntries.length === 0) return <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>;
  if (commits.length === 0) return <Empty description={entries ? '无匹配的提交' : '暂无提交记录'} />;

  const totalHeight = commits.length * ROW_H + PAD_TOP * 2;

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top + (containerRef.current?.scrollTop ?? 0);
    const idx = Math.floor((y - PAD_TOP) / ROW_H);
    if (idx >= 0 && idx < commits.length) {
      const target = commits[idx];
      // 点击已选中提交则取消，否则选中
      setSelectedCommit(target.hash === selectedCommit ? null : target.hash);
    }
  };

  return (
    <div ref={containerRef} style={{
      flex: 1, minHeight: totalHeight, position: 'relative', overflow: 'auto',
    }}>
      <canvas ref={canvasRef} onClick={handleClick} role="img" aria-label="Git 提交历史图形" style={{ cursor: 'pointer', display: 'block' }} />
    </div>
  );
}
