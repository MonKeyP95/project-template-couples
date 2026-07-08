"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addTodayEvent } from "@/lib/trips/actions"
import type {
  DiscoveryCategory,
  DiscoverySuggestion,
} from "@/lib/ai/discovery-types"

/** Where an added pick lands: a fixed day (on-the-road today) or a chosen day
 * from a list (planning). The parent supplies exactly one shape. */
export type AddTarget =
  | { kind: "fixed"; dayDate: string; dayId: string | null }
  | { kind: "select"; days: { id: string; dayDate: string; label: string }[] }

/** The shared discovery body for one category: craving/near/walkable inputs, the
 * web-search call to /api/ai/discover, the results list, and the add affordance.
 * Mode-specific context (destination, when, defaults, add target, event text)
 * comes in as props. */
export function DiscoverySection({
  category,
  tripId,
  tripSlug,
  destination,
  when,
  defaultNear,
  defaultWalkable,
  addTarget,
  buildEventText,
  ctaLabel,
}: {
  category: DiscoveryCategory
  tripId: string
  tripSlug: string
  destination: string
  when: string
  defaultNear: string
  defaultWalkable: boolean
  addTarget: AddTarget
  buildEventText: (s: DiscoverySuggestion) => string
  ctaLabel: string
}) {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<
    DiscoverySuggestion[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<Set<string>>(new Set())
  const [confirmingName, setConfirmingName] = React.useState<string | null>(null)
  const [time, setTime] = React.useState("")
  const [craving, setCraving] = React.useState("")
  const [near, setNear] = React.useState(defaultNear)
  const [walkable, setWalkable] = React.useState(defaultWalkable)
  const [selDayId, setSelDayId] = React.useState("")

  const noDays = addTarget.kind === "select" && addTarget.days.length === 0

  async function find() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          destination,
          when,
          tripId,
          craving: craving.trim(),
          near: near.trim(),
          walkable,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Search failed.")
        return
      }
      setSuggestions(data.suggestions ?? [])
    } catch {
      setError("Search failed.")
    } finally {
      setLoading(false)
    }
  }

  function commit(s: DiscoverySuggestion) {
    let dayDate: string
    let dayId: string | null
    if (addTarget.kind === "fixed") {
      dayDate = addTarget.dayDate
      dayId = addTarget.dayId
    } else {
      const day =
        addTarget.days.find((d) => d.id === selDayId) ?? addTarget.days[0]
      if (!day) return
      dayDate = day.dayDate
      dayId = day.id
    }
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: time.trim(),
      text: buildEventText(s),
      url: s.sourceUrl,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      setConfirmingName(null)
      setTime("")
      router.refresh()
    })
  }

  return (
    <div>
      {suggestions === null ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={craving}
            onChange={(e) => setCraving(e.target.value)}
            placeholder="what do you feel like? (optional)"
            className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
          <input
            type="text"
            value={near}
            onChange={(e) => setNear(e.target.value)}
            placeholder="near…"
            className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <input
              type="checkbox"
              checked={walkable}
              onChange={(e) => setWalkable(e.target.checked)}
            />
            walking distance
          </label>
          <button
            type="button"
            onClick={find}
            disabled={loading}
            className="block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {loading ? "searching…" : "find"}
          </button>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-[13px] text-muted-foreground">
          No places found — try again later.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => (
            <li key={s.sourceUrl} className="flex flex-col gap-1">
              <div className="t-display text-[16px] leading-tight text-foreground">
                {s.name}
              </div>
              <div className="text-[13px] leading-snug text-muted-foreground">
                {s.why}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {s.area} · {s.priceHint}
              </div>
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
              >
                source — verify hours
              </a>
              {added.has(s.name) ? (
                <span className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
                  added
                </span>
              ) : noDays ? (
                <span
                  title="Add a day to this location first"
                  className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add a day first
                </span>
              ) : confirmingName === s.name ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {addTarget.kind === "select" ? (
                    <select
                      value={selDayId}
                      onChange={(e) => setSelDayId(e.target.value)}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                    >
                      {addTarget.days.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="19:30"
                    className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commit(s)}
                    className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                  >
                    add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingName(null)
                      setTime("")
                    }}
                    aria-label="Cancel"
                    className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingName(s.name)
                    if (addTarget.kind === "select") {
                      setSelDayId(addTarget.days[0].id)
                    }
                    setTime("")
                  }}
                  className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  {ctaLabel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}
