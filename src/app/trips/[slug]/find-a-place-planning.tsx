"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door content: a location picker (rendered as the
 * door's header) plus Food + Activities that search near the chosen location and
 * add picks to one of its days. */
export function PlanningPlaceDoor({
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
  const [locId, setLocId] = React.useState("")

  if (locations.length === 0) return null

  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const dayOptions = days
    .filter((d) => d.locationId === location.id)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
    .map((d) => ({ id: d.id, dayDate: d.dayDate, label: `Day ${d.d} · ${d.date}` }))

  const header = (
    <select
      value={location.id}
      onChange={(e) => setLocId(e.target.value)}
      className="block rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground"
    >
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  )

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: (
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
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: (
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
      ),
    },
    { key: "stay", title: "Accommodation", soon: true },
    { key: "transport", title: "Transport", soon: true },
  ]

  return <PlaceDoor categories={categories} header={header} />
}
