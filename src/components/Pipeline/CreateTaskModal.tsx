import { useState, useEffect, useMemo } from 'react';
import { Form, Input, Switch, Select, Space, Tag, Tooltip, Modal, theme, message } from 'antd';
import { BranchesOutlined, RocketOutlined, MedicineBoxOutlined, BugOutlined } from '@ant-design/icons';
import { usePipelineStore, type TaskType, type VersionType } from '../../stores/pipelineStore';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { useBranchTagStore } from '../../stores/branchTagStore';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateTaskModal({ open, onClose }: CreateTaskModalProps) {
  const [form] = Form.useForm();
  const createTask = usePipelineStore((s) => s.createTask);
  const startTask = usePipelineStore((s) => s.startTask);
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const repoPath = useRepoStore((s) => s.repoPath);
  const getTargetBranch = useBranchTagStore((s) => s.getTargetBranch);
  const setSelectedFile = useViewStore((s) => s.setSelectedFile);
  const { token } = theme.useToken();

  const [branchPrefix, setBranchPrefix] = useState('feature');
  const [latestTag, setLatestTag] = useState<string | null>(null);

  const taskName = Form.useWatch('name', form) || '';
  const branchSuffix = Form.useWatch('branchSuffix', form) || '';

  // 根据分支前缀判断任务类型
  const taskType: TaskType = branchPrefix === 'feature' ? 'feature' : 'version';
  const versionType: VersionType = branchPrefix === 'hotfix' ? 'hotfix' : 'release';
  const isVersion = branchPrefix === 'release' || branchPrefix === 'hotfix';

  const remoteBranches = (repoInfo?.branches || [])
    .filter((b) => b.name.startsWith('remotes/'))
    .map((b) => b.name.replace(/^remotes\/[^/]+\//, ''))
    .filter((name, i, arr) => arr.indexOf(name) === i);

  const targetBranch = repoPath ? getTargetBranch(repoPath) : null;
  const hasTargetBranch = targetBranch && remoteBranches.includes(targetBranch);

  // 检查是否有主干分支标签
  const mainlineBranch = useMemo(() => {
    if (!repoPath) return null;
    const tags = useBranchTagStore.getState().getTagsForRepo(repoPath);
    const mainlineTag = tags.find(t => t.tag === 'mainline');
    return mainlineTag?.branchName || null;
  }, [repoPath]);

  const hasMainlineBranch = mainlineBranch && remoteBranches.includes(mainlineBranch);

  // 获取最新 tag
  useEffect(() => {
    if (!repoPath || !isVersion) return;

    const fetchLatestTag = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const tags = await invoke<string>('git_tag_list', { repoPath });
        const tagList = tags.split('\n').filter(t => t.trim());
        const versionTags = tagList
          .filter(t => /^v?\d+\.\d+\.\d+/.test(t))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        setLatestTag(versionTags[0] || null);
      } catch (e) {
        console.warn('获取 tag 列表失败:', e);
        setLatestTag(null);
      }
    };

    fetchLatestTag();
  }, [repoPath, isVersion]);

  // 计算建议版本号
  const suggestedVersion = useMemo(() => {
    if (!latestTag) return 'v1.0.0';

    const match = latestTag.match(/^(v?)(\d+)\.(\d+)\.(\d+)/);
    if (!match) return 'v1.0.0';

    const [, prefix, major, minor, patch] = match;
    if (branchPrefix === 'release') {
      return `${prefix}${major}.${parseInt(minor) + 1}.0`;
    } else {
      return `${prefix}${major}.${minor}.${parseInt(patch) + 1}`;
    }
  }, [latestTag, branchPrefix]);

  // 当分支前缀变化时，自动填充建议版本号和任务名称
  useEffect(() => {
    if (isVersion) {
      const defaultName = branchPrefix === 'release'
        ? `Release ${suggestedVersion}`
        : `Hotfix ${suggestedVersion}`;
      form.setFieldsValue({
        branchSuffix: suggestedVersion,
        name: defaultName,
      });
    } else {
      form.setFieldsValue({ branchSuffix: undefined });
    }
  }, [branchPrefix, suggestedVersion, form, isVersion]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();

      if (!hasTargetBranch) {
        message.error('请先在分支界面标记一个开发分支');
        return;
      }
      if (isVersion) {
        if (!hasMainlineBranch) {
          message.error('请先在分支界面标记一个主干分支');
          return;
        }
        if (!values.branchSuffix) {
          message.error('请填写版本号');
          return;
        }
        if (branchPrefix === 'hotfix' && !latestTag) {
          message.error('主干分支没有版本标签，请先创建 Release');
          return;
        }
      }

      // 分支后缀：版本任务用版本号，feature 用任务名称
      const suffix = isVersion
        ? (values.branchSuffix || '').replace(/[^a-zA-Z0-9.-]/g, '')
        : (values.branchSuffix || values.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-龥-]/g, ''));
      const branchName = `${branchPrefix}/${suffix}`;

      const mrTargetBranch = isVersion ? mainlineBranch! : targetBranch!;

      const task = createTask({
        name: values.name,
        taskType,
        versionType: isVersion ? versionType : undefined,
        branchName,
        version: isVersion ? values.branchSuffix : undefined,
        syncStrategy: values.syncStrategy,
        mrSettings: {
          enabled: true,
          squash: values.squash,
          deleteBranchAfterMerge: values.deleteBranch,
          autoMerge: values.autoMerge,
          targetBranch: mrTargetBranch,
        },
      });
      if (!task) return;
      form.resetFields();
      setSelectedFile(null);
      onClose();
      await startTask(task.id);
    } catch {
      // validation failed
    }
  };

  const prefixOptions = [
    { value: 'feature', label: <span><RocketOutlined /> feature</span> },
    { value: 'release', label: <span><MedicineBoxOutlined /> release</span> },
    { value: 'hotfix', label: <span><BugOutlined /> hotfix</span> },
  ];

  return (
    <Modal
      title="新建任务"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="创建并开始"
      cancelText="取消"
      width={480}
      okButtonProps={{
        disabled: !hasTargetBranch || (isVersion && !hasMainlineBranch),
      }}
    >
      {remoteBranches.length === 0 && (
        <div style={{
          padding: '10px 12px', marginBottom: 16,
          background: token.colorWarningBg,
          borderRadius: 8, border: `1px solid ${token.colorWarningBorder}`,
          fontSize: 13, color: token.colorWarningText,
        }}>
          ⚠️ 未检测到远程分支，请先推送代码到远程仓库
        </div>
      )}
      <Form form={form} layout="vertical" initialValues={{
        syncStrategy: 'rebase',
        squash: true,
        deleteBranch: true,
        autoMerge: true,
      }} autoComplete="off">
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
          <Input placeholder={isVersion ? '例：v1.1.0 发版' : '例：用户登录功能'} autoComplete="off" />
        </Form.Item>

        {/* 分支名称：前缀选择 + 后缀输入（版本任务的后缀就是版本号） */}
        <Form.Item label="分支名称" required>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              value={branchPrefix}
              onChange={(v) => setBranchPrefix(v)}
              options={prefixOptions}
              style={{ width: 120 }}
              popupMatchSelectWidth={false}
            />
            <Form.Item name="branchSuffix" noStyle
              rules={isVersion ? [{ required: true, message: '请输入版本号' }] : undefined}
            >
              <Input
                style={{ flex: 1 }}
                placeholder={isVersion ? '输入版本号，如 v1.1.0' : '留空则使用任务名称'}
                autoComplete="off"
              />
            </Form.Item>
          </Space.Compact>
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
            完整分支名：{branchPrefix}/{isVersion ? (branchSuffix || '...').replace(/[^a-zA-Z0-9.-]/g, '') : (branchSuffix || taskName || '...')}
          </div>
        </Form.Item>

        {/* 版本任务提示 */}
        {isVersion && (
          <div style={{
            padding: '8px 12px', marginBottom: 16,
            background: branchPrefix === 'hotfix' && !latestTag ? token.colorWarningBg : token.colorFillQuaternary,
            borderRadius: 8, border: `1px solid ${branchPrefix === 'hotfix' && !latestTag ? token.colorWarningBorder : token.colorBorderSecondary}`,
            fontSize: 12, color: branchPrefix === 'hotfix' && !latestTag ? token.colorWarningText : token.colorTextSecondary,
          }}>
            {latestTag ? (
              <>
                <div>📌 当前最新版本：<Tag color="blue" style={{ margin: 0 }}>{latestTag}</Tag></div>
                <div style={{ marginTop: 4 }}>建议版本号：<Tag color="green" style={{ margin: 0 }}>{suggestedVersion}</Tag></div>
              </>
            ) : branchPrefix === 'hotfix' ? (
              <div>⚠️ 未检测到版本标签，无法创建 Hotfix，请先创建 Release</div>
            ) : (
              <>
                <div>📌 未检测到版本标签，首次发版</div>
                <div style={{ marginTop: 4 }}>建议版本号：<Tag color="green" style={{ margin: 0 }}>{suggestedVersion}</Tag></div>
              </>
            )}
          </div>
        )}

        {/* 目标分支信息 */}
        <div style={{ marginBottom: 16 }}>
          {isVersion ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 6, color: token.colorTextSecondary }}>主干分支（MR→main）</div>
                {hasMainlineBranch ? (
                  <Tag color="red" icon={<BranchesOutlined />} style={{ margin: 0 }}>🏗️ {mainlineBranch}</Tag>
                ) : (
                  <Tooltip title="请先在分支界面将一个分支标记为「🏗️ 主干分支」">
                    <Tag color="warning" style={{ margin: 0, cursor: 'pointer' }}>⚠️ 未设置主干分支</Tag>
                  </Tooltip>
                )}
              </div>
              <div>
                <div style={{ fontSize: 13, marginBottom: 6, color: token.colorTextSecondary }}>开发分支（MR→develop）</div>
                {hasTargetBranch ? (
                  <Tag color="blue" icon={<BranchesOutlined />} style={{ margin: 0 }}>🔗 {targetBranch}</Tag>
                ) : (
                  <Tooltip title="请先在分支界面将一个分支标记为「🔗 开发分支」">
                    <Tag color="warning" style={{ margin: 0, cursor: 'pointer' }}>⚠️ 未设置开发分支</Tag>
                  </Tooltip>
                )}
              </div>
              <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 8 }}>
                流程：创建 MR → 等待合并 → 标记版本
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, marginBottom: 6, color: token.colorTextSecondary }}>目标分支</div>
              {hasTargetBranch ? (
                <Tag color="blue" icon={<BranchesOutlined />} style={{ margin: 0 }}>🔗 {targetBranch}</Tag>
              ) : (
                <Tooltip title="请先在分支界面将一个分支标记为「🔗 开发分支」">
                  <Tag color="warning" style={{ margin: 0, cursor: 'pointer' }}>⚠️ 未设置</Tag>
                </Tooltip>
              )}
              <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
                创建分支、同步远程、创建MR 都基于此分支
              </div>
            </>
          )}
        </div>

        {/* 同步策略（仅 feature） */}
        {!isVersion && (
          <Form.Item name="syncStrategy" label="同步策略">
            <Select options={[
              { value: 'rebase', label: 'Rebase（变基，历史干净）' },
              { value: 'merge', label: 'Merge（合并，保留历史）' },
            ]} />
          </Form.Item>
        )}

        {/* MR 设置 */}
        <div style={{
          padding: '12px', marginBottom: 16,
          background: token.colorFillQuaternary,
          borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <div style={{ fontWeight: 500, marginBottom: 12, fontSize: 13 }}>MR 设置</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>Squash 提交</span>
            <Form.Item name="squash" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>合并后删除分支</span>
            <Form.Item name="deleteBranch" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>自动合并</span>
            <Form.Item name="autoMerge" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  );
}
