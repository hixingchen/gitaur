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

  static getDerivedStateFromError(): State {
    return { hasError: true, errorCount: 0 };
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

    // 自动恢复：延迟重置状态
    this.resetTimer = setTimeout(() => {
      this.setState({ hasError: false, errorCount: nextCount });
    }, 200);
  }

  componentWillUnmount() {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
