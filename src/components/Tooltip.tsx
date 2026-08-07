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
  // Explicit placement from callers — do not flip away from the requested side.
  if (preferred !== 'auto') return preferred

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
 * Portaled tooltip with auto flip + viewport clamping.
 * Bubble is non-interactive (`pointer-events: none`) so it never steals
 * clicks from UI underneath, and leaving the trigger always dismisses it.
 */
export function Tooltip({
  title,
  children,
  placement = 'auto',
  mouseEnterDelay = 400,
  mouseLeaveDelay = 0,
  disabled = false,
  className = '',
  maxWidth = 360,
}: Props) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const showTimer = useRef(0)
  const hideTimer = useRef(0)
  /** True while the pointer is over the trigger — guards delayed show. */
  const hoveringRef = useRef(false)
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)

  const clearTimers = useCallback(() => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
    showTimer.current = 0
    hideTimer.current = 0
  }, [])

  const hideNow = useCallback(() => {
    clearTimers()
    hoveringRef.current = false
    setOpen(false)
    setPos(null)
  }, [clearTimers])

  const hide = useCallback(() => {
    hoveringRef.current = false
    clearTimers()
    if (mouseLeaveDelay <= 0) {
      setOpen(false)
      setPos(null)
      return
    }
    hideTimer.current = window.setTimeout(() => {
      setOpen(false)
      setPos(null)
    }, mouseLeaveDelay)
  }, [clearTimers, mouseLeaveDelay])

  const show = useCallback(() => {
    if (disabled || title == null || title === false || title === '') return
    hoveringRef.current = true
    clearTimers()
    showTimer.current = window.setTimeout(() => {
      // Mouse already left before the enter delay elapsed — do not show.
      if (!hoveringRef.current) return
      setOpen(true)
    }, mouseEnterDelay)
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
    const onScroll = () => hideNow()
    // Leaving the app (Alt+Tab / task switch) does not fire mouseleave on
    // the trigger — the tip would stay visible after switching back.
    const onVisibility = () => {
      if (document.hidden) hideNow()
    }
    // Minimize → tray restore does not reliably fire blur/visibilitychange
    // in WebView2. Closing on refocus guarantees no stale tip survives.
    const onFocus = () => hideNow()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hideNow)
    window.addEventListener('blur', hideNow)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    document.documentElement.addEventListener('mouseleave', hideNow)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hideNow)
      window.removeEventListener('blur', hideNow)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      document.documentElement.removeEventListener('mouseleave', hideNow)
    }
  }, [open, placement, title, hideNow])

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
    onMouseDown?: (e: ReactMouseEvent) => void
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
    onMouseDown: (e: ReactMouseEvent) => {
      childProps.onMouseDown?.(e)
      // Clicking the trigger should not leave a floating tip over neighbors.
      hideNow()
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
        onMouseDown={hideNow}
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
          >
            <div className="ui-tooltip-inner">{title}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
