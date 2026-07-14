import { useState, useMemo, useEffect, useRef } from 'react';
import { Input, Select, Button, Space, Typography, Tooltip } from 'antd';
import { SearchOutlined, ReloadOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { Graph } from './Graph';
import { CommitDetailPanel } from './CommitDetailPanel';

const { Text } = Typography;

const PAGE_SIZE = 50;
const MAX_LOG_COUNT = 1000;

export function HistoryView() {
  const logEntries = useRepoStore((s) => s.logEntries);
  const logLoading = useRepoStore((s) => s.logLoading);
  const logBranch = useRepoStore((s) => s.logBranch);
  const loadLog = useRepoStore((s) => s.loadLog);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const selectedCommit = useRepoStore((s) => s.selectedCommit);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [count, setCount] = useState(PAGE_SIZE);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 防抖：300ms 内多次输入只执行最后一次
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // 本地分支列表（远程分支不作为过滤来源）
  const branchOptions = useMemo(() => {
    const locals = repoInfo?.branches.filter((b) => !b.name.startsWith('remotes/')) ?? [];
    return [
      { value: '__all__', label: '全部分支' },
      ...locals.map((b) => ({ value: b.name, label: b.name })),
    ];
  }, [repoInfo?.branches]);

  // 前端搜索过滤（消息 / 作者 / hash）
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return logEntries;
    return logEntries.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q) ||
        e.hash.toLowerCase().includes(q),
    );
  }, [logEntries, debouncedSearch]);

  const handleBranchChange = (value: string) => {
    const branch = value === '__all__' ? null : value;
    setCount(PAGE_SIZE);
    loadLog(PAGE_SIZE, branch);
  };

  const handleLoadMore = () => {
    const next = Math.min(count + PAGE_SIZE, MAX_LOG_COUNT);
    setCount(next);
    loadLog(next, logBranch);
  };

  const handleRefresh = () => loadLog(count, logBranch);

  // 已加载到尾部：返回数量少于上次请求量
  const reachedEnd = logEntries.length < count;

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 工具栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap',
        }}>
          <Select
            size="small"
            value={logBranch ?? '__all__'}
            onChange={handleBranchChange}
            style={{ width: 180 }}
            options={branchOptions}
            showSearch
            optionFilterProp="label"
          />
          <Input
            size="small"
            allowClear
            placeholder="搜索提交 (消息/作者/hash)"
            prefix={<SearchOutlined style={{ color: '#999' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {search ? `${filtered.length} / ${logEntries.length} 条` : `${logEntries.length} 条`}
          </Text>
          <Space size={4} style={{ marginLeft: 'auto' }}>
            <Tooltip title="加载更多提交">
              <Button
                size="small"
                icon={<VerticalAlignBottomOutlined />}
                onClick={handleLoadMore}
                disabled={reachedEnd || logLoading || count >= MAX_LOG_COUNT}
                loading={logLoading}
              >
                更多
              </Button>
            </Tooltip>
            <Tooltip title="刷新">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
                loading={logLoading}
              />
            </Tooltip>
          </Space>
        </div>

        {/* 提交图 */}
        <div style={{
          flex: 1, minHeight: 0,
          background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
          borderRadius: 10, border: '1px solid var(--ant-color-border-secondary, #333)',
          padding: 8, display: 'flex', flexDirection: 'column',
        }}>
          <Graph entries={filtered} />
        </div>
      </div>

      {/* 右侧：提交详情 */}
      {selectedCommit && (
        <div style={{ width: 400, flexShrink: 0 }}>
          <CommitDetailPanel />
        </div>
      )}
    </div>
  );
}
