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
