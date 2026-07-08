"use client"

import * as React from "react"

/** One collapsible category panel: an always-visible header (title + optional
 * muted hint) that toggles a body. Each panel keeps its own open state. Shared
 * by the couple profile and the discovery doors. */
export function CategorySection({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section className="border-t border-border pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-serif text-xl tracking-tight">{title}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {hint ? <span>{hint}</span> : null}
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}
