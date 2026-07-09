"use client"

import * as React from "react"

/** One category entry in the door. `content` is the search UI revealed when the
 * category is picked; a `soon` category is a disabled list entry with no content. */
export type DoorCategory = {
  key: string
  title: string
  soon?: boolean
  content?: React.ReactNode
}

/** The bare discovery door: a single unlabelled ⌕ line that presses open to a
 * vertical category list; picking a live category reveals its search UI, with a
 * breadcrumb of the picked title next to the ⌕ and a link back to the list.
 * Press-only (no hover) — mobile-first. `header` renders above the list when open
 * (planning uses it for the location picker). */
export function PlaceDoor({
  categories,
  header,
}: {
  categories: DoorCategory[]
  header?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<string | null>(null)

  const active = categories.find((c) => c.key === picked && !c.soon) ?? null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Find a place"
        className="flex w-full items-center gap-2.5 py-1 text-left"
      >
        <span aria-hidden className="text-[15px] text-moss">
          ⌕
        </span>
        {active ? (
          <span className="font-serif text-[15px] text-muted-foreground">
            {active.title}
          </span>
        ) : null}
        <span
          aria-hidden
          className={`ml-auto font-mono text-[12px] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
      </button>

      {open ? (
        <div className="mt-2">
          {header ? <div className="mb-3">{header}</div> : null}
          {active ? (
            <>
              {active.content}
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                ← categories
              </button>
            </>
          ) : (
            <div className="flex flex-col">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={c.soon}
                  onClick={() => setPicked(c.key)}
                  className="flex items-baseline gap-2 py-1.5 text-left font-serif text-[15px] text-foreground hover:text-moss disabled:text-muted-foreground disabled:hover:text-muted-foreground"
                >
                  {c.title}
                  {c.soon ? (
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                      soon
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
