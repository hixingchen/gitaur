import type { LogEntry } from '../types/git';

export const BRANCH_COLORS = [
  '#1677ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1',
  '#13c2c2', '#eb2f96', '#f759ab', '#fa8c16', '#2f54eb',
];

export interface LaneCommit {
  hash: string;
  lane: number;
  color: string;
  parents: string[];
  refs: string[];
  message: string;
  author: string;
  date: string;
  isMerge: boolean;
  isBranchTip: boolean;
}

/**
 * 拓扑 — 只有 2 条线，绝不创建新 lane
 * lane 0 = main/master
 * lane 1 = develop (及所有其他分支)
 */
export function computeTopology(entries: LogEntry[]): { commits: LaneCommit[]; maxLane: number } {
  if (entries.length === 0) return { commits: [], maxLane: 0 };

  const laneOf = new Map<string, number>();

  // 解析分支名
  function getBranch(refs: string[]): string | null {
    for (const r of refs) {
      if (r === 'HEAD' || r.startsWith('HEAD -> ')) continue;
      const clean = r.replace('HEAD -> ', '').replace('tag: ', '');
      if (clean.startsWith('origin/')) return clean.replace('origin/', '');
      return clean;
    }
    return null;
  }

  // 第一遍：main/master → lane 0，其他 → lane 1
  for (const e of entries) {
    const branch = getBranch(e.refs);
    if (branch === 'main' || branch === 'master') {
      laneOf.set(e.hash, 0);
    } else {
      laneOf.set(e.hash, 1);
    }
  }

  // 第二遍：从旧到新，无 lane 的继承第一个父提交的 lane
  const reversed = [...entries].reverse();
  const entryMap = new Map(entries.map(e => [e.hash, e]));
  for (const e of reversed) {
    if (laneOf.has(e.hash)) continue;
    // 继承第一个父提交的 lane
    if (e.parents.length > 0) {
      const parentLane = laneOf.get(e.parents[0]);
      if (parentLane !== undefined) {
        laneOf.set(e.hash, parentLane);
      } else {
        laneOf.set(e.hash, 1);
      }
    } else {
      laneOf.set(e.hash, 1);
    }
  }

  // 构建结果
  const commits: LaneCommit[] = entries.map(e => {
    const refNames = e.refs
      .filter(r => r !== 'HEAD' && r !== 'HEAD -> main' && r !== 'HEAD -> master')
      .map(r => r.replace('HEAD -> ', ''));
    const lane = laneOf.get(e.hash) ?? 1;
    return {
      hash: e.hash,
      lane,
      color: BRANCH_COLORS[lane % BRANCH_COLORS.length],
      parents: e.parents,
      refs: refNames,
      message: e.message,
      author: e.author,
      date: e.date,
      isMerge: e.parents.length > 1,
      isBranchTip: refNames.length > 0 && !refNames[0].startsWith('tag:'),
    };
  });

  return { commits, maxLane: 2 };
}
