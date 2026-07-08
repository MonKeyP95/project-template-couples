"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { CategorySection } from "@/components/category-section"
import { DiscoverySection } from "@/components/discovery-section"
import { currentMeal, mealLabel, mealWhen, type Meal } from "./meal-slot"

/** On-the-road discovery door: a four-section accordion (Food + Activities live;
 * Accommodation + Transport coming soon) anchored to today. Renders whenever AI
 * mode is on and a device-local meal is known. */
export function FindAPlace({
  tripId,
  tripSlug,
  dayDate,
  dayId,
  destination,
}: {
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
  destination: string
}) {
  const { enabled } = useAiMode()

  // Meal is a client-only value: the server has no device clock, so it must be
  // null during SSR to avoid a hydration mismatch. useSyncExternalStore is the
  // React 19 way to read such a value without setState-in-effect.
  const meal = React.useSyncExternalStore<Meal | null>(
    () => () => {},
    () => currentMeal(new Date()),
    () => null,
  )

  if (!enabled || !meal) return null

  const activeMeal: Meal = meal
  const label = mealLabel(activeMeal)

  return (
    <section className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · suggestions
      </span>
      <div className="mt-2 flex flex-col gap-1">
        <CategorySection title="Food" defaultOpen>
          <DiscoverySection
            category="food"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={destination}
            when={mealWhen(activeMeal)}
            defaultNear={destination}
            defaultWalkable
            addTarget={{ kind: "fixed", dayDate, dayId }}
            buildEventText={(s) => `${label} · ${s.name}`}
            ctaLabel="add to today"
          />
        </CategorySection>

        <CategorySection title="Activities">
          <DiscoverySection
            category="activity"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={destination}
            when=""
            defaultNear={destination}
            defaultWalkable
            addTarget={{ kind: "fixed", dayDate, dayId }}
            buildEventText={(s) => s.name}
            ctaLabel="add to today"
          />
        </CategorySection>

        <CategorySection title="Accommodation" hint="coming soon">
          <p className="text-[13px] text-muted-foreground">
            Coming soon — find a place to stay.
          </p>
        </CategorySection>

        <CategorySection title="Transport" hint="coming soon">
          <p className="text-[13px] text-muted-foreground">
            Coming soon — find how to get around.
          </p>
        </CategorySection>
      </div>
    </section>
  )
}
