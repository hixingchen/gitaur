import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);

    const nextCount = this.state.errorCount + 1;

    // 超过 3 次连续报错，停止自动恢复，刷新页面
    if (nextCount >= 3) {
      console.error('Too many errors, reloading page...');
      window.location.reload();
      return;
    }

    // 自动恢复：延迟 2 秒重置状态（太短会形成闪烁循环）
    this.resetTimer = setTimeout(() => {
      this.setState({ hasError: false, errorCount: nextCount });
    }, 2000);
  }

  componentWillUnmount() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 16,
          background: 'var(--ant-color-bg-layout, #f5f5f5)',
          color: 'var(--ant-color-text, rgba(0,0,0,0.88))',
        }}>
          <div style={{ fontSize: 48 }}>😵</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>页面出错了</div>
          <div style={{ fontSize: 13, color: 'var(--ant-color-text-secondary, rgba(0,0,0,0.45))' }}>正在自动恢复...</div>
        </div>
      );
    }
    return this.props.children;
  }
}
