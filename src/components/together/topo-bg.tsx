import * as React from "react"
import { cn } from "@/lib/utils"

export type TopoTone = "sea" | "clay" | "moss" | "sand"

const toneVar: Record<TopoTone, string> = {
  sea: "var(--sea)",
  clay: "var(--clay)",
  moss: "var(--moss)",
  sand: "var(--sand)",
}

export interface TopoBgProps {
  tone?: TopoTone
  opacity?: number
  className?: string
}

/**
 * Decorative concentric-ring pattern. Always absolutely positioned inside
 * a relatively-positioned parent — never fills the viewport.
 */
export function TopoBg({ tone = "sea", opacity = 0.07, className }: TopoBgProps) {
  const reactId = React.useId()
  const patternId = `topo-${reactId.replace(/:/g, "")}`
  const color = toneVar[tone]
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 400 400"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("absolute inset-0 pointer-events-none", className)}
      style={{ opacity }}
    >
      <defs>
        <pattern
          id={patternId}
          x="0"
          y="0"
          width="80"
          height="80"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="40" cy="40" r="6" fill="none" stroke={color} strokeWidth="0.6" />
          <circle cx="40" cy="40" r="14" fill="none" stroke={color} strokeWidth="0.6" />
          <circle cx="40" cy="40" r="24" fill="none" stroke={color} strokeWidth="0.6" />
          <circle cx="40" cy="40" r="36" fill="none" stroke={color} strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  )
}
