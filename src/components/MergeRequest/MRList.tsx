import { useState, useEffect } from 'react';
import { List, Tag, Button, Space, Select, Empty, Spin, message, Tooltip } from 'antd';
import {
  PlusOutlined, MergeOutlined, CloseCircleOutlined,
  ReloadOutlined, UserOutlined,
} from '@ant-design/icons';
import { useGitLabStore } from '../../stores/gitlabStore';
import type { GitLabMergeRequest } from '../../services/gitlab';

interface MRListProps {
  onCreateMR: () => void;
  onSelectMR: (mr: GitLabMergeRequest) => void;
}

export function MRList({ onCreateMR, onSelectMR }: MRListProps) {
  const [stateFilter, setStateFilter] = useState<'opened' | 'closed' | 'merged' | 'all'>('opened');

  const currentProject = useGitLabStore((s) => s.currentProject);
  const mergeRequests = useGitLabStore((s) => s.mergeRequests);
  const loading = useGitLabStore((s) => s.loading);
  const loadMergeRequests = useGitLabStore((s) => s.loadMergeRequests);
  const mergeMR = useGitLabStore((s) => s.mergeMR);
  const closeMR = useGitLabStore((s) => s.closeMR);

  useEffect(() => {
    if (currentProject) {
      loadMergeRequests(stateFilter);
    }
  }, [currentProject, stateFilter]);

  const handleMerge = async (mrIid: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await mergeMR(mrIid);
    if (success) {
      message.success('MR 已合并');
    }
  };

  const handleClose = async (mrIid: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await closeMR(mrIid);
    if (success) {
      message.success('MR 已关闭');
    }
  };

  const getStateTag = (state: string) => {
    switch (state) {
      case 'opened':
        return <Tag color="success">打开</Tag>;
      case 'closed':
        return <Tag color="default">关闭</Tag>;
      case 'merged':
        return <Tag color="processing">已合并</Tag>;
      default:
        return <Tag>{state}</Tag>;
    }
  };

  const getMergeStatusTag = (status: string) => {
    switch (status) {
      case 'mergeable':
        return <Tag color="success">可合并</Tag>;
      case 'checking':
        return <Tag color="processing">检查中</Tag>;
      case 'conflict':
        return <Tag color="error">有冲突</Tag>;
      case 'not_mergeable':
        return <Tag color="warning">不可合并</Tag>;
      default:
        return null;
    }
  };

  if (!currentProject) {
    return (
      <Empty
        description="请先选择项目"
        style={{ marginTop: 48 }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '12px 16px',
        background: 'var(--ant-color-fill-quaternary)',
        borderRadius: 8,
        border: '1px solid var(--ant-color-border-secondary)',
      }}>
        <Space>
          <span style={{ fontWeight: 600 }}>{currentProject.name}</span>
          <Select
            value={stateFilter}
            onChange={setStateFilter}
            size="small"
            style={{ width: 100 }}
            options={[
              { value: 'opened', label: '打开' },
              { value: 'closed', label: '关闭' },
              { value: 'merged', label: '已合并' },
              { value: 'all', label: '全部' },
            ]}
          />
        </Space>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            size="small"
            onClick={() => loadMergeRequests(stateFilter)}
            loading={loading}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={onCreateMR}
          >
            创建 MR
          </Button>
        </Space>
      </div>

      {/* MR List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Spin spinning={loading}>
          {mergeRequests.length === 0 ? (
            <Empty description="暂无 Merge Request" style={{ marginTop: 48 }} />
          ) : (
            <List
              dataSource={mergeRequests}
              renderItem={(mr) => (
                <div
                  key={mr.iid}
                  onClick={() => onSelectMR(mr)}
                  style={{
                    padding: '12px 16px',
                    marginBottom: 8,
                    borderRadius: 8,
                    border: '1px solid var(--ant-color-border-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: 'var(--ant-color-bg-container)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ant-color-primary)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ant-color-border-secondary)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 13 }}>
                          !{mr.iid}
                        </span>
                        {getStateTag(mr.state)}
                        {mr.work_in_progress && <Tag color="warning">WIP</Tag>}
                        {getMergeStatusTag(mr.detailed_merge_status || '')}
                      </div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>{mr.title}</div>
                      <Space size={4}>
                        <Tag>{mr.source_branch}</Tag>
                        <span style={{ color: 'var(--ant-color-text-tertiary)' }}>→</span>
                        <Tag>{mr.target_branch}</Tag>
                      </Space>
                    </div>

                    {mr.state === 'opened' && (
                      <Space>
                        <Tooltip title="合并">
                          <Button
                            type="primary"
                            size="small"
                            icon={<MergeOutlined />}
                            onClick={(e) => handleMerge(mr.iid, e)}
                            disabled={mr.detailed_merge_status !== 'mergeable'}
                          />
                        </Tooltip>
                        <Tooltip title="关闭">
                          <Button
                            danger
                            size="small"
                            icon={<CloseCircleOutlined />}
                            onClick={(e) => handleClose(mr.iid, e)}
                          />
                        </Tooltip>
                      </Space>
                    )}
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginTop: 8, fontSize: 12, color: 'var(--ant-color-text-tertiary)',
                  }}>
                    <Space size={4}>
                      <UserOutlined />
                      <span>{mr.author?.name || '未知'}</span>
                    </Space>
                    <span>•</span>
                    <span>{new Date(mr.created_at).toLocaleDateString()}</span>
                    {(mr.user_notes_count ?? 0) > 0 && (
                      <>
                        <span>•</span>
                        <span>{mr.user_notes_count} 条评论</span>
                      </>
                    )}
                    {(mr.labels?.length ?? 0) > 0 && (
                      <>
                        <span>•</span>
                        {mr.labels?.map((label) => (
                          <Tag key={label} style={{ margin: 0 }}>{label}</Tag>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            />
          )}
        </Spin>
      </div>
    </div>
  );
}
