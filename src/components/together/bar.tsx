import * as React from "react"
import { cn } from "@/lib/utils"

export type BarTone = "sea" | "clay" | "moss" | "ink"

const fillClasses: Record<BarTone, string> = {
  sea: "bg-sea",
  clay: "bg-clay",
  moss: "bg-moss",
  ink: "bg-foreground",
}

export interface BarProps {
  pct: number
  tone?: BarTone
  className?: string
}

export function Bar({ pct, tone = "sea", className }: BarProps) {
  const width = Math.max(0, Math.min(100, pct))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-border", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-[350ms] ease-out",
          fillClasses[tone],
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
