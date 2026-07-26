import { describe, expect, it } from 'vitest'
import { detectIssueKind, stripAnsi, trimLogTail } from './termIssue'

describe('termIssue', () => {
  it('strips ansi colors', () => {
    expect(stripAnsi('\u001b[31mError: boom\u001b[0m')).toBe('Error: boom')
  })

  it('detects english and chinese errors', () => {
    expect(detectIssueKind('Error: cannot find module')).toBe('error')
    expect(detectIssueKind('编译错误：类型不匹配')).toBe('error')
    expect(detectIssueKind('Build failed')).toBe('error')
  })

  it('detects warnings', () => {
    expect(detectIssueKind('warning: unused variable')).toBe('warning')
    expect(detectIssueKind('警告: 弃用 API')).toBe('warning')
  })

  it('skips benign zero-count lines', () => {
    expect(detectIssueKind('Found 0 errors')).toBe(null)
    expect(detectIssueKind('0 warnings')).toBe(null)
  })

  it('trims long tails', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}`)
    const out = trimLogTail(lines.join('\n'), 50)
    expect(out.split('\n').length).toBe(50)
    expect(out).toContain('line-199')
  })
})
