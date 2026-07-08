"use client"

import * as React from "react"

import { useAiMode } from "@/components/ai-mode"
import { CategorySection } from "@/components/category-section"
import { DiscoverySection } from "@/components/discovery-section"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door: pick a location, then a four-section accordion
 * (Food + Activities live; Accommodation + Transport coming soon) searches near
 * it and adds picks to one of that location's days. */
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
  const { enabled } = useAiMode()
  const [locId, setLocId] = React.useState("")

  if (!enabled || locations.length === 0) return null

  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const dayOptions = days
    .filter((d) => d.locationId === location.id)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
    .map((d) => ({
      id: d.id,
      dayDate: d.dayDate,
      label: `Day ${d.d} · ${d.date}`,
    }))

  return (
    <section className="mt-3 rounded-[14px] border border-l-2 border-border border-l-moss bg-card p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
        AI · plan a place
      </span>
      <select
        value={location.id}
        onChange={(e) => setLocId(e.target.value)}
        className="mt-2 block rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <div className="mt-3 flex flex-col gap-1">
        <CategorySection title="Food" defaultOpen>
          <DiscoverySection
            key={`${location.id}-food`}
            category="food"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={location.name}
            when="dinner"
            defaultNear={location.name}
            defaultWalkable={false}
            addTarget={{ kind: "select", days: dayOptions }}
            buildEventText={(s) => `Dinner · ${s.name}`}
            ctaLabel={`add to ${location.name}`}
          />
        </CategorySection>

        <CategorySection title="Activities">
          <DiscoverySection
            key={`${location.id}-activity`}
            category="activity"
            tripId={tripId}
            tripSlug={tripSlug}
            destination={location.name}
            when=""
            defaultNear={location.name}
            defaultWalkable={false}
            addTarget={{ kind: "select", days: dayOptions }}
            buildEventText={(s) => s.name}
            ctaLabel={`add to ${location.name}`}
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
