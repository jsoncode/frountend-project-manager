import { ReloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Atom } from 'reicon-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Last-resort guard — root crashes should be rare after selector fixes. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FPM render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="app-shell" style={{ padding: 24 }}>
        <div className="brand" style={{ marginBottom: 12 }}>
          <Atom className="ui-icon" size={18} color="currentColor" aria-hidden />
          FPM
        </div>
        <p style={{ color: 'var(--text-bright)', marginBottom: 12 }}>
          界面遇到问题，点击恢复即可继续使用。
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
          {String(this.state.error)}
        </p>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => this.setState({ error: null })}
        >
          恢复界面
        </Button>
      </div>
    )
  }
}

/**
 * Per-panel error boundary (audit P2-3): a crash in one panel must not blank
 * the whole app (killing pty sessions and unsaved docs along with it).
 * Deliberately dependency-free — antd itself may be the crash source, and the
 * fallback must render without the antd context or app stylesheet.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FPM panel error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          height: '100%',
          padding: 16,
          boxSizing: 'border-box',
          background: '#1a1a2e',
          color: '#cdd6f4',
          fontFamily: 'Consolas, monospace',
          fontSize: 13,
        }}
      >
        <div style={{ opacity: 0.8 }}>This panel crashed</div>
        <div
          style={{
            maxWidth: 420,
            overflow: 'auto',
            opacity: 0.6,
            fontSize: 11,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {String(this.state.error)}
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            padding: '4px 14px',
            borderRadius: 4,
            border: '1px solid rgba(205,214,244,0.4)',
            background: 'transparent',
            color: '#cdd6f4',
            cursor: 'pointer',
          }}
        >
          Reload panel
        </button>
      </div>
    )
  }
}
