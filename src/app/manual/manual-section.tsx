"use client"

import { useState } from "react"

import { Coord } from "@/components/together"

/**
 * One manual section: a mono kicker, a serif title, the short orientation copy,
 * and a `more` toggle that reveals a step-by-step `details` block inline. Each
 * section opens independently (its own state).
 */
export function Section({
  id,
  kicker,
  title,
  children,
  details,
}: {
  id: string
  kicker: string
  title: string
  children: React.ReactNode
  details: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section id={id} className="mb-9 scroll-mt-16 border-t border-border pt-6">
      <Coord>{kicker}</Coord>
      <h2 className="t-display mt-1.5 text-[22px] text-foreground">{title}</h2>
      <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="t-label mt-3 inline-block text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? "less" : "more"}
      </button>
      {open ? (
        <div className="mt-4 rounded-lg bg-sea-tint px-4 py-4">{details}</div>
      ) : null}
    </section>
  )
}

/** Ordered step list used inside a section's `details` block. */
export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="flex flex-col gap-2.5 text-[14.5px] leading-relaxed text-foreground">
      {children}
    </ol>
  )
}

export function Step({ children }: { children: React.ReactNode }) {
  return <li className="ml-4 list-decimal pl-1 marker:font-mono marker:text-muted-foreground">{children}</li>
}
