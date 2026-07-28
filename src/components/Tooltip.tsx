import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { clampToViewport } from './ContextMenuPortal'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto'

type Props = {
  /** Tooltip body. Empty / null disables the tooltip. */
  title?: ReactNode
  children: ReactElement
  placement?: TooltipPlacement
  /** Delay before show, in ms (antd-like). */
  mouseEnterDelay?: number
  /** Delay before hide, in ms. */
  mouseLeaveDelay?: number
  disabled?: boolean
  className?: string
  /** Max width of the bubble. */
  maxWidth?: number
}

type Pos = { left: number; top: number; placement: Exclude<TooltipPlacement, 'auto'> }

const GAP = 8
const PAD = 8

function pickPlacement(
  trigger: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TooltipPlacement,
): Exclude<TooltipPlacement, 'auto'> {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const space = {
    top: trigger.top - PAD - GAP,
    bottom: vh - trigger.bottom - PAD - GAP,
    left: trigger.left - PAD - GAP,
    right: vw - trigger.right - PAD - GAP,
  }

  const fits = (p: Exclude<TooltipPlacement, 'auto'>) =>
    p === 'top' || p === 'bottom' ? space[p] >= tipH : space[p] >= tipW

  if (preferred !== 'auto') {
    if (fits(preferred)) return preferred
    const flip: Record<Exclude<TooltipPlacement, 'auto'>, Exclude<TooltipPlacement, 'auto'>> = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
    }
    const alt = flip[preferred]
    if (fits(alt)) return alt
  }

  const order: Exclude<TooltipPlacement, 'auto'>[] = ['top', 'bottom', 'right', 'left']
  return (
    order.find(fits) ??
    order.reduce((best, p) => (space[p] > space[best] ? p : best))
  )
}

function placeTooltip(
  trigger: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TooltipPlacement,
): Pos {
  const placement = pickPlacement(trigger, tipW, tipH, preferred)
  let left = 0
  let top = 0

  switch (placement) {
    case 'top':
      left = trigger.left + trigger.width / 2 - tipW / 2
      top = trigger.top - tipH - GAP
      break
    case 'bottom':
      left = trigger.left + trigger.width / 2 - tipW / 2
      top = trigger.bottom + GAP
      break
    case 'left':
      left = trigger.left - tipW - GAP
      top = trigger.top + trigger.height / 2 - tipH / 2
      break
    case 'right':
      left = trigger.right + GAP
      top = trigger.top + trigger.height / 2 - tipH / 2
      break
  }

  const clamped = clampToViewport(left, top, tipW, tipH, PAD)
  return { left: clamped.left, top: clamped.top, placement }
}

/**
 * Ant Design–like tooltip: portaled bubble with auto flip + viewport clamping.
 */
export function Tooltip({
  title,
  children,
  placement = 'auto',
  mouseEnterDelay = 400,
  mouseLeaveDelay = 80,
  disabled = false,
  className = '',
  maxWidth = 360,
}: Props) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const showTimer = useRef(0)
  const hideTimer = useRef(0)
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)

  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
  }, [])

  const hide = useCallback(() => {
    clearTimers()
    hideTimer.current = window.setTimeout(() => {
      setOpen(false)
      setPos(null)
    }, mouseLeaveDelay)
  }, [clearTimers, mouseLeaveDelay])

  const show = useCallback(() => {
    if (disabled || title == null || title === false || title === '') return
    clearTimers()
    showTimer.current = window.setTimeout(() => setOpen(true), mouseEnterDelay)
  }, [clearTimers, disabled, mouseEnterDelay, title])

  useEffect(() => () => clearTimers(), [clearTimers])

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const tip = tipRef.current
    if (!trigger || !tip) return

    const update = () => {
      const rect = trigger.getBoundingClientRect()
      const { width, height } = tip.getBoundingClientRect()
      setPos(placeTooltip(rect, width, height, placement))
    }

    update()
    const onScroll = () => hide()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, placement, title, hide])

  if (title == null || title === false || title === '') {
    return children
  }

  const child = Children.only(children)
  if (!isValidElement(child)) return children

  const childProps = child.props as {
    onMouseEnter?: (e: ReactMouseEvent) => void
    onMouseLeave?: (e: ReactMouseEvent) => void
    onFocus?: (e: ReactFocusEvent) => void
    onBlur?: (e: ReactFocusEvent) => void
    ref?: Ref<HTMLElement>
    disabled?: boolean
    'aria-describedby'?: string
  }

  const setRefs = (node: HTMLElement | null) => {
    triggerRef.current = node
    const r = childProps.ref
    if (typeof r === 'function') r(node)
    else if (r && typeof r === 'object') {
      ;(r as { current: HTMLElement | null }).current = node
    }
  }

  const merged = cloneElement(child as ReactElement<Record<string, unknown>>, {
    ref: setRefs,
    'aria-describedby': open ? tipId : childProps['aria-describedby'],
    onMouseEnter: (e: ReactMouseEvent) => {
      childProps.onMouseEnter?.(e)
      show()
    },
    onMouseLeave: (e: ReactMouseEvent) => {
      childProps.onMouseLeave?.(e)
      hide()
    },
    onFocus: (e: ReactFocusEvent) => {
      childProps.onFocus?.(e)
      show()
    },
    onBlur: (e: ReactFocusEvent) => {
      childProps.onBlur?.(e)
      hide()
    },
  })

  // Disabled form controls swallow pointer events — wrap so hover still works.
  const triggerNode =
    disabled || childProps.disabled ? (
      <span
        ref={setRefs}
        className="ui-tooltip-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {child}
      </span>
    ) : (
      merged
    )

  const style: CSSProperties | undefined = pos
    ? { left: pos.left, top: pos.top, maxWidth }
    : { left: -9999, top: -9999, maxWidth, visibility: 'hidden' }

  return (
    <>
      {triggerNode}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={`ui-tooltip ${pos ? `ui-tooltip-${pos.placement}` : ''} ${className}`.trim()}
            style={style}
            onMouseEnter={clearTimers}
            onMouseLeave={hide}
          >
            <div className="ui-tooltip-inner">{title}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
