import { useState } from 'react';
import { Select, Space, Input, Button, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useGitLabStore } from '../../stores/gitlabStore';
import type { GitLabProject } from '../../services/gitlab';

interface ProjectSelectorProps {
  onSelect: (project: GitLabProject) => void;
}

export function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const projects = useGitLabStore((s) => s.projects);
  const currentProject = useGitLabStore((s) => s.currentProject);
  const searchProjects = useGitLabStore((s) => s.searchProjects);
  const selectProject = useGitLabStore((s) => s.selectProject);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      await searchProjects(searchQuery);
    } catch (e) {
      message.error('搜索项目失败');
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (projectId: number) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      selectProject(project);
      onSelect(project);
    }
  };

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--ant-color-fill-quaternary)',
      borderRadius: 8,
      border: '1px solid var(--ant-color-border-secondary)',
      marginBottom: 16,
    }}>
      <div style={{ marginBottom: 8, fontWeight: 500 }}>选择项目</div>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索 GitLab 项目..."
          onPressEnter={handleSearch}
          prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
        />
        <Button
          icon={<SearchOutlined />}
          onClick={handleSearch}
          loading={searching}
        >
          搜索
        </Button>
      </Space.Compact>

      {projects.length > 0 && (
        <Select
          style={{ width: '100%', marginTop: 8 }}
          placeholder="选择项目"
          value={currentProject?.id}
          onChange={handleSelect}
          options={projects.map((p) => ({
            value: p.id,
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{p.name}</span>
                <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
                  {p.path_with_namespace}
                </span>
              </div>
            ),
          }))}
          showSearch
          filterOption={(input, option) => {
            const project = projects.find((p) => p.id === option?.value);
            if (!project) return false;
            return (
              project.name.toLowerCase().includes(input.toLowerCase()) ||
              project.path_with_namespace.toLowerCase().includes(input.toLowerCase())
            );
          }}
        />
      )}
    </div>
  );
}
