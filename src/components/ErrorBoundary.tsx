import { Atom, Refresh } from 'reicon-react'
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
        <button
          type="button"
          className="btn btn-with-icon"
          onClick={() => this.setState({ error: null })}
        >
          <Refresh className="ui-icon" size={14} color="currentColor" aria-hidden />
          恢复界面
        </button>
      </div>
    )
  }
}
