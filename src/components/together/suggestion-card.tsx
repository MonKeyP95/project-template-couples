import * as React from "react"

import { cn } from "@/lib/utils"

import { Chevron } from "./chevron"
import { Label } from "./label"

export interface SuggestionCardProps {
  label: string
  children: React.ReactNode
  expandable?: boolean
  applyLabel?: string
  dismissLabel?: string
  className?: string
}

/**
 * Moss-bordered suggestion card. Phase-3 stub — actions are inert.
 * Phase 5 will replace the static copy with a Claude-backed source.
 */
export function SuggestionCard({
  label,
  children,
  expandable = false,
  applyLabel,
  dismissLabel,
  className,
}: SuggestionCardProps) {
  const hasActions = Boolean(applyLabel || dismissLabel)
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card border-l-[3px] border-l-moss px-3.5 py-3",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Label className="text-moss">{label}</Label>
        {expandable ? <Chevron dir="down" /> : null}
      </div>
      <div className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">
        {children}
      </div>
      {hasActions ? (
        <div className="mt-3 flex gap-1.5">
          {applyLabel ? (
            <button
              type="button"
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              {applyLabel}
            </button>
          ) : null}
          {dismissLabel ? (
            <button
              type="button"
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
            >
              {dismissLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
