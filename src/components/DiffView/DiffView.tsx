import { useEffect, useState, useRef } from 'react';
import { Spin, Empty, Typography, Button, Segmented, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useRepoStore } from '../../stores/repoStore';
import { useViewStore } from '../../stores/viewStore';
import { DiffEditor } from '@monaco-editor/react';
import Editor from '@monaco-editor/react';
import { invoke } from '@tauri-apps/api/core';

const { Text } = Typography;

function detectLang(fn: string): string {
  const ext = fn.split('.').pop()?.toLowerCase() || '';
  const m: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
    md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java',
    yaml: 'yaml', yml: 'yaml', sql: 'sql', sh: 'shell',
  };
  return m[ext] || 'plaintext';
}

// Monaco 公共选项 — 关闭不必要的特性以节省内存
const baseOptions = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 22,
  lineNumbers: 'on' as const,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 3,
  renderLineHighlight: 'none' as const,
  occurrencesHighlight: 'off' as const,
  selectionHighlight: false,
  folding: false,
  glyphMargin: false,
  hideCursorInOverviewRuler: true,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  padding: { top: 8, bottom: 8 },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  hover: { enabled: false },
  links: false,
  contextmenu: false,
};

export function DiffView() {
  const repoInfo = useRepoStore((s) => s.repoInfo);
  const selectedFile = useViewStore((s) => s.selectedFile);
  const stageFile = useRepoStore((s) => s.stageFile);
  const [headText, setHeadText] = useState('');
  const [workText, setWorkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const editorRef = useRef<any>(null);

  // 切换文件时清理旧数据，避免闪烁
  useEffect(() => {
    if (!selectedFile || !repoInfo) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const head = await invoke<string>('get_file_content', {
          repoPath: repoInfo.path, filePath: selectedFile, revision: 'HEAD',
        });
        if (cancelled) return;
        setHeadText(head);
      } catch {
        if (!cancelled) setHeadText('');
      }
      try {
        const work = await invoke<string>('read_working_file', {
          repoPath: repoInfo.path, filePath: selectedFile,
        });
        if (cancelled) return;
        setWorkText(work);
        setEditMode(work.includes('<<<<<<<') && work.includes('>>>>>>>'));
        if (work.includes('<<<<<<<')) setEditContent(work);
      } catch {
        if (!cancelled) setWorkText('');
      }
      if (!cancelled) setLoading(false);
    })();

    // 清理旧 Monaco 模型
    return () => {
      cancelled = true;
      try {
        editorRef.current?.getModel()?.dispose();
        editorRef.current = null;
      } catch { /* ignore */ }
    };
  }, [selectedFile, repoInfo?.path]);

  const handleSave = async () => {
    if (!repoInfo || !selectedFile) return;
    setSaving(true);
    try {
      await invoke('write_working_file', {
        repoPath: repoInfo.path, filePath: selectedFile, content: editContent,
      });
      await stageFile(selectedFile);
      setWorkText(editContent);
      setEditMode(false);
      message.success('已保存并暂存');
    } catch (e) {
      message.error(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (!repoInfo) return <Empty description="未打开仓库" />;

  if (!selectedFile) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: 'var(--ant-color-fill-secondary, rgba(255,255,255,0.04))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ opacity: 0.25 }}>
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ant-color-text-tertiary, #888)' }}>
          选择文件查看变更
        </div>
      </div>
    );
  }

  const fn = selectedFile.split('/').pop() || selectedFile;
  const fd = selectedFile.includes('/') ? selectedFile.substring(0, selectedFile.lastIndexOf('/')) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
        borderRadius: '8px 8px 0 0',
        border: '1px solid var(--ant-color-border-secondary, #333)',
        borderBottom: 'none',
      }}>
        <Text strong style={{ fontSize: 13, fontFamily: 'monospace' }}>{fn}</Text>
        {fd && <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{fd}</Text>}
        {!editMode && (
          <Segmented size="small"
            value={sideBySide ? 'split' : 'unified'}
            onChange={(v) => setSideBySide(v === 'split')}
            options={[
              { label: '并排', value: 'split' },
              { label: '内联', value: 'unified' },
            ]}
            style={{ marginLeft: 'auto', fontSize: 11 }}
          />
        )}
        <Text type="secondary" style={{ fontSize: 11, marginLeft: editMode ? 'auto' : 0 }}>
          {editMode ? '⚠ 冲突 — 编辑解决后保存' : 'HEAD ← 工作区'}
        </Text>
        {editMode && (
          <Button size="small" type="primary" icon={<SaveOutlined />}
            loading={saving} onClick={handleSave} style={{ marginLeft: 4 }}>
            保存
          </Button>
        )}
      </div>

      {loading && !headText && !workText ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--ant-color-border-secondary, #333)',
          borderTop: 'none', borderRadius: '0 0 8px 8px',
        }}><Spin /></div>
      ) : editMode ? (
        <div style={{
          flex: 1, minHeight: 0,
          border: '1px solid var(--ant-color-border-secondary, #333)',
          borderRadius: '0 0 8px 8px', overflow: 'hidden',
        }}>
          <Editor
            height="100%"
            language={detectLang(selectedFile)}
            value={editContent}
            onChange={(v) => setEditContent(v || '')}
            theme="vs-dark"
            onMount={(editor) => { editorRef.current = editor; }}
            options={{
              ...baseOptions,
              readOnly: false,
              wordWrap: 'on',
            }}
          />
        </div>
      ) : (
        <div style={{
          flex: 1, minHeight: 0,
          border: '1px solid var(--ant-color-border-secondary, #333)',
          borderRadius: '0 0 8px 8px', overflow: 'hidden',
        }}>
          <DiffEditor
            height="100%"
            language={detectLang(selectedFile)}
            original={headText}
            modified={workText}
            theme="vs-dark"
            keepCurrentOriginalModel={false}
            keepCurrentModifiedModel={false}
            options={{
              ...baseOptions,
              renderSideBySide: sideBySide,
              ignoreTrimWhitespace: false,
              renderIndicators: true,
              diffWordWrap: 'on',
            }}
          />
        </div>
      )}
    </div>
  );
}
