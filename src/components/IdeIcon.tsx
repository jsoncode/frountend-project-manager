import { convertFileSrc } from '@tauri-apps/api/core'
import { useState } from 'react'
import { isTauri } from '../lib/tauri'

type Props = {
  iconPath?: string | null
  name: string
  size?: number
  className?: string
}

function resolveSrc(iconPath: string): string | null {
  try {
    if (isTauri()) return convertFileSrc(iconPath)
    return `file:///${iconPath.replace(/\\/g, '/')}`
  } catch {
    return null
  }
}

/** IDE glyph: custom image when available, otherwise initial letter. */
export function IdeIcon({ iconPath, name, size = 18, className = '' }: Props) {
  const [broken, setBroken] = useState(false)
  const src = iconPath && !broken ? resolveSrc(iconPath) : null

  if (src) {
    return (
      <img
        className={`ide-icon ${className}`.trim()}
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        onError={() => setBroken(true)}
      />
    )
  }

  const letter = (name.trim().charAt(0) || '?').toUpperCase()
  return (
    <span
      className={`ide-icon ide-icon-fallback ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.55) }}
      aria-hidden
    >
      {letter}
    </span>
  )
}
