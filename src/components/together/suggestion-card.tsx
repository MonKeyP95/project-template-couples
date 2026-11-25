import * as React from "react"

import { cn } from "@/lib/utils"

import { Chevron } from "./chevron"
import { Label } from "./label"

export interface SuggestionCardProps {
  label: string
  children: React.ReactNode
  expandable?: boolean
  /** Optional lead action; when set, apply drops to the outlined style. */
  acceptLabel?: string
  applyLabel?: string
  dismissLabel?: string
  onAccept?: () => void
  onApply?: () => void
  onDismiss?: () => void
  className?: string
}

const action = "px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em]"
const filled = `${action} rounded-full border-0 bg-sea text-background`
const outlined = `${action} rounded-md border border-border bg-transparent text-muted-foreground`

/** Moss-bordered suggestion card with up to three actions. */
export function SuggestionCard({
  label,
  children,
  expandable = false,
  acceptLabel,
  applyLabel,
  dismissLabel,
  onAccept,
  onApply,
  onDismiss,
  className,
}: SuggestionCardProps) {
  const hasActions = Boolean(acceptLabel || applyLabel || dismissLabel)
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
          {acceptLabel ? (
            <button type="button" onClick={onAccept} className={filled}>
              {acceptLabel}
            </button>
          ) : null}
          {applyLabel ? (
            <button
              type="button"
              onClick={onApply}
              className={acceptLabel ? outlined : filled}
            >
              {applyLabel}
            </button>
          ) : null}
          {dismissLabel ? (
            <button type="button" onClick={onDismiss} className={outlined}>
              {dismissLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
