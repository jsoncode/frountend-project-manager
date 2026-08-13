import { Tooltip as AntdTooltip } from 'antd'
import type { ReactElement, ReactNode } from 'react'

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

/**
 * Thin antd 6 Tooltip wrapper keeping the legacy custom API so callers
 * keep working unchanged. 'auto' placement falls back to 'top'.
 */
export function Tooltip({
  title,
  children,
  placement = 'top',
  mouseEnterDelay = 400,
  mouseLeaveDelay = 0,
  disabled,
  className,
  maxWidth,
}: Props) {
  if (title == null || title === false || title === '') {
    return children
  }
  return (
    <AntdTooltip
      title={title}
      placement={placement === 'auto' ? 'top' : placement}
      mouseEnterDelay={mouseEnterDelay}
      mouseLeaveDelay={mouseLeaveDelay}
      open={disabled ? false : undefined}
      overlayClassName={className || undefined}
      overlayStyle={maxWidth ? { maxWidth } : undefined}
    >
      {children}
    </AntdTooltip>
  )
}
