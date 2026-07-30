"use client"

import { NudgeLine } from "@/components/nudge-line"
import type { Nudge } from "@/lib/nudges/types"

/** Free nudge whose help tap scrolls to the expense form. Spends no tokens --
 * unlike RoadNudge it never touches the assistant. */
export function CatchUpNudge({ nudge }: { nudge: Nudge }) {
  return (
    <div className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card px-4 py-3">
      <NudgeLine
        nudge={nudge}
        onHelp={() =>
          document
            .getElementById("road-expense")
            ?.scrollIntoView({ behavior: "smooth" })
        }
      />
    </div>
  )
}
