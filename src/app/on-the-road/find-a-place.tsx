"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import { currentMeal, mealLabel, mealWhen, type Meal } from "./meal-slot"

/** On-the-road discovery door content for the assistant block: Food (anchored to
 * the current meal) + Activities, added straight to today's day. Accommodation
 * and Transport are placeholders. */
export function RoadPlaceDoor({
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
  // Meal is a client-only value (device clock); null during SSR to avoid a
  // hydration mismatch, per the React 19 useSyncExternalStore pattern.
  const meal = React.useSyncExternalStore<Meal | null>(
    () => () => {},
    () => currentMeal(new Date()),
    () => null,
  )
  const label = meal ? mealLabel(meal) : "Meal"

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: (
        <DiscoverySection
          category="food"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={destination}
          when={meal ? mealWhen(meal) : ""}
          defaultNear={destination}
          defaultWalkable
          addTarget={{ kind: "fixed", dayDate, dayId }}
          buildEventText={(s) => `${label} · ${s.name}`}
          ctaLabel="add to today"
        />
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: (
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
      ),
    },
    { key: "stay", title: "Accommodation", soon: true },
    { key: "transport", title: "Transport", soon: true },
  ]

  return <PlaceDoor categories={categories} />
}
