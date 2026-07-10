"use client"

import { NudgeLine } from "@/components/nudge-line"
import { useAiMode } from "@/components/ai-mode"
import type { Nudge } from "@/lib/nudges/types"

/** On-the-road nudge: a free line whose help tap expands the assistant block
 * (turning AI on) and scrolls to it, where the find-a-place door lives. Expanding
 * is free; the token spend is one further explicit tap (running a door search). */
export function RoadNudge({ nudge }: { nudge: Nudge }) {
  const { setEnabled } = useAiMode()
  function onHelp() {
    setEnabled(true)
    document
      .getElementById("road-assistant")
      ?.scrollIntoView({ behavior: "smooth" })
  }
  return (
    <div className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card px-4 py-3">
      <NudgeLine nudge={nudge} onHelp={onHelp} />
    </div>
  )
}
