import * as React from "react"
import { cn } from "@/lib/utils"

export type BarTone =
  | "sea"
  | "sea2"
  | "clay"
  | "moss"
  | "sand"
  | "dusk"
  | "red"
  | "ink"
  | "muted"

const fillClasses: Record<BarTone, string> = {
  sea: "bg-sea",
  sea2: "bg-sea-2",
  clay: "bg-clay",
  moss: "bg-moss",
  sand: "bg-sand",
  dusk: "bg-dusk",
  red: "bg-destructive",
  ink: "bg-foreground",
  muted: "bg-muted-foreground",
}

/** One colour per category line, by position; red is kept for over budget. */
const CATEGORY_TONES: BarTone[] = ["sea", "moss", "sand", "dusk", "clay", "sea2"]

export function categoryTone(index: number): BarTone {
  return CATEGORY_TONES[index % CATEGORY_TONES.length]
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
