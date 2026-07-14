import { useEffect, useMemo } from 'react';
import { Empty, Spin, Typography, List, Tag, Button, Space, Tooltip } from 'antd';
import { CloseOutlined, FileOutlined, CopyOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import type { CommitFileChange } from '../../types/git';

const { Text, Paragraph } = Typography;

const STATUS_COLOR: Record<string, string> = {
  M: '#1677ff',
  A: '#52c41a',
  D: '#ff4d4f',
  R: '#722ed1',
  C: '#13c2c2',
};

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用时静默 */ });
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  // 跳过 git show 输出开头的 commit/diff/--/index 头部，只保留 @@ 以后的 diff 体
  const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
  const body = firstHunk >= 0 ? lines.slice(firstHunk) : lines;

  return (
    <pre style={{
      margin: 0, padding: '8px 10px', fontSize: 12, lineHeight: '20px',
      fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      overflow: 'auto', height: '100%',
    }}>
      {body.map((line, i) => {
        let color = 'inherit';
        let bg = 'transparent';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          color = '#52c41a'; bg = 'rgba(82,196,26,0.08)';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          color = '#ff4d4f'; bg = 'rgba(255,77,79,0.08)';
        } else if (line.startsWith('@@')) {
          color = '#8c8c8c';
        } else if (line.startsWith('diff ') || line.startsWith('index ')) {
          color = '#8c8c8c';
        }
        return (
          <div key={i} style={{ color, background: bg, padding: '0 2px' }}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

function FileChangeItem({ change, selected, onSelect }: {
  change: CommitFileChange;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = STATUS_COLOR[change.status] ?? '#8c8c8c';
  // 跨平台路径分割：同时处理 / 和 \
  const fileName = change.path.split(/[/\\]/).pop() || change.path;
  const lastSep = Math.max(change.path.lastIndexOf('/'), change.path.lastIndexOf('\\'));
  const dir = lastSep > 0 ? change.path.substring(0, lastSep) : '';
  const isBinary = change.additions < 0;

  return (
    <List.Item
      style={{
        padding: '5px 8px', cursor: 'pointer',
        background: selected ? 'var(--ant-color-primary-bg, #e6f4ff)' : undefined,
        borderRadius: 4,
      }}
      onClick={onSelect}
    >
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 6 }}>
        <Tag style={{ margin: 0, color, borderColor: color, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
          {change.status}
        </Tag>
        <FileOutlined style={{ color: '#8c8c8c', fontSize: 12, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {fileName}
          </div>
          {dir && (
            <Text type="secondary" style={{ fontSize: 10, fontFamily: 'monospace' }}>
              {dir}
            </Text>
          )}
        </div>
        {!isBinary && (change.additions > 0 || change.deletions > 0) && (
          <Space size={2} style={{ flexShrink: 0, fontSize: 10 }}>
            {change.additions > 0 && <span style={{ color: '#52c41a' }}>+{change.additions}</span>}
            {change.deletions > 0 && <span style={{ color: '#ff4d4f' }}>-{change.deletions}</span>}
          </Space>
        )}
        {isBinary && <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>二进制</Text>}
      </div>
    </List.Item>
  );
}

export function CommitDetailPanel() {
  const selectedCommit = useRepoStore((s) => s.selectedCommit);
  const commitDetail = useRepoStore((s) => s.commitDetail);
  const commitDetailLoading = useRepoStore((s) => s.commitDetailLoading);
  const selectedCommitFile = useRepoStore((s) => s.selectedCommitFile);
  const commitFileDiff = useRepoStore((s) => s.commitFileDiff);
  const commitFileDiffLoading = useRepoStore((s) => s.commitFileDiffLoading);
  const loadCommitDetail = useRepoStore((s) => s.loadCommitDetail);
  const loadCommitFileDiff = useRepoStore((s) => s.loadCommitFileDiff);
  const setSelectedCommitFile = useRepoStore((s) => s.setSelectedCommitFile);
  const setSelectedCommit = useRepoStore((s) => s.setSelectedCommit);

  // 选中提交变化 → 加载详情
  useEffect(() => {
    if (selectedCommit) loadCommitDetail(selectedCommit);
  }, [selectedCommit, loadCommitDetail]);

  // 详情加载完成 → 默认选中第一个文件
  useEffect(() => {
    if (commitDetail && commitDetail.files.length > 0 && !selectedCommitFile) {
      setSelectedCommitFile(commitDetail.files[0].path);
    }
  }, [commitDetail, selectedCommitFile, setSelectedCommitFile]);

  // 选中文件变化 → 加载 diff
  useEffect(() => {
    if (selectedCommit && selectedCommitFile) {
      loadCommitFileDiff(selectedCommit, selectedCommitFile);
    }
  }, [selectedCommit, selectedCommitFile, loadCommitFileDiff]);

  const stats = useMemo(() => {
    if (!commitDetail) return { additions: 0, deletions: 0, files: 0 };
    let additions = 0, deletions = 0;
    for (const f of commitDetail.files) {
      if (f.additions > 0) additions += f.additions;
      if (f.deletions > 0) deletions += f.deletions;
    }
    return { additions, deletions, files: commitDetail.files.length };
  }, [commitDetail]);

  if (!selectedCommit) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Empty description="点击提交查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  if (commitDetailLoading || !commitDetail) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
      borderRadius: 10, border: '1px solid var(--ant-color-border-secondary, #333)',
      overflow: 'hidden',
    }}>
      {/* 头部：提交信息 */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--ant-color-border-secondary, #333)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text code style={{ fontSize: 11, color: '#faad14' }}>
            {commitDetail.hash.slice(0, 7)}
          </Text>
          <Tooltip title="复制完整 hash">
            <Button type="text" size="small" icon={<CopyOutlined />}
              onClick={() => copyText(commitDetail.hash)} style={{ color: '#8c8c8c' }} />
          </Tooltip>
          <Button type="text" size="small" icon={<CloseOutlined />}
            onClick={() => setSelectedCommit(null)}
            style={{ marginLeft: 'auto', color: '#8c8c8c' }} />
        </div>
        <Paragraph style={{ margin: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'pre-wrap' }}>
          {commitDetail.message}
        </Paragraph>
        <Space size={6} wrap>
          <Text type="secondary" style={{ fontSize: 11 }}>{commitDetail.author}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>·</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{commitDetail.date}</Text>
        </Space>
      </div>

      {/* 文件变更列表 */}
      <div style={{
        padding: '8px 12px 4px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          文件变更 ({stats.files})
        </Text>
        <Space size={6} style={{ fontSize: 11 }}>
          <span style={{ color: '#52c41a' }}>+{stats.additions}</span>
          <span style={{ color: '#ff4d4f' }}>-{stats.deletions}</span>
        </Space>
      </div>
      <div style={{ maxHeight: 180, overflow: 'auto', padding: '0 8px' }}>
        <List
          dataSource={commitDetail.files}
          size="small"
          split={false}
          renderItem={(change) => (
            <FileChangeItem
              change={change}
              selected={selectedCommitFile === change.path}
              onSelect={() => setSelectedCommitFile(change.path)}
            />
          )}
        />
      </div>

      {/* diff 展示 */}
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--ant-color-border-secondary, #333)', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '6px 12px', fontSize: 11, color: '#8c8c8c',
          background: 'var(--ant-color-fill-secondary, rgba(0,0,0,0.03))',
          fontFamily: 'monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {selectedCommitFile || '选择文件查看 diff'}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {commitFileDiffLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          ) : commitFileDiff ? (
            <DiffView diff={commitFileDiff} />
          ) : (
            <div style={{ textAlign: 'center', padding: 24, color: '#999', fontSize: 12 }}>
              选择上方文件查看变更
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
