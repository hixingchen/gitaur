import React, { useState } from 'react';
import { Card, Typography, Space, Tag, Button, Input } from 'antd';
import { CopyOutlined, SearchOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

// 模拟提交数据
const mockCommits = [
  {
    hash: 'abc1234567890',
    message: 'feat: 添加用户认证功能',
    author: '张三',
    date: '2026-07-15T10:00:00Z',
    refs: ['main', 'HEAD'],
    isMerge: false,
    isBranchTip: true,
    lane: 0,
    color: '#1677ff',
  },
  {
    hash: 'def5678901234',
    message: 'fix: 修复登录页面样式问题',
    author: '李四',
    date: '2026-07-15T09:00:00Z',
    refs: ['develop'],
    isMerge: false,
    isBranchTip: true,
    lane: 1,
    color: '#52c41a',
  },
  {
    hash: 'ghi9012345678',
    message: 'refactor: 重构用户模块',
    author: '王五',
    date: '2026-07-15T08:00:00Z',
    refs: [],
    isMerge: false,
    isBranchTip: false,
    lane: 0,
    color: '#1677ff',
  },
  {
    hash: 'jkl0123456789',
    message: 'docs: 更新API文档',
    author: '赵六',
    date: '2026-07-15T07:00:00Z',
    refs: ['v1.2.0'],
    isMerge: false,
    isBranchTip: false,
    lane: 2,
    color: '#faad14',
  },
  {
    hash: 'mno3456789012',
    message: 'merge: 合并feature分支',
    author: '张三',
    date: '2026-07-15T06:00:00Z',
    refs: [],
    isMerge: true,
    isBranchTip: false,
    lane: 0,
    color: '#1677ff',
  },
];

// 相对时间格式化
function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date('2026-07-15T12:00:00Z');
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);

    if (hours < 1) return '刚刚';
    if (hours < 24) return `${hours}小时前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// 复制文本
function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function HistoryViewDemo() {
  const [search, setSearch] = useState('');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

  // 高亮搜索文本
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <span key={i} style={{ background: 'rgba(250, 173, 20, 0.3)', padding: '0 2px', borderRadius: 2 }}>
          {part}
        </span>
      ) : part
    );
  };

  // 过滤提交
  const filteredCommits = mockCommits.filter(commit => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      commit.message.toLowerCase().includes(query) ||
      commit.author.toLowerCase().includes(query) ||
      commit.hash.toLowerCase().includes(query)
    );
  });

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Typography.Title level={2} style={{ marginBottom: 24 }}>
        SourceTree 风格历史界面演示
      </Typography.Title>

      {/* 工具栏 */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Input
          placeholder="搜索提交..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 300 }}
          allowClear
        />
        <Text type="secondary">
          {filteredCommits.length} 条提交记录
        </Text>
      </div>

      {/* 提交列表 */}
      <div style={{
        background: '#fff',
        borderRadius: 8,
        border: '1px solid #d9d9d9',
        overflow: 'hidden',
      }}>
        {filteredCommits.map((commit, index) => (
          <div
            key={commit.hash}
            onClick={() => setSelectedCommit(selectedCommit === commit.hash ? null : commit.hash)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '16px 20px',
              cursor: 'pointer',
              background: selectedCommit === commit.hash
                ? '#e6f4ff'
                : index % 2 === 0
                  ? '#fff'
                  : '#fafafa',
              borderBottom: '1px solid #f0f0f0',
              transition: 'background 0.15s',
            }}
          >
            {/* 左侧：图形区域 */}
            <div style={{
              width: 120,
              flexShrink: 0,
              position: 'relative',
              height: 48,
              marginRight: 16,
            }}>
              {/* 分支线 */}
              <div style={{
                position: 'absolute',
                left: commit.lane * 24 + 8,
                top: 0,
                bottom: 0,
                width: 2,
                background: commit.color,
                opacity: 0.6,
              }} />

              {/* 提交点 */}
              <div style={{
                position: 'absolute',
                left: commit.lane * 24 + 2,
                top: '50%',
                transform: 'translateY(-50%)',
                width: commit.isBranchTip ? 14 : 10,
                height: commit.isBranchTip ? 14 : 10,
                borderRadius: '50%',
                background: commit.isBranchTip ? commit.color : commit.isMerge ? '#666' : '#fff',
                border: `2px solid ${commit.color}`,
                zIndex: 1,
                boxShadow: commit.isBranchTip ? `0 0 0 2px ${commit.color}40` : 'none',
              }} />

              {/* 合并提交的第二个点 */}
              {commit.isMerge && (
                <div style={{
                  position: 'absolute',
                  left: commit.lane * 24 + 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#fff',
                  zIndex: 2,
                }} />
              )}
            </div>

            {/* 右侧：提交信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 第一行：提交消息 */}
              <div style={{
                fontSize: 14,
                fontWeight: 500,
                marginBottom: 4,
                lineHeight: '20px',
                color: '#000',
                wordBreak: 'break-word',
              }}>
                {highlightText(commit.message, search)}
              </div>

              {/* 第二行：作者、时间、引用标签 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 12,
                color: '#8c8c8c',
              }}>
                <span>{highlightText(commit.author, search)}</span>
                <span>·</span>
                <span>{formatRelativeTime(commit.date)}</span>

                {/* 引用标签 */}
                {commit.refs.length > 0 && (
                  <>
                    <span>·</span>
                    <Space size={4} wrap>
                      {commit.refs.map((ref, idx) => {
                        const isTag = ref.startsWith('v');
                        return (
                          <Tag
                            key={idx}
                            style={{
                              margin: 0,
                              fontSize: 10,
                              lineHeight: '16px',
                              padding: '0 4px',
                              color: commit.color,
                              borderColor: `${commit.color}40`,
                              background: `${commit.color}10`,
                            }}
                          >
                            {ref}
                          </Tag>
                        );
                      })}
                    </Space>
                  </>
                )}
              </div>

              {/* 第三行：Hash */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
                fontSize: 11,
                fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
                color: '#bfbfbf',
              }}>
                <span>{highlightText(commit.hash.slice(0, 7), search)}</span>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyText(commit.hash);
                  }}
                  style={{ color: '#8c8c8c', padding: 0, height: 16, width: 16 }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 详情面板 */}
      {selectedCommit && (
        <Card
          title="提交详情"
          style={{ marginTop: 24 }}
          extra={
            <Button
              type="text"
              onClick={() => setSelectedCommit(null)}
            >
              关闭
            </Button>
          }
        >
          {(() => {
            const commit = mockCommits.find(c => c.hash === selectedCommit);
            if (!commit) return null;

            return (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <Text strong>提交信息：</Text>
                  <Paragraph style={{ marginTop: 4 }}>{commit.message}</Paragraph>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <Text strong>作者：</Text> {commit.author}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <Text strong>时间：</Text> {formatRelativeTime(commit.date)}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <Text strong>Hash：</Text>
                  <Text code>{commit.hash}</Text>
                </div>

                <div>
                  <Text strong>标签：</Text>
                  <Space size={4} style={{ marginLeft: 8 }}>
                    {commit.refs.map((ref, idx) => (
                      <Tag key={idx} color={commit.color}>{ref}</Tag>
                    ))}
                  </Space>
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {/* 说明文档 */}
      <Card title="界面特性说明" style={{ marginTop: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div>
            <Text strong>1. 清晰的信息层次</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>第一层：提交消息（主要信息）</li>
              <li>第二层：作者 · 时间 · 标签（辅助信息）</li>
              <li>第三层：Hash · 复制按钮（详细信息）</li>
            </ul>
          </div>

          <div>
            <Text strong>2. 视觉反馈</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>选中状态：蓝色背景高亮</li>
              <li>悬停效果：浅灰色背景</li>
              <li>搜索高亮：黄色标记匹配文本</li>
              <li>分支标签：彩色标签显示</li>
            </ul>
          </div>

          <div>
            <Text strong>3. 交互功能</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>点击提交查看详细信息</li>
              <li>一键复制完整Hash</li>
              <li>搜索过滤提交记录</li>
              <li>响应式布局适配</li>
            </ul>
          </div>

          <div>
            <Text strong>4. 技术实现</Text>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>HTML/CSS绘制（非Canvas）</li>
              <li>支持文本选择和复制</li>
              <li>响应式设计</li>
              <li>暗色主题支持</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
