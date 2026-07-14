import { useState, useEffect } from 'react';
import { message } from 'antd';
import { useGitLabStore } from '../../stores/gitlabStore';
import { ProjectSelector } from './ProjectSelector';
import { MRList } from './MRList';
import { MRDetail } from './MRDetail';
import { CreateMRModal } from './CreateMRModal';
import type { GitLabMergeRequest } from '../../services/gitlab';

export function MRPage() {
  const [createMRVisible, setCreateMRVisible] = useState(false);

  const init = useGitLabStore((s) => s.init);
  const service = useGitLabStore((s) => s.service);
  const selectedMR = useGitLabStore((s) => s.selectedMR);
  const selectMR = useGitLabStore((s) => s.selectMR);
  const error = useGitLabStore((s) => s.error);
  const clearError = useGitLabStore((s) => s.clearError);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (error) {
      message.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleSelectMR = (mr: GitLabMergeRequest) => {
    selectMR(mr);
  };

  const handleBack = () => {
    selectMR(null);
  };

  if (!service) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '70vh', gap: 16,
      }}>
        <div style={{ fontSize: 48 }}>🔗</div>
        <div style={{ fontSize: 16, fontWeight: 500 }}>请先配置 GitLab 连接</div>
        <div style={{ color: 'var(--ant-color-text-tertiary)' }}>
          在设置中配置 GitLab URL 和 Personal Access Token
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Project Selector */}
      <ProjectSelector />

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {selectedMR ? (
          <MRDetail mr={selectedMR} onBack={handleBack} />
        ) : (
          <MRList
            onCreateMR={() => setCreateMRVisible(true)}
            onSelectMR={handleSelectMR}
          />
        )}
      </div>

      {/* Create MR Modal */}
      <CreateMRModal
        open={createMRVisible}
        onClose={() => setCreateMRVisible(false)}
      />
    </div>
  );
}
