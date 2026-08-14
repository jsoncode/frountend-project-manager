import { ChevronRight } from 'reicon-react'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clampToViewport } from './ContextMenuPortal'

const CLOSE_DELAY = 180

/**
 * Shared submenu state per menu. `openId` decides which flyout is visible
 * (hovering one trigger replaces any sibling flyout instead of stacking).
 * The close timer is shared too: opening any flyout cancels a pending close
 * scheduled while leaving a sibling trigger — with per-item timers, passing
 * over one trigger on the way to another would kill the newly opened
 * flyout ~180ms later.
 */
type SubMenuApi = {
  openId: string | null
  open: (id: string) => void
  toggle: (id: string) => void
  scheduleClose: () => void
  track: (el: HTMLElement | null) => void
}

const SubMenuCtx = createContext<SubMenuApi>({
  openId: null,
  open: () => {},
  toggle: () => {},
  scheduleClose: () => {},
  track: () => {},
})

export function SubMenuGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverEls = useRef(new Set<HTMLElement>())

  const api = useMemo<SubMenuApi>(() => {
    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
    return {
      openId,
      open: (id) => {
        clearTimer()
        setOpenId(id)
      },
      toggle: (id) => {
        clearTimer()
        setOpenId((prev) => (prev === id ? null : id))
      },
      scheduleClose: () => {
        clearTimer()
        timer.current = setTimeout(() => {
          timer.current = null
          // Spurious mouseleave events can fire when React re-renders menu
          // items (e.g. async content swaps). Trust the browser hit-test:
          // keep the flyout while the pointer still rests on any trigger
          // or panel; the real mouseleave will reschedule the close.
          for (const el of hoverEls.current) {
            if (el.isConnected && el.matches(':hover')) return
          }
          setOpenId(null)
        }, CLOSE_DELAY)
      },
      track: (el) => {
        if (el) hoverEls.current.add(el)
      },
    }
  }, [openId])

  return (
    <SubMenuCtx.Provider value={api}>
      {children}
    </SubMenuCtx.Provider>
  )
}

type Props = {
  id: string
  icon?: ReactNode
  label: ReactNode
  children: ReactNode
}

/**
 * First-level menu item that opens a flyout submenu on hover (or click).
 * The flyout is portaled to document.body and flips left/up when there is
 * no room on the right/bottom, mirroring ContextMenuPortal behavior.
 */
export function SubMenuItem({ id, icon, label, children }: Props) {
  const { openId, open, toggle, scheduleClose, track } = useContext(SubMenuCtx)
  const isOpen = openId === id
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })

  useLayoutEffect(() => {
    if (!isOpen) return
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    const tr = trigger.getBoundingClientRect()
    const { width: w, height: h } = panel.getBoundingClientRect()
    const gap = 2
    const roomRight = window.innerWidth - tr.right - gap
    const roomLeft = tr.left - gap
    // Prefer the right side; flip left when cramped (unless left is worse).
    const left =
      roomRight >= w || roomRight >= roomLeft ? tr.right + gap : tr.left - w - gap
    const { left: cl, top: ct } = clampToViewport(left, tr.top, w, h)
    setPos({ left: cl, top: ct })
  }, [isOpen, children])

  const onClick = (e: MouseEvent) => {
    // Touch / keyboard users: click toggles the flyout instead of closing.
    e.stopPropagation()
    toggle(id)
  }

  return (
    <>
      <button
        ref={(el) => {
          triggerRef.current = el
          track(el)
        }}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`submenu-trigger btn-with-icon${isOpen ? ' open' : ''}`}
        onMouseEnter={() => open(id)}
        onMouseLeave={scheduleClose}
        onClick={onClick}
      >
        {icon}
        {label}
        <ChevronRight
          className="ui-icon submenu-arrow"
          size={12}
          color="currentColor"
          aria-hidden
        />
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={(el) => {
              panelRef.current = el
              track(el)
            }}
            className="branch-menu submenu-panel"
            role="menu"
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={() => open(id)}
            onMouseLeave={scheduleClose}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
