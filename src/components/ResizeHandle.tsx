import { useCallback, useEffect, useRef } from 'react'

type Orientation = 'vertical' | 'horizontal'

type Props = {
  orientation?: Orientation
  onDrag: (delta: number) => void
  onDragEnd?: () => void
}

export function ResizeHandle({
  orientation = 'vertical',
  onDrag,
  onDragEnd,
}: Props) {
  const dragging = useRef(false)
  const last = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragging.current = true
      last.current = orientation === 'vertical' ? e.clientX : e.clientY
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.classList.add(
        orientation === 'vertical' ? 'resizing-col' : 'resizing-row',
      )
    },
    [orientation],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const pos = orientation === 'vertical' ? e.clientX : e.clientY
      const delta = pos - last.current
      last.current = pos
      if (delta !== 0) onDrag(delta)
    },
    [onDrag, orientation],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('resizing-col', 'resizing-row')
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      onDragEnd?.()
    },
    [onDragEnd],
  )

  useEffect(() => {
    return () => {
      document.body.classList.remove('resizing-col', 'resizing-row')
    }
  }, [])

  return (
    <div
      className={`resize-handle resize-${orientation}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="separator"
      aria-orientation={orientation}
    />
  )
}
