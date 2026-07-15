import type { LogEntry } from '../types/git';

/** 分支颜色配置（30 色，减少多分支时的颜色重复） */
export const BRANCH_COLORS = [
  '#1677ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1',
  '#13c2c2', '#eb2f96', '#f759ab', '#fa8c16', '#2f54eb',
  '#a0d911', '#fadb14', '#ff7a45', '#9254de', '#36cfc9',
  '#ff85c0', '#597ef7', '#73d13d', '#ffc53d', '#ff4d4f',
  '#b37feb', '#40a9ff', '#95de64', '#ffd666', '#ff9c6e',
  '#85a5ff', '#5cdbd3', '#b5f5ec', '#d3adf7', '#ffadd2',
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
 * 计算提交拓扑 — 为每个 commit 分配 lane 和颜色。
 * Graph.tsx 和 HistoryViewSourceTree.tsx 共用此函数。
 */
export function computeTopology(entries: LogEntry[]): { commits: LaneCommit[]; maxLane: number } {
  if (entries.length === 0) return { commits: [], maxLane: 0 };

  const reversed = [...entries].reverse();
  const laneOf = new Map<string, number>();
  const colorOf = new Map<string, string>();
  let nextLane = 0;
  const freeLanes: number[] = [];

  function allocLane(): { lane: number; color: string } {
    const lane = freeLanes.length > 0 ? freeLanes.shift()! : nextLane++;
    return { lane, color: BRANCH_COLORS[lane % BRANCH_COLORS.length] };
  }

  // 预构建 parent -> children 映射，避免 O(n²) 查找
  const childrenMap = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    for (const parentHash of entry.parents) {
      const list = childrenMap.get(parentHash);
      if (list) {
        list.push(entry);
      } else {
        childrenMap.set(parentHash, [entry]);
      }
    }
  }

  for (const commit of reversed) {
    const children = childrenMap.get(commit.hash) || [];
    let lane: number;
    let color: string;

    if (children.length === 0) {
      const a = allocLane();
      lane = a.lane; color = a.color;
    } else if (children.length === 1) {
      const childLane = laneOf.get(children[0].hash);
      if (childLane !== undefined) {
        lane = childLane;
        color = colorOf.get(children[0].hash)!;
      } else {
        const a = allocLane();
        lane = a.lane; color = a.color;
      }
    } else {
      const childLane = laneOf.get(children[0].hash);
      if (childLane !== undefined) {
        lane = childLane;
        color = colorOf.get(children[0].hash)!;
      } else {
        const a = allocLane();
        lane = a.lane; color = a.color;
      }
    }

    if (commit.parents.length > 1) {
      for (let i = 1; i < commit.parents.length; i++) {
        const parentLane = laneOf.get(commit.parents[i]);
        if (parentLane !== undefined && parentLane !== lane) {
          freeLanes.push(parentLane);
        }
      }
    }

    laneOf.set(commit.hash, lane);
    colorOf.set(commit.hash, color);
  }

  const commits = entries.map(e => {
    const refNames = e.refs
      .filter(r => r !== 'HEAD' && r !== 'HEAD -> main' && r !== 'HEAD -> master')
      .map(r => r.replace('HEAD -> ', ''));
    return {
      hash: e.hash,
      lane: laneOf.get(e.hash) ?? 0,
      color: colorOf.get(e.hash) ?? BRANCH_COLORS[0],
      parents: e.parents,
      refs: refNames,
      message: e.message,
      author: e.author,
      date: e.date,
      isMerge: e.parents.length > 1,
      isBranchTip: refNames.length > 0 && !refNames[0].startsWith('tag:'),
    };
  });

  const maxLane = Math.max(1, nextLane);
  return { commits, maxLane };
}
