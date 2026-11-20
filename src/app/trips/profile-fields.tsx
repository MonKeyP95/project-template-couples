"use client"

import * as React from "react"

/** One walkthrough step: a display title, an optional mono hint, and the step's
 * controls. */
export function StepShell({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="t-display text-[20px] text-foreground">{title}</h3>
      {hint ? (
        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {hint}
        </span>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">{children}</div>
    </div>
  )
}
