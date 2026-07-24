/** First-letter / first-char group key for project list banding. */
export function projectGroupKey(name: string): string {
  const ch = name.trim().charAt(0)
  if (!ch) return '#'
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase()
  if (/\d/.test(ch)) return '0-9'
  return ch
}

/** Stable pale wash for a group key (dark UI friendly). */
export function projectGroupTint(key: string): string {
  let hue: number
  if (key.length === 1 && key >= 'A' && key <= 'Z') {
    hue = ((key.charCodeAt(0) - 65) * 14) % 360
  } else if (key === '0-9') {
    hue = 200
  } else {
    let h = 0
    for (let i = 0; i < key.length; i += 1) {
      h = (h * 31 + key.charCodeAt(i)) >>> 0
    }
    hue = h % 360
  }
  return `hsla(${hue}, 38%, 52%, 0.16)`
}
