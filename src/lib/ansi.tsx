import type { CSSProperties, ReactNode } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { isTauri } from './tauri'

const URL_RE = /https?:\/\/[^\s<>'"\]）】]+/gi

/** Trim sentence punctuation glued to URLs — keep host port colon (`http://host:`). */
function trimUrlEdge(url: string): string {
  let out = url.replace(/[),.;!?]+$/g, '')
  if (out.endsWith(':') && !/^https?:\/\/[^/\s]+:$/i.test(out)) {
    out = out.slice(0, -1)
  }
  return out
}

/** CSI final byte is in 0x40–0x7E (@–~). */
function findCsiFinal(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    if (c >= 0x40 && c <= 0x7e) return i
  }
  return -1
}

const ANSI16_FG = [
  '#1e1e1e',
  '#e06c75',
  '#98c379',
  '#e5c07b',
  '#61afef',
  '#c678dd',
  '#56b6c2',
  '#abb2bf',
  '#5c6370',
  '#e06c75',
  '#98c379',
  '#e5c07b',
  '#61afef',
  '#c678dd',
  '#56b6c2',
  '#ffffff',
]

type AnsiStyle = {
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  fg?: string
  bg?: string
}

function cloneStyle(s: AnsiStyle): AnsiStyle {
  return { ...s }
}

function styleKey(s: AnsiStyle): string {
  return [
    s.bold ? '1' : '0',
    s.dim ? '1' : '0',
    s.italic ? '1' : '0',
    s.underline ? '1' : '0',
    s.fg ?? '',
    s.bg ?? '',
  ].join('|')
}

function toCss(s: AnsiStyle): CSSProperties | undefined {
  if (!s.bold && !s.dim && !s.italic && !s.underline && !s.fg && !s.bg) {
    return undefined
  }
  const css: CSSProperties = {}
  if (s.bold) css.fontWeight = 700
  if (s.dim) css.opacity = 0.65
  if (s.italic) css.fontStyle = 'italic'
  if (s.underline) css.textDecoration = 'underline'
  if (s.fg) css.color = s.fg
  if (s.bg) css.backgroundColor = s.bg
  return css
}

function color256(n: number): string {
  if (n < 16) return ANSI16_FG[n] ?? '#abb2bf'
  if (n < 232) {
    const i = n - 16
    const r = Math.floor(i / 36)
    const g = Math.floor((i % 36) / 6)
    const b = i % 6
    const ramp = [0, 95, 135, 175, 215, 255]
    return `rgb(${ramp[r]},${ramp[g]},${ramp[b]})`
  }
  const v = 8 + (n - 232) * 10
  return `rgb(${v},${v},${v})`
}

function applySgr(style: AnsiStyle, params: number[]): AnsiStyle {
  const next = cloneStyle(style)
  if (params.length === 0) params = [0]
  let i = 0
  while (i < params.length) {
    const p = params[i] ?? 0
    switch (p) {
      case 0:
        return {}
      case 1:
        next.bold = true
        break
      case 2:
        next.dim = true
        break
      case 3:
        next.italic = true
        break
      case 4:
        next.underline = true
        break
      case 22:
        next.bold = false
        next.dim = false
        break
      case 23:
        next.italic = false
        break
      case 24:
        next.underline = false
        break
      case 39:
        next.fg = undefined
        break
      case 49:
        next.bg = undefined
        break
      default: {
        if (p >= 30 && p <= 37) {
          next.fg = ANSI16_FG[p - 30]
        } else if (p >= 90 && p <= 97) {
          next.fg = ANSI16_FG[p - 90 + 8]
        } else if (p >= 40 && p <= 47) {
          next.bg = ANSI16_FG[p - 40]
        } else if (p >= 100 && p <= 107) {
          next.bg = ANSI16_FG[p - 100 + 8]
        } else if (p === 38 || p === 48) {
          const isFg = p === 38
          const mode = params[i + 1]
          if (mode === 5 && params[i + 2] != null) {
            const c = color256(params[i + 2])
            if (isFg) next.fg = c
            else next.bg = c
            i += 2
          } else if (
            mode === 2 &&
            params[i + 2] != null &&
            params[i + 3] != null &&
            params[i + 4] != null
          ) {
            const c = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`
            if (isFg) next.fg = c
            else next.bg = c
            i += 4
          }
        }
        break
      }
    }
    i += 1
  }
  return next
}

type Segment = { text: string; style: AnsiStyle }

/** Parse CSI SGR / strip other ESC sequences into styled segments. */
function parseAnsi(text: string): Segment[] {
  const segments: Segment[] = []
  let style: AnsiStyle = {}
  let i = 0
  let buf = ''

  const flush = () => {
    if (!buf) return
    segments.push({ text: buf, style: cloneStyle(style) })
    buf = ''
  }

  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b && text[i + 1] === '[') {
      const end = findCsiFinal(text, i + 2)
      if (end === -1) {
        buf += text.slice(i)
        break
      }
      const final = text[end]
      const body = text.slice(i + 2, end)
      flush()
      if (final === 'm') {
        const params = body
          .split(';')
          .filter((s) => s.length > 0)
          .map((s) => Number.parseInt(s, 10))
          .map((n) => (Number.isFinite(n) ? n : 0))
        style = applySgr(style, params.length ? params : [0])
      }
      i = end + 1
      continue
    }
    if (text.charCodeAt(i) === 0x1b && text[i + 1] === ']') {
      flush()
      const bel = text.indexOf('\u0007', i + 2)
      const st = text.indexOf('\u001b\\', i + 2)
      const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
      if (end === -1) break
      i = end + (text.startsWith('\u001b\\', end) ? 2 : 1)
      continue
    }
    if (text.charCodeAt(i) === 0x1b) {
      flush()
      i += text[i + 1] ? 2 : 1
      continue
    }
    buf += text[i]
    i += 1
  }
  flush()
  return segments
}

async function openLink(url: string) {
  try {
    if (isTauri()) await open(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function linkify(text: string, keyPrefix: string): ReactNode {
  const nodes: ReactNode[] = []
  const re = new RegExp(URL_RE.source, 'gi')
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index))
    }
    const raw = m[0]
    const href = trimUrlEdge(raw)
    if (!href) {
      nodes.push(raw)
      last = m.index + raw.length
      continue
    }
    nodes.push(
      <a
        key={`${keyPrefix}-a${n++}`}
        className="term-link"
        href={href}
        onClick={(e) => {
          e.preventDefault()
          void openLink(href)
        }}
      >
        {href}
      </a>,
    )
    if (href.length < raw.length) {
      nodes.push(raw.slice(href.length))
    }
    last = m.index + raw.length
  }
  if (last < text.length || nodes.length === 0) {
    nodes.push(text.slice(last))
  }
  return nodes.length === 1 ? nodes[0] : <>{nodes}</>
}

/**
 * Render terminal text with ANSI SGR colors (for bat / FORCE_COLOR tools)
 * and clickable http(s) links.
 */
export function renderAnsi(text: string, keyPrefix = 'a'): ReactNode {
  const segments = parseAnsi(text)
  if (segments.length === 0) return null
  if (segments.length === 1 && styleKey(segments[0].style) === '0|0|0|0||') {
    return linkify(segments[0].text, keyPrefix)
  }

  const nodes: ReactNode[] = []
  segments.forEach((seg, idx) => {
    if (!seg.text) return
    const css = toCss(seg.style)
    const content = linkify(seg.text, `${keyPrefix}-${idx}`)
    if (css) {
      nodes.push(
        <span key={`${keyPrefix}-s${idx}`} style={css}>
          {content}
        </span>,
      )
    } else {
      nodes.push(<span key={`${keyPrefix}-s${idx}`}>{content}</span>)
    }
  })
  return nodes.length === 1 ? nodes[0] : <>{nodes}</>
}
