"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door content: Food + Activities search near a place
 * and add picks to one of its days. With itinerary locations, a picker (the
 * door's header) chooses which one; with none yet, it falls back to the trip
 * header (destination) so the door still works — searching is enabled, and
 * adding waits on a day (DiscoverySection shows "add a day first"). */
export function PlanningPlaceDoor({
  tripId,
  tripSlug,
  destination,
  locations = [],
  days = [],
}: {
  tripId: string
  tripSlug: string
  destination: string
  locations?: ItineraryLocation[]
  days?: ItineraryDay[]
}) {
  const [locId, setLocId] = React.useState("")

  const hasLocations = locations.length > 0
  const location = hasLocations
    ? locations.find((l) => l.id === locId) ?? locations[0]
    : null

  // No location yet -> search around the trip header; picks wait on a day.
  const near = location ? location.name : destination
  const keyBase = location ? location.id : "trip"
  const cta = location ? `add to ${location.name}` : "add to a day"

  const dayOptions = location
    ? days
        .filter((d) => d.locationId === location.id)
        .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
        .map((d) => ({ id: d.id, dayDate: d.dayDate, label: `Day ${d.d} · ${d.date}` }))
    : []

  // Only offer the picker when there's a choice to make.
  const header = location ? (
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
  ) : null

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: (
        <DiscoverySection
          key={`${keyBase}-food`}
          category="food"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={near}
          when="dinner"
          defaultNear={near}
          defaultWalkable={false}
          addTarget={{ kind: "select", days: dayOptions }}
          buildEventText={(s) => `Dinner · ${s.name}`}
          ctaLabel={cta}
        />
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: (
        <DiscoverySection
          key={`${keyBase}-activity`}
          category="activity"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={near}
          when=""
          defaultNear={near}
          defaultWalkable={false}
          addTarget={{ kind: "select", days: dayOptions }}
          buildEventText={(s) => s.name}
          ctaLabel={cta}
        />
      ),
    },
    { key: "stay", title: "Accommodation", soon: true },
    { key: "transport", title: "Transport", soon: true },
  ]

  return <PlaceDoor categories={categories} header={header} />
}
