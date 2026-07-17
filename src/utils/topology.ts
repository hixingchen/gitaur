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
 * 拓扑计算 — --first-parent 模式下为单线
 *
 * 使用 --first-parent 后，git log 只返回当前分支的主线提交，
 * 所有提交都在 lane 0，形成简洁的单线历史。
 */
export function computeTopology(entries: LogEntry[]): { commits: LaneCommit[]; maxLane: number } {
  if (entries.length === 0) return { commits: [], maxLane: 0 };

  // --first-parent 模式：所有提交都在单线上
  const commits: LaneCommit[] = entries.map(e => {
    const refNames = e.refs
      .filter(r => r !== 'HEAD' && !r.startsWith('HEAD -> '))
      .map(r => r.replace('HEAD -> ', ''));
    return {
      hash: e.hash,
      lane: 0,
      color: BRANCH_COLORS[0],
      parents: e.parents,
      refs: refNames,
      message: e.message,
      author: e.author,
      date: e.date,
      isMerge: e.parents.length > 1,
      isBranchTip: refNames.length > 0 && !refNames[0].startsWith('tag:'),
    };
  });

  return { commits, maxLane: 1 };
}
