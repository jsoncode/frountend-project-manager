import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MAX_CHARS,
  buildUserContent,
  groupConversations,
  truncateAttachment,
} from './aiChat'

describe('truncateAttachment', () => {
  it('truncates over limit and appends marker', () => {
    const text = 'a'.repeat(ATTACHMENT_MAX_CHARS + 10)
    const out = truncateAttachment(text)
    expect(out.length).toBeLessThan(text.length)
    expect(out.endsWith('…[truncated]')).toBe(true)
  })
})

describe('groupConversations', () => {
  it('splits recent month vs older', () => {
    const now = Date.UTC(2026, 6, 24)
    const recent = { id: '1', title: 'a', createdAt: now, updatedAt: now - 5 * 86400000 }
    const older = { id: '2', title: 'b', createdAt: now, updatedAt: now - 40 * 86400000 }
    const g = groupConversations([older, recent], now)
    expect(g.recent.map((c) => c.id)).toEqual(['1'])
    expect(g.older.map((c) => c.id)).toEqual(['2'])
  })
})

describe('buildUserContent', () => {
  it('embeds terminal selection before user text', () => {
    const content = buildUserContent('帮我看报错', {
      kind: 'terminal-selection',
      text: 'Error: boom',
      createdAt: 1,
    })
    expect(content).toContain('[终端选区]')
    expect(content).toContain('Error: boom')
    expect(content).toContain('帮我看报错')
  })
})
