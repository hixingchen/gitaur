import { Spin, Empty, Segmented, Button, Checkbox, Steps } from 'antd';
import {
  ReloadOutlined, EditOutlined, SaveOutlined, CheckCircleOutlined,
  PlayCircleOutlined, StopOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { useMemo, useEffect, useState, memo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { List as FixedSizeList } from 'react-window';

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
  const cfg = statusCfg[file.status] || statusCfg['?'];
  const isConflict = hasConflicts && ['M', 'D', 'A'].includes(file.status);
  // 跨平台路径分割：同时处理 / 和 \
  const parts = file.path.split(/[/\\]/);
  const name = parts.pop() || file.path;
  const dir = parts.join('/');

  const handleCheckboxChange = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
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
  const abortConflict = useRepoStore((s) => s.abortConflict);
  const continueConflict = useRepoStore((s) => s.continueConflict);
  const refreshStatus = useRepoStore((s) => s.refreshStatus);
  const [hasConflicts, setHasConflicts] = useState(false);

  // 只在 status 长度变化或有冲突标记时检查冲突（避免每 300ms 调用）
  const statusSignature = useMemo(
    () => repoInfo?.status.map((f) => `${f.path}:${f.status}:${f.staged}`).join(',') ?? '',
    [repoInfo?.status]
  );

  useEffect(() => {
    if (!repoInfo) return;
    // 快速检测：如果没有任何 UU/AA/DD 等冲突标记，直接跳过 IPC 调用
    const hasConflictMarkers = repoInfo.status.some((f) => f.status === 'UU' || f.status === 'AA' || f.status === 'DD'
      || f.status === 'AU' || f.status === 'UA' || f.status === 'UD' || f.status === 'DU');
    if (!hasConflictMarkers) {
      setHasConflicts(false);
      return;
    }
    invoke<{ hasConflicts: boolean }>('check_conflicts', {
      repoPath: repoInfo.path,
    }).then((r) => setHasConflicts(r.hasConflicts)).catch((e) => {
      console.warn('检查冲突状态失败:', e);
      setHasConflicts(false);
    });
  }, [statusSignature]);

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

  const handleRefresh = () => {
    refreshStatus();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Segmented block size="small" value={tab} style={{ flex: 1 }}
          onChange={(v) => onTabChange(v as PanelTab)}
          options={[
            { label: '更改', value: 'changes' },
          ]} />
        <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh} />
      </div>

      {files.length === 0 && !hasConflicts ? (
        <div style={{ textAlign: 'center', padding: '32px 8px', color: '#999', fontSize: 12 }}>
          ✓ 没有更改
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
          {hasConflicts && (
            <div style={{
              padding: '12px', borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(255,77,79,0.06) 0%, rgba(255,120,77,0.04) 100%)',
              border: '1px solid rgba(255,77,79,0.15)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <WarningOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                <span style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 13 }}>合并冲突</span>
                <span style={{ flex: 1 }} />
                <Button size="small" danger icon={<StopOutlined />}
                  onClick={() => abortConflict().catch((e) => console.warn('放弃合并失败:', e))}
                  style={{ fontSize: 11 }}>
                  放弃合并
                </Button>
                <Button size="small" type="primary" icon={<PlayCircleOutlined />}
                  onClick={() => continueConflict().catch((e) => console.warn('继续合并失败:', e))}
                  style={{ fontSize: 11 }}>
                  解决完成
                </Button>
              </div>
              <Steps
                size="small"
                current={-1}
                items={[
                  { title: <span style={{ fontSize: 11 }}><EditOutlined /> 编辑</span> },
                  { title: <span style={{ fontSize: 11 }}><SaveOutlined /> 保存</span> },
                  { title: <span style={{ fontSize: 11 }}><CheckCircleOutlined /> 暂存</span> },
                  { title: <span style={{ fontSize: 11 }}><PlayCircleOutlined /> 继续</span> },
                ]}
              />
            </div>
          )}

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