import { describe, expect, it } from 'vitest'
import { cleanTerminalFilePath, findFilePathsInLine } from './termFileLinks'

describe('termFileLinks', () => {
  it('finds Windows paths with spaces', () => {
    const line = 'error in D:\\xxx\\xx xx.text at runtime'
    const hits = findFilePathsInLine(line)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.path).toBe('D:\\xxx\\xx xx.text')
    expect(line.slice(hits[0]!.start, hits[0]!.end)).toContain('D:\\xxx')
  })

  it('strips :line:col suffixes', () => {
    expect(cleanTerminalFilePath('D:\\a\\b.ts:12:3')).toBe('D:\\a\\b.ts')
    expect(cleanTerminalFilePath('D:\\a\\b.ts:12')).toBe('D:\\a\\b.ts')
  })

  it('strips trailing punctuation', () => {
    expect(cleanTerminalFilePath('D:\\a\\b.ts,')).toBe('D:\\a\\b.ts')
    expect(cleanTerminalFilePath('D:\\a\\b.ts)')).toBe('D:\\a\\b.ts')
  })

  it('finds forward-slash Windows paths', () => {
    const hits = findFilePathsInLine('see D:/repo/src/App.tsx next')
    expect(hits.some((h) => h.path.toLowerCase().includes('app.tsx'))).toBe(
      true,
    )
  })
})
