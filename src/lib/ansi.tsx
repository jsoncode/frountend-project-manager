import type { ReactNode } from 'react'
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

/** Strip CSI / OSC / other ESC — keep plain text only (no theme colors). */
function stripAnsi(text: string): string {
  let i = 0
  let out = ''
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b && text[i + 1] === '[') {
      const end = findCsiFinal(text, i + 2)
      if (end === -1) {
        out += text.slice(i)
        break
      }
      i = end + 1
      continue
    }
    if (text.charCodeAt(i) === 0x1b && text[i + 1] === ']') {
      const bel = text.indexOf('\u0007', i + 2)
      const st = text.indexOf('\u001b\\', i + 2)
      const end =
        bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
      if (end === -1) break
      i = end + (text.startsWith('\u001b\\', end) ? 2 : 1)
      continue
    }
    if (text.charCodeAt(i) === 0x1b) {
      i += text[i + 1] ? 2 : 1
      continue
    }
    let j = i + 1
    while (j < text.length && text.charCodeAt(j) !== 0x1b) j += 1
    out += text.slice(i, j)
    i = j
  }
  return out
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
 * Render terminal text: strip ANSI (no custom colors), keep clickable http(s) links.
 * Uses the terminal panel’s default foreground — same look as an unthemed console.
 */
export function renderAnsi(text: string, keyPrefix = 'a'): ReactNode {
  return linkify(stripAnsi(text), keyPrefix)
}
