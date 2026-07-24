import { describe, expect, it } from 'vitest'
import {
  projectMatchesQuery,
  projectSubtitle,
  shortDisplayName,
} from './projectSearch'
import type { ProjectSummary } from './types'

function proj(partial: Partial<ProjectSummary>): ProjectSummary {
  return {
    folderName: 'demo',
    path: '/demo',
    frameworks: [],
    scripts: {},
    ...partial,
  }
}

describe('shortDisplayName', () => {
  it('hides titles longer than 12 chars', () => {
    expect(shortDisplayName('健康AI预约系统管理端应用')).toBeNull()
    expect(shortDisplayName('健康预约')).toBe('健康预约')
  })
})

describe('projectSubtitle', () => {
  it('prefers short README title then pkg name', () => {
    expect(
      projectSubtitle(proj({ displayName: '健康预约', pkgName: '@cxa/booking' })),
    ).toBe('健康预约')
    expect(
      projectSubtitle(proj({ displayName: '这是一个超过十二个字的超长标题', pkgName: '@cxa/x' })),
    ).toBe('@cxa/x')
    expect(projectSubtitle(proj({ pkgName: 'fallback' }))).toBe('fallback')
  })
})

describe('projectMatchesQuery', () => {
  const p = proj({
    folderName: 'health-ai-booking',
    displayName: '健康预约',
    pkgName: '@cxa/booking',
  })

  it('matches substring and pinyin initials', () => {
    expect(projectMatchesQuery(p, '健康')).toBe(true)
    expect(projectMatchesQuery(p, 'jk')).toBe(true)
    expect(projectMatchesQuery(p, 'jiankang')).toBe(true)
    expect(projectMatchesQuery(p, 'booking')).toBe(true)
    expect(projectMatchesQuery(p, 'zzz-nope')).toBe(false)
  })
})
