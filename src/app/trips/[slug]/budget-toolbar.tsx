"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { AssistantPanel } from "@/components/assistant-block"

import { toolbarPill } from "./plan-itinerary"

export type BudgetPanel = "expense" | "saved" | "settle" | "plan"

const PILLS: { key: BudgetPanel; label: string }[] = [
  { key: "saved", label: "saved" },
  { key: "settle", label: "settle" },
  { key: "plan", label: "plan a budget" },
]

/** The budget page's pill row, mirroring the itinerary's: a pill opens its
 * panel on a full line below the pills, one panel at a time. The assistant
 * pill is the AI on/off switch, as on the itinerary, so it opens independently. */
export function BudgetToolbar({
  tripSlug,
  door,
  renderPanel,
}: {
  tripSlug: string
  door: React.ReactNode
  renderPanel: (panel: BudgetPanel, close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState<BudgetPanel | null>(null)
  const { enabled: aiEnabled, setEnabled: setAiEnabled } = useAiMode()
  const close = () => setOpen(null)

  function pill(key: BudgetPanel, label: string) {
    return (
      <button
        key={key}
        type="button"
        onClick={() => setOpen(open === key ? null : key)}
        aria-expanded={open === key}
        className={toolbarPill(open === key)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
      {pill("expense", "+ expense")}
      <button
        type="button"
        onClick={() => setAiEnabled(!aiEnabled)}
        aria-expanded={aiEnabled}
        className={`rounded-full border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-moss ${
          aiEnabled ? "border-moss" : "border-border hover:border-moss"
        }`}
      >
        assistant
      </button>
      {PILLS.map((p) => pill(p.key, p.label))}
      {aiEnabled ? (
        <div className="order-last w-full rounded-[14px] border border-l-2 border-border border-l-moss bg-card">
          <AssistantPanel surface="budget" tripSlug={tripSlug} door={door} />
        </div>
      ) : null}
      {open ? (
        <div className="order-last w-full overflow-hidden rounded-xl border border-border bg-card">
          {renderPanel(open, close)}
        </div>
      ) : null}
    </div>
  )
}
