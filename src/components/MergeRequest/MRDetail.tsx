import { useState, useEffect } from 'react';
import { Card, Tag, Button, Space, Input, List, message, Divider, Spin } from 'antd';
import {
  ArrowLeftOutlined, MergeOutlined, CloseCircleOutlined,
  CheckCircleOutlined, SendOutlined, UserOutlined,
} from '@ant-design/icons';
import { useGitLabStore } from '../../stores/gitlabStore';
import type { GitLabMergeRequest, GitLabNote } from '../../services/gitlab';
import { GitLabService } from '../../services/gitlab';
import { useSettingsStore } from '../../stores/settingsStore';

interface MRDetailProps {
  mr: GitLabMergeRequest;
  onBack: () => void;
}

export function MRDetail({ mr, onBack }: MRDetailProps) {
  const [comment, setComment] = useState('');
  const [notes, setNotes] = useState<GitLabNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currentProject = useGitLabStore((s) => s.currentProject);
  const mergeMR = useGitLabStore((s) => s.mergeMR);
  const closeMR = useGitLabStore((s) => s.closeMR);
  const approveMR = useGitLabStore((s) => s.approveMR);
  const refreshMR = useGitLabStore((s) => s.refreshMR);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    loadNotes();
  }, [mr.iid]);

  const loadNotes = async () => {
    if (!currentProject || !settings.gitlabUrl || !settings.gitlabToken) return;

    setLoadingNotes(true);
    try {
      const service = new GitLabService({
        url: settings.gitlabUrl,
        token: settings.gitlabToken,
      });
      const fetchedNotes = await service.getNotes(
        currentProject.path_with_namespace,
        mr.iid
      );
      setNotes(fetchedNotes.filter((n) => !n.system));
    } catch (e) {
      console.error('加载评论失败:', e);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleMerge = async (squash = false) => {
    const success = await mergeMR(mr.iid, squash);
    if (success) {
      message.success('MR 已合并');
      onBack();
    }
  };

  const handleClose = async () => {
    const success = await closeMR(mr.iid);
    if (success) {
      message.success('MR 已关闭');
      onBack();
    }
  };

  const handleApprove = async () => {
    const success = await approveMR(mr.iid);
    if (success) {
      message.success('已审批');
      refreshMR();
    }
  };

  const handleSubmitComment = async () => {
    if (!comment.trim() || !currentProject || !settings.gitlabUrl || !settings.gitlabToken) return;

    setSubmitting(true);
    try {
      const service = new GitLabService({
        url: settings.gitlabUrl,
        token: settings.gitlabToken,
      });
      await service.createNote(
        currentProject.path_with_namespace,
        mr.iid,
        comment
      );
      setComment('');
      await loadNotes();
      message.success('评论已提交');
    } catch (e) {
      message.error('提交评论失败');
    } finally {
      setSubmitting(false);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16, padding: '12px 16px',
        background: 'var(--ant-color-fill-quaternary)',
        borderRadius: 8,
        border: '1px solid var(--ant-color-border-secondary)',
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--ant-color-text-tertiary)' }}>!{mr.iid}</span>
            {getStateTag(mr.state)}
            {mr.work_in_progress && <Tag color="warning">WIP</Tag>}
            {getMergeStatusTag(mr.detailed_merge_status || '')}
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, marginTop: 4 }}>{mr.title}</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Info */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12, marginBottom: 4 }}>
                分支
              </div>
              <Space>
                <Tag>{mr.source_branch}</Tag>
                <span>→</span>
                <Tag>{mr.target_branch}</Tag>
              </Space>
            </div>
            <div>
              <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12, marginBottom: 4 }}>
                作者
              </div>
              <Space>
                <UserOutlined />
                <span>{mr.author?.name || '未知'}</span>
              </Space>
            </div>
            <div>
              <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12, marginBottom: 4 }}>
                创建时间
              </div>
              <span>{new Date(mr.created_at).toLocaleString()}</span>
            </div>
            <div>
              <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12, marginBottom: 4 }}>
                审批状态
              </div>
              <span>
                {(mr.approvals_left ?? 0) > 0
                  ? `还需 ${mr.approvals_left} 人审批`
                  : '已通过'}
              </span>
            </div>
          </div>

          {mr.description && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12, marginBottom: 4 }}>
                描述
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{mr.description}</div>
            </>
          )}
        </Card>

        {/* Actions */}
        {mr.state === 'opened' && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space>
              <Button
                type="primary"
                icon={<MergeOutlined />}
                onClick={() => handleMerge(false)}
                disabled={mr.detailed_merge_status !== 'mergeable'}
              >
                合并
              </Button>
              <Button
                icon={<MergeOutlined />}
                onClick={() => handleMerge(true)}
                disabled={mr.detailed_merge_status !== 'mergeable'}
              >
                Squash 合并
              </Button>
              <Button
                icon={<CheckCircleOutlined />}
                onClick={handleApprove}
              >
                审批
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={handleClose}
              >
                关闭
              </Button>
            </Space>
          </Card>
        )}

        {/* Comments */}
        <Card
          size="small"
          title={`评论 (${notes.length})`}
          style={{ marginBottom: 16 }}
        >
          <Spin spinning={loadingNotes}>
            {notes.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ant-color-text-tertiary)', padding: 16 }}>
                暂无评论
              </div>
            ) : (
              <List
                dataSource={notes}
                renderItem={(note) => (
                  <div
                    key={note.id}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid var(--ant-color-border-secondary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Space>
                        <UserOutlined />
                        <span style={{ fontWeight: 500 }}>{note.author.name}</span>
                      </Space>
                      <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
                        {new Date(note.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{note.body}</div>
                  </div>
                )}
              />
            )}
          </Spin>
        </Card>

        {/* Add Comment */}
        <Card size="small" title="添加评论">
          <Input.TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="输入评论..."
            rows={4}
            style={{ marginBottom: 8 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSubmitComment}
            loading={submitting}
            disabled={!comment.trim()}
          >
            提交评论
          </Button>
        </Card>
      </div>
    </div>
  );
}
