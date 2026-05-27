import * as React from "react"
import { cn } from "@/lib/utils"

export type MonoBadgeTone = "sea" | "clay" | "moss" | "sand" | "ink"

const toneClasses: Record<MonoBadgeTone, string> = {
  sea: "border-sea text-sea",
  clay: "border-clay text-clay",
  moss: "border-moss text-moss",
  sand: "border-sand text-sand",
  ink: "border-foreground text-foreground",
}

export interface MonoBadgeProps {
  tone?: MonoBadgeTone
  children: React.ReactNode
  className?: string
}

export function MonoBadge({
  tone = "ink",
  children,
  className,
}: MonoBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center border rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
