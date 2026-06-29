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
        body: JSON.stringify({ destination, when: mealWhen(activeMeal) }),
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

  function addToToday(s: RestaurantSuggestion) {
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate,
      dayId,
      time: "",
      text: `${label} · ${s.name}`,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded((prev) => new Set(prev).add(s.name))
      router.refresh()
    })
  }

  return (
    <section className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · suggestion
      </span>
      {suggestions === null ? (
        <button
          type="button"
          onClick={find}
          disabled={loading}
          className="mt-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {loading ? "searching…" : `find ${activeMeal}`}
        </button>
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
              <button
                type="button"
                onClick={() => addToToday(s)}
                disabled={added.has(s.name)}
                className="mt-1 self-start rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {added.has(s.name) ? "added" : "add to today"}
              </button>
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
