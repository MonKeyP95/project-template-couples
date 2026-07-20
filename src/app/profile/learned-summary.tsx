"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  isSummaryStale,
  type LearnedCategory,
} from "@/lib/preferences/couple-summary-types"
import {
  refreshCoupleSummary,
  saveCoupleSummary,
  refreshTripSummary,
  saveTripSummary,
} from "@/lib/preferences/couple-summary-actions"

/** The "What we've learned" block for one category on the couple profile. Shows
 * the editable markdown summary, a Save (no AI), and a refresh that auto-fires in
 * the background on mount when the summary is stale and AI is on. */
export function LearnedSummary({
  category,
  summaryMd,
  ratingCount,
  countAtGeneration,
  aiOn,
  tripId,
}: {
  category: LearnedCategory
  summaryMd: string
  ratingCount: number
  countAtGeneration: number
  aiOn: boolean
  tripId?: string
}) {
  const [text, setText] = React.useState(summaryMd)
  const [busy, setBusy] = React.useState(false)
  const stale = isSummaryStale(
    ratingCount,
    countAtGeneration,
    summaryMd.trim() !== "",
  )
  const newCount = Math.max(0, ratingCount - countAtGeneration)

  const refresh = React.useCallback(async () => {
    setBusy(true)
    const res = tripId
      ? await refreshTripSummary(tripId, category)
      : await refreshCoupleSummary(category)
    if (res.summaryMd !== undefined) setText(res.summaryMd)
    setBusy(false)
  }, [category, tripId])

  // Per-trip blocks (closed trips) auto-generate only on first view — when there
  // is no summary yet — then stay put; a redo is manual via Refresh. The general
  // sections keep drift-based auto-refresh (Slice 3 rewires them).
  const autoFire = tripId ? summaryMd.trim() === "" : stale
  const started = React.useRef(false)
  React.useEffect(() => {
    if (autoFire && aiOn && !started.current) {
      started.current = true
      void refresh()
    }
  }, [autoFire, aiOn, refresh])

  async function save() {
    setBusy(true)
    if (tripId) await saveTripSummary(tripId, category, text)
    else await saveCoupleSummary(category, text)
    setBusy(false)
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">{"What we've learned"}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Rate or plan places on your trips and a summary appears here."
        className="mt-2 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={save}
          disabled={busy}
        >
          Save
        </Button>
        {aiOn ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={busy}
          >
            {busy ? "Refreshing…" : stale ? `${newCount} new — refresh` : "Refresh"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Turn on AI to fold in your {newCount} new.
          </span>
        )}
      </div>
    </div>
  )
}
