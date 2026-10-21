import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** The light card that holds one or more BoxSections, divided by rules. */
export function BoxCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A native disclosure: `summary` is always visible, `children` show when open. */
export function BoxSection({
  summary,
  children,
}: {
  summary: ReactNode
  children: ReactNode
}) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-[18px] py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">{summary}</div>
        <span
          aria-hidden
          className="font-mono text-[12px] text-muted-foreground transition-transform group-open:rotate-90"
        >
          ▸
        </span>
      </summary>
      <div className="border-t border-border bg-background">{children}</div>
    </details>
  )
}
