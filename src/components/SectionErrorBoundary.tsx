import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
}

/**
 * 区域级 ErrorBoundary — 包裹 Monaco/Canvas 等易崩溃组件，
 * 防止局部错误导致整个 App 白屏。
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('SectionErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', minHeight: 200, gap: 12,
          background: 'var(--ant-color-fill-quaternary, rgba(0,0,0,0.02))',
          borderRadius: 10, border: '1px solid var(--ant-color-border-secondary, #d9d9d9)',
        }}>
          <div style={{ fontSize: 32 }}>😵</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {this.props.fallbackTitle || '组件加载失败'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--ant-color-border, #d9d9d9)',
              background: 'var(--ant-color-bg-container, #fff)',
              color: 'var(--ant-color-text, #000)',
              fontSize: 13,
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
