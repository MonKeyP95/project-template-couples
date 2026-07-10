"use client"

import type { Nudge } from "@/lib/nudges/types"

/** Presentational: the free nudge text plus an optional help button. The help
 * action (token-spending) is supplied by the caller via onHelp. */
export function NudgeLine({
  nudge,
  onHelp,
}: {
  nudge: Nudge
  onHelp?: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12.5px] leading-snug text-moss">{nudge.text}</p>
      {nudge.help && onHelp ? (
        <button
          type="button"
          onClick={onHelp}
          className="self-start font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss"
        >
          {nudge.help.label}
        </button>
      ) : null}
    </div>
  )
}
