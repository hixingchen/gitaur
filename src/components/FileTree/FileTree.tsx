import { Spin, Empty, Segmented, Button, Checkbox, Progress, Tooltip } from 'antd';
import {
  CheckCircleOutlined, PlayCircleOutlined,
  WarningOutlined, ExclamationCircleOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useViewStore } from '../../stores/viewStore';
import { useMemo, useCallback, memo } from 'react';
import { List as FixedSizeList } from 'react-window';

/** 从双字符状态码中提取用于显示的单字符（index 或 worktree） */
function displayStatus(file: { status: string; staged: boolean }): string {
  // status 是双字符如 " M"（unstaged 修改）、"A "（staged 新增）、"UU"（冲突）
  if (file.staged) return file.status[0] === ' ' ? file.status[1] : file.status[0];
  return file.status[1] === ' ' ? file.status[0] : file.status[1];
}

function statusLabel(c: string): string {
  const m: Record<string, string> = { M: '修改', A: '新增', D: '删除', R: '重命名', '?': '新增' };
  return m[c] || c;
}

const statusCfg: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: 'var(--ant-color-warning, #faad14)' },
  A: { label: 'A', color: 'var(--ant-color-success, #52c41a)' },
  D: { label: 'D', color: 'var(--ant-color-error, #ff4d4f)' },
  R: { label: 'R', color: 'var(--ant-color-primary, #1677ff)' },
  '?': { label: '?', color: 'var(--ant-color-text-tertiary, rgba(0,0,0,0.25))' },
};

type FileInfo = { path: string; status: string; staged: boolean };

// 单行文件 — memo 避免不必要重渲染
const CONFLICT_STATUSES = ['UU', 'AA', 'DD', 'AU', 'UA', 'UD', 'DU'];

const FileItem = memo(function FileItem({
  file, hasConflicts, onSelect, onToggle,
}: {
  file: FileInfo;
  hasConflicts: boolean;
  onSelect: (p: string) => void;
  onToggle: (path: string) => void;
}) {
  const selectedFile = useViewStore((s) => s.selectedFile);
  const isSelected = selectedFile === file.path;
  const dispStatus = displayStatus(file);
  const cfg = statusCfg[dispStatus] || statusCfg['?'];
  const isConflictFile = CONFLICT_STATUSES.includes(file.status);
  const isConflict = hasConflicts && ['M', 'D', 'A'].includes(dispStatus);
  // 跨平台路径分割：同时处理 / 和 \
  const parts = file.path.split(/[/\\]/);
  const name = parts.pop() || file.path;
  const dir = parts.join('/');

  const handleCheckboxChange = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    // 冲突文件不允许手动勾选，需要在 DiffView 中保存后自动暂存
    if (isConflictFile) return;
    onToggle(file.path);
  };

  const handleRowClick = () => {
    onSelect(file.path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(file.path);
    }
  };

  return (
    <div
      className={isSelected ? 'file-item selected' : 'file-item'}
      role="button"
      tabIndex={0}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
    >
      <Checkbox checked={file.staged}
        disabled={isConflictFile}
        onChange={handleCheckboxChange} style={{ margin: 0, flexShrink: 0 }} />
      <span style={{
        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isConflict ? 'rgba(255,77,79,0.15)' : `${cfg.color}15`,
        color: isConflict ? 'var(--ant-color-error, #ff4d4f)' : cfg.color,
        fontSize: 11, fontWeight: 700,
      }}>
        {isConflict ? '!' : cfg.label}
      </span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: isSelected ? 'var(--ant-color-text, #e0e0e0)' : 'var(--ant-color-text-secondary, #ccc)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</div>
        {dir && (
          <div style={{
            fontSize: 10, fontFamily: 'monospace',
            color: 'var(--ant-color-text-tertiary, #666)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            direction: 'rtl', textAlign: 'left',
          }}>{dir}</div>
        )}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 600, color: isConflict ? '#ff4d4f' : cfg.color,
        background: `${isConflict ? '#ff4d4f' : cfg.color}15`,
        borderRadius: 4, padding: '0 5px', lineHeight: '16px', flexShrink: 0,
      }}>
        {file.staged ? '✓' : isConflict ? '冲突' : statusLabel(cfg.label)}
      </span>
    </div>
  );
});

/** 文件面板标签页类型（预留扩展） */
export type PanelTab = 'changes';

interface FileTreeProps {
  tab: PanelTab;
  onTabChange: (t: PanelTab) => void;
  onSelectFile?: (path: string) => void;
}

export function FileTree({ tab, onTabChange, onSelectFile }: FileTreeProps) {
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const loading = useRepoStore((s) => s.loading);
  const stageFile = useRepoStore((s) => s.stageFile);
  const unstageFile = useRepoStore((s) => s.unstageFile);
  const stageAll = useRepoStore((s) => s.stageAll);
  const continueConflict = useRepoStore((s) => s.continueConflict);
  const pushAfterConflictResolved = usePipelineStore((s) => s.pushAfterConflictResolved);
  const conflictInitialTotal = useRepoStore((s) => s.conflictInitialTotal);
  const currentTask = usePipelineStore((s) => s.currentTask);

  // 冲突面板只在当前任务处于冲突状态时显示
  const conflict = repoInfo?.conflict;
  const taskInConflict = currentTask?.phase === 'paused_sync_error'
    && (currentTask?.error || '').includes('冲突');
  const inMergeOrRebase = (conflict?.conflictType === 'rebase' || conflict?.conflictType === 'merge')
    && taskInConflict;
  const hasConflicts = inMergeOrRebase;

  const files = useMemo(() => repoInfo?.status ?? [], [repoInfo]);
  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files]);

  // 虚拟滚动阈值：超过 50 个文件时启用
  const VIRTUAL_THRESHOLD = 50;
  const ITEM_HEIGHT = 40;

  // 切换文件的暂存状态：使用 path 直接操作 store
  const handleToggleFile = useCallback((path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file) return;
    if (file.staged) {
      unstageFile(path);
    } else {
      stageFile(path);
    }
  }, [files, stageFile, unstageFile]);

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>;
  if (!repoInfo) return <Empty description="未打开仓库" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Segmented block size="small" value={tab} style={{ flex: 1 }}
          onChange={(v) => onTabChange(v as PanelTab)}
          options={[
            { label: '更改', value: 'changes' },
          ]} />
      </div>

      {files.length === 0 && !hasConflicts ? (
        <div style={{ textAlign: 'center', padding: '32px 8px', color: '#999', fontSize: 12 }}>
          ✓ 没有更改
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
          {hasConflicts && conflict && (() => {
            const conflictFiles = conflict.conflictedFiles;
            // 用初始总数计算进度，暂存后文件从列表消失但进度持续更新
            const totalCount = Math.max(conflictInitialTotal, conflict.totalCount);
            const resolvedCount = totalCount - conflictFiles.length;
            const allStaged = totalCount > 0 && conflictFiles.length === 0;
            // 全部解决后才能继续：
            // - 有冲突文件且全部暂存（allStaged）
            // - 无冲突文件但在 rebase/merge 中（冲突已全部暂存，status 从 UU 变为 M）
            const canContinue = allStaged || (totalCount === 0 && inMergeOrRebase && files.some((f) => f.staged));

            const conflictTypeLabel: Record<string, string> = {
              'both-modified': '双方修改',
              'both-added': '双方新增',
              'both-deleted': '双方删除',
              'added-by-us': '我方新增',
              'added-by-them': '对方新增',
              'deleted-by-them': '对方删除',
              'deleted-by-us': '我方删除',
            };

            return (
              <div style={{
                padding: '12px', borderRadius: 10,
                background: allStaged
                  ? 'linear-gradient(135deg, rgba(82,196,26,0.06) 0%, rgba(82,196,26,0.03) 100%)'
                  : 'linear-gradient(135deg, rgba(255,77,79,0.06) 0%, rgba(255,120,77,0.04) 100%)',
                border: `1px solid ${allStaged ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.15)'}`,
              }}>
                {/* 标题栏 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {allStaged
                    ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                    : <WarningOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                  }
                  <span style={{
                    color: allStaged ? '#52c41a' : '#ff4d4f',
                    fontWeight: 600, fontSize: 13,
                  }}>
                    {allStaged
                      ? (conflict.conflictType === 'rebase' ? '变基冲突已解决' : '合并冲突已解决')
                      : (conflict.conflictType === 'rebase' ? '变基冲突' : '合并冲突')
                    }
                  </span>
                </div>

                {/* 进度条 */}
                {totalCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Progress
                      percent={Math.round((resolvedCount / totalCount) * 100)}
                      size="small"
                      status={allStaged ? 'success' : 'active'}
                      showInfo={false}
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                    <span style={{
                      fontSize: 11, color: allStaged ? '#52c41a' : '#ff4d4f', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {resolvedCount}/{totalCount} 已解决
                    </span>
                  </div>
                )}

                {/* 冲突文件列表 */}
                {conflictFiles.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                    {conflictFiles.map((f) => {
                      const parts = f.path.split(/[/\\]/);
                      const name = parts.pop() || f.path;
                      const dir = parts.join('/');
                      return (
                        <div
                          key={f.path}
                          onClick={() => onSelectFile?.(f.path)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                            borderRadius: 6, cursor: 'pointer',
                            background: f.resolved ? 'rgba(82,196,26,0.08)' : 'rgba(255,77,79,0.06)',
                          }}
                        >
                          {f.resolved
                            ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12, flexShrink: 0 }} />
                            : <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 12, flexShrink: 0 }} />
                          }
                          <span style={{
                            fontSize: 12, flex: 1, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: f.resolved ? '#52c41a' : 'var(--ant-color-text)',
                            textDecoration: f.resolved ? 'line-through' : 'none',
                          }}>
                            {name}
                          </span>
                          <Tooltip title={conflictTypeLabel[f.conflictType] || f.conflictType}>
                            <InfoCircleOutlined style={{
                              fontSize: 10, color: 'var(--ant-color-text-tertiary, #666)',
                              flexShrink: 0,
                            }} />
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 引导提示 */}
                <div style={{
                  fontSize: 11, color: 'var(--ant-color-text-tertiary, #888)',
                  lineHeight: 1.6, padding: '6px 8px',
                  background: 'rgba(0,0,0,0.03)', borderRadius: 6,
                }}>
                  {allStaged
                    ? '✅ 所有冲突已解决，点击「已解决，继续」'
                    : totalCount === 0 && inMergeOrRebase
                      ? '✅ 所有冲突已解决，点击「已解决，继续」完成变基'
                      : `解决冲突：点击文件编辑 → 删除冲突标记（<<<<<<< ======= >>>>>>>）→ 保存 → 暂存（勾选）`
                  }
                </div>
              </div>
            );
          })()}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflow: 'hidden' }}>
            {/* 暂存的更改 */}
            {stagedFiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: 'var(--ant-color-text-tertiary, #888)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    暂存的更改 ({stagedFiles.length})
                  </span>
                  <span style={{ flex: 1 }} />
                  <Button type="text" size="small"
                    style={{ fontSize: 10, color: '#999', padding: '0 4px', height: 20 }}
                    onClick={() => stagedFiles.forEach((f) => unstageFile(f.path))}>
                    全部取消
                  </Button>
                </div>
                {stagedFiles.length > VIRTUAL_THRESHOLD ? (
                  <FixedSizeList
                    height={Math.min(stagedFiles.length * ITEM_HEIGHT, 300)}
                    itemCount={stagedFiles.length}
                    itemSize={ITEM_HEIGHT}
                    width="100%"
                  >
                    {({ index, style }) => (
                      <div style={style}>
                        <FileItem
                          file={stagedFiles[index]}
                          hasConflicts={hasConflicts}
                          onSelect={onSelectFile || (() => {})}
                          onToggle={handleToggleFile}
                        />
                      </div>
                    )}
                  </FixedSizeList>
                ) : (
                  stagedFiles.map((f) => (
                    <FileItem
                      key={f.path}
                      file={f}
                      hasConflicts={hasConflicts}
                      onSelect={onSelectFile || (() => {})}
                      onToggle={handleToggleFile}
                    />
                  ))
                )}
              </div>
            )}

            {/* 未暂存的更改 */}
            {unstagedFiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: 'var(--ant-color-text-tertiary, #888)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>
                    更改 ({unstagedFiles.length})
                  </span>
                  <span style={{ flex: 1 }} />
                  <Button type="text" size="small"
                    style={{ fontSize: 10, color: '#999', padding: '0 4px', height: 20 }}
                    onClick={() => stageAll()}>
                    全部暂存
                  </Button>
                </div>
                {unstagedFiles.length > VIRTUAL_THRESHOLD ? (
                  <FixedSizeList
                    height={Math.min(unstagedFiles.length * ITEM_HEIGHT, 300)}
                    itemCount={unstagedFiles.length}
                    itemSize={ITEM_HEIGHT}
                    width="100%"
                  >
                    {({ index, style }) => (
                      <div style={style}>
                        <FileItem
                          file={unstagedFiles[index]}
                          hasConflicts={hasConflicts}
                          onSelect={onSelectFile || (() => {})}
                          onToggle={handleToggleFile}
                        />
                      </div>
                    )}
                  </FixedSizeList>
                ) : (
                  unstagedFiles.map((f) => (
                    <FileItem
                      key={f.path}
                      file={f}
                      hasConflicts={hasConflicts}
                      onSelect={onSelectFile || (() => {})}
                      onToggle={handleToggleFile}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}