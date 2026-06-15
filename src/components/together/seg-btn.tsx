import * as React from "react"

export type SegTone = "clay" | "sea"

export interface SegBtnProps {
  active: boolean
  onClick: () => void
  tone?: SegTone
  children: React.ReactNode
}

const ACTIVE: Record<SegTone, string> = {
  clay: "border-clay bg-clay text-background",
  sea: "border-sea bg-sea text-background",
}

export function SegBtn({ active, onClick, tone = "clay", children }: SegBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors " +
        (active
          ? ACTIVE[tone]
          : "border-rule bg-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  )
}
