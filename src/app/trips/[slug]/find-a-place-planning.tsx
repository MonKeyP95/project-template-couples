"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAiMode } from "@/components/ai-mode"
import { addTodayEvent } from "@/lib/trips/actions"
import type { RestaurantSuggestion } from "@/lib/ai/restaurant-discovery-types"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door: pick a location, find restaurants near it,
 * add a pick to that location's earliest day. Planning twin of the on-the-road
 * FindAPlace; shares the /api/ai/discover engine (preference-aware via B2). */
export function FindAPlacePlanning({
  tripId,
  tripSlug,
  locations,
  days,
}: {
  tripId: string
  tripSlug: string
  locations: ItineraryLocation[]
  days: ItineraryDay[]
}) {
  const router = useRouter()
  const { enabled } = useAiMode()
  const [locId, setLocId] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<
    RestaurantSuggestion[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<Set<string>>(new Set())
  const [confirmingName, setConfirmingName] = React.useState<string | null>(null)
  const [selDayId, setSelDayId] = React.useState("")
  const [time, setTime] = React.useState("")

  if (!enabled || locations.length === 0) return null

  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const locDays = days
    .filter((d) => d.locationId === location.id)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate))

  async function find() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: location.name, when: "dinner" }),
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

  function commit(s: RestaurantSuggestion) {
    const day = locDays.find((d) => d.id === selDayId) ?? locDays[0]
    if (!day) return
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: day.dayDate,
      dayId: day.id,
      time: time.trim(),
      text: `Dinner · ${s.name}`,
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
    <section className="mt-3 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · find a place to eat
      </span>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={location.id}
          onChange={(e) => {
            setLocId(e.target.value)
            setSuggestions(null)
            setError(null)
            setConfirmingName(null)
          }}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={find}
          disabled={loading}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {loading ? "searching…" : "find dinner"}
        </button>
      </div>

      {suggestions && suggestions.length === 0 ? (
        <div className="mt-2 text-[13px] text-muted-foreground">
          No places found — try again later.
        </div>
      ) : null}

      {suggestions && suggestions.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-4">
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
              ) : locDays.length === 0 ? (
                <span
                  title="Add a day to this location first"
                  className="mt-1 self-start rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add a day first
                </span>
              ) : confirmingName === s.name ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <select
                    value={selDayId}
                    onChange={(e) => setSelDayId(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                  >
                    {locDays.map((d) => (
                      <option key={d.id} value={d.id}>
                        Day {d.d} · {d.date}
                      </option>
                    ))}
                  </select>
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
                    setSelDayId(locDays[0].id)
                    setTime("")
                  }}
                  className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add to {location.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </section>
  )
}
