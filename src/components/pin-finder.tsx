"use client"

import * as React from "react"

import { PinChoices } from "@/components/pin-choices"
import { searchPinCandidates } from "@/lib/places/pin-actions"
import type { PlaceMatch } from "@/lib/weather/geocode"

/** "Find" looks `query` up and lists the matches to pin. The list stays only
 * while `query` is what was searched, so a stale list never shows. */
export function PinFinder({
  query,
  prefer,
  value,
  onChange,
  disabled,
}: {
  query: string
  prefer: string | null
  value: PlaceMatch | null
  onChange: (pin: PlaceMatch | null) => void
  disabled?: boolean
}) {
  const [found, setFound] = React.useState<{ query: string; matches: PlaceMatch[] } | null>(
    null,
  )
  const [isSearching, startSearch] = React.useTransition()
  const trimmed = query.trim()

  function find() {
    startSearch(async () => {
      setFound({ query: trimmed, matches: await searchPinCandidates(trimmed, prefer) })
    })
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {value ? `Pinned: ${value.fullName}` : "Not pinned"}
        </span>
        <button
          type="button"
          onClick={find}
          disabled={disabled || isSearching || !trimmed}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-clay hover:text-foreground disabled:opacity-40"
        >
          {isSearching ? "finding" : "find"}
        </button>
      </div>
      {found && found.query === trimmed ? (
        <PinChoices matches={found.matches} value={value} onPick={onChange} />
      ) : null}
    </div>
  )
}
