import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={styles.root}>
        <div style={styles.box}>
          <div style={styles.icon}>⚠</div>
          <div style={styles.title}>Something went wrong</div>
          <div style={styles.msg}>{this.state.error?.message ?? 'Unexpected error'}</div>
          <button
            className="btn-primary"
            style={{ marginTop: 20 }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flex: 1, background: 'var(--bg)',
  },
  box: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: 40, maxWidth: 420, textAlign: 'center', gap: 8,
  },
  icon: { fontSize: 48, color: 'var(--error)' },
  title: { fontSize: 20, fontWeight: 700, color: 'var(--text)' },
  msg: { fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 },
};
