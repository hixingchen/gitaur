import { Spin, Empty, Segmented, Button, Checkbox } from 'antd';
import {
  ReloadOutlined,
} from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { useMemo, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

function statusLabel(c: string): string {
  const m: Record<string, string> = { M: '修改', A: '新增', D: '删除', R: '重命名', '?': '新增' };
  return m[c] || c;
}

const statusCfg: Record<string, { label: string; color: string }> = {
  M: { label: 'M', color: '#faad14' },
  A: { label: 'A', color: '#52c41a' },
  D: { label: 'D', color: '#ff4d4f' },
  R: { label: 'R', color: '#1890ff' },
  '?': { label: '?', color: '#8c8c8c' },
};

type FileInfo = { path: string; status: string; staged: boolean };

// 单行文件 — 不使用 memo，让父组件控制渲染
function FileItem({
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
  const parts = file.path.split('/');
  const name = parts.pop() || file.path;
  const dir = parts.join('/');

  const handleCheckboxChange = (e: any) => {
    e.stopPropagation();
    onToggle(file.path);
  };

  const handleRowClick = () => {
    onSelect(file.path);
  };

  return (
    <div
      className={isSelected ? 'file-item selected' : 'file-item'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }}
      onClick={handleRowClick}
    >
      <Checkbox checked={file.staged}
        onChange={handleCheckboxChange} style={{ margin: 0, flexShrink: 0 }} />
      <span style={{
        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${isConflict ? '#ff4d4f' : cfg.color}15`,
        color: isConflict ? '#ff4d4f' : cfg.color,
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
}

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
  const abortRebase = useRepoStore((s) => s.abortRebase);
  const rebaseContinue = useRepoStore((s) => s.rebaseContinue);
  const refreshStatus = useRepoStore((s) => s.refreshStatus);
  const [hasConflicts, setHasConflicts] = useState(false);

  useEffect(() => {
    if (!repoInfo) return;
    invoke<{ hasConflicts: boolean }>('check_conflicts', {
      repoPath: repoInfo.path,
    }).then((r) => setHasConflicts(r.hasConflicts)).catch(() => setHasConflicts(false));
  }, [repoInfo]);

  const files = useMemo(() => repoInfo?.status ?? [], [repoInfo]);
  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files]);

  // 切换文件的暂存状态：使用 path 直接操作 store
  const handleToggleFile = (path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file) return;
    if (file.staged) {
      unstageFile(path);
    } else {
      stageFile(path);
    }
  };

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
              padding: '8px 10px', borderRadius: 8,
              background: 'rgba(255,77,79,0.08)', border: '1px solid rgba(255,77,79,0.2)',
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
            }}>
              <span style={{ color: '#ff4d4f', fontWeight: 600 }}>⚠ 合并冲突</span>
              <span style={{ flex: 1, color: '#999' }}>编辑文件 → 保存 → 暂存 → 继续</span>
              <Button size="small" type="link" danger style={{ fontSize: 11, padding: 0 }}
                onClick={() => abortRebase().then(refreshStatus)}>放弃</Button>
              <Button size="small" type="primary" style={{ fontSize: 11 }}
                onClick={() => rebaseContinue().then(refreshStatus)}>继续</Button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflow: 'auto' }}>
            {/* 暂存的更改 */}
            {stagedFiles.length > 0 && (
              <div>
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
                {stagedFiles.map((f) => (
                  <FileItem
                    key={f.path}
                    file={f}
                    hasConflicts={hasConflicts}
                    onSelect={onSelectFile || (() => {})}
                    onToggle={handleToggleFile}
                  />
                ))}
              </div>
            )}

            {/* 未暂存的更改 */}
            {unstagedFiles.length > 0 && (
              <div>
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
                {unstagedFiles.map((f) => (
                  <FileItem
                    key={f.path}
                    file={f}
                    hasConflicts={hasConflicts}
                    onSelect={onSelectFile || (() => {})}
                    onToggle={handleToggleFile}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}