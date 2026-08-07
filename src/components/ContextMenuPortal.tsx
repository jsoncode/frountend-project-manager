import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

const PAD = 8

/** Keep a box of size (w,h) inside the viewport near (x,y). */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  pad = PAD,
): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = x
  let top = y
  if (left + w > vw - pad) left = Math.max(pad, vw - w - pad)
  if (top + h > vh - pad) top = Math.max(pad, vh - h - pad)
  if (left < pad) left = pad
  if (top < pad) top = pad
  return { left, top }
}

type Props = {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  className?: string
}

/**
 * Fixed context menu portaled to document.body so it is never clipped by
 * overflow:auto ancestors (e.g. tool panels). Repositions to stay on-screen.
 */
export function ContextMenuPortal({
  x,
  y,
  onClose,
  children,
  className = 'branch-menu',
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos(clampToViewport(x, y, width, height))
  }, [x, y, children])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onVisibility = () => {
      if (document.hidden) close()
    }
    // Defer click listener so the opening contextmenu click doesn't instantly close.
    const timer = window.setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
    }, 0)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    // Minimize → tray restore may not fire blur/visibilitychange in WebView2;
    // closing on refocus guarantees no stale menu survives.
    window.addEventListener('focus', close)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('focus', close)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
