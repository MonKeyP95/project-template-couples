"use client"

import * as React from "react"

import { AssistantPill, useAiMode } from "@/components/ai-mode"
import { AssistantPanel } from "@/components/assistant-block"

import { toolbarPill } from "./plan-itinerary"

export type BudgetPanel = "expense" | "saved" | "settle"

/** `phoneOnly` pills are hidden on wide screens, where their panel has its own box. */
const PILLS: { key: BudgetPanel; label: string; phoneOnly?: boolean }[] = [
  { key: "saved", label: "saved", phoneOnly: true },
  { key: "settle", label: "settle", phoneOnly: true },
]

/** The budget page's pill row, mirroring the itinerary's: a pill opens its
 * panel on a full line below the pills, one panel at a time. The assistant
 * pill is the AI on/off switch, as on the itinerary, so it opens independently. */
export function BudgetToolbar({
  tripSlug,
  showAssistantPill,
  title,
  door,
  drafter,
  renderPanel,
}: {
  tripSlug: string
  /** Phones only; wider screens have the assistant pill in the tab row. */
  showAssistantPill: boolean
  /** Wide screens only: shown left of the pills. */
  title: React.ReactNode
  door: React.ReactNode
  /** The budget drafter: renders its own pill and, when open, its own box. */
  drafter: React.ReactNode
  renderPanel: (panel: BudgetPanel, close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState<BudgetPanel | null>(null)
  const { enabled: aiEnabled } = useAiMode()
  const close = () => setOpen(null)

  function pill(key: BudgetPanel, label: string, phoneOnly = false) {
    return (
      <button
        key={key}
        type="button"
        onClick={() => setOpen(open === key ? null : key)}
        aria-expanded={open === key}
        className={`${toolbarPill(open === key)} ${phoneOnly ? "lg:hidden" : ""}`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pt-4 lg:pt-7">
      <div className="hidden lg:mr-auto lg:block">{title}</div>
      {pill("expense", "+ expense")}
      {showAssistantPill ? <AssistantPill /> : null}
      {PILLS.map((p) => pill(p.key, p.label, p.phoneOnly))}
      {drafter}
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
