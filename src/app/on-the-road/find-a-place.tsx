"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useAiMode } from "@/components/ai-mode"
import { addTodayEvent } from "@/lib/trips/actions"
import type { RestaurantSuggestion } from "@/lib/ai/restaurant-discovery-types"
import {
  currentMeal,
  mealAlreadyPlanned,
  mealLabel,
  mealWhen,
  type Meal,
} from "./meal-slot"

export function FindAPlace({
  tripId,
  tripSlug,
  dayDate,
  dayId,
  destination,
  todayEventTexts,
}: {
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
  destination: string
  todayEventTexts: string[]
}) {
  const router = useRouter()
  const { enabled } = useAiMode()
  const [loading, setLoading] = React.useState(false)
  const [suggestions, setSuggestions] = React.useState<
    RestaurantSuggestion[] | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<Set<string>>(new Set())
  const [confirmingName, setConfirmingName] = React.useState<string | null>(null)
  const [time, setTime] = React.useState("")
  const [craving, setCraving] = React.useState("")
  const [near, setNear] = React.useState(destination)
  const [walkable, setWalkable] = React.useState(true)

  // Meal is a client-only value: the server has no device clock, so it must be
  // null during SSR to avoid a hydration mismatch. useSyncExternalStore is the
  // React 19 way to read such a value without setState-in-effect.
  const meal = React.useSyncExternalStore<Meal | null>(
    () => () => {},
    () => currentMeal(new Date()),
    () => null,
  )

  if (!enabled || !meal) return null
  if (mealAlreadyPlanned(meal, todayEventTexts)) return null

  // Narrowed copy: TS doesn't carry the guard's narrowing into the closures.
  const activeMeal: Meal = meal
  const label = mealLabel(activeMeal)

  async function find() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          when: mealWhen(activeMeal),
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

  function commit(s: RestaurantSuggestion) {
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: time.trim(),
      text: `${label} · ${s.name}`,
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
    <section className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · suggestion
      </span>
      {suggestions === null ? (
        <div className="mt-2 flex flex-col gap-2">
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
            {loading ? "searching…" : `find ${activeMeal}`}
          </button>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="mt-2 text-[13px] text-muted-foreground">
          No places found — try again later.
        </div>
      ) : (
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
              ) : confirmingName === s.name ? (
                <div className="mt-1 flex items-center gap-2">
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
                    setTime("")
                  }}
                  className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
                >
                  add to today
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </section>
  )
}
