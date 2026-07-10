"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door content: Food + Activities search near a place
 * and add picks to one of its days. With itinerary locations, a picker (the
 * door's header) chooses which one. With none yet, the harness rule applies:
 * ask "where in {destination}?" instead of silently searching the bare trip
 * header, and anchor the search on what they type. */
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
  const [askedPlace, setAskedPlace] = React.useState("")

  const hasLocations = locations.length > 0
  const location = hasLocations
    ? locations.find((l) => l.id === locId) ?? locations[0]
    : null

  // With a location, anchor on it. Without, anchor on what they type -- never a
  // bare country fallback.
  const place = location ? location.name : askedPlace.trim()
  const needsPlace = !place
  const keyBase = location ? location.id : place
  const cta = location ? `add to ${location.name}` : "add to a day"

  const dayOptions = location
    ? days
        .filter((d) => d.locationId === location.id)
        .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
        .map((d) => ({ id: d.id, dayDate: d.dayDate, label: `Day ${d.d} · ${d.date}` }))
    : []

  // Location picker when there is a choice; otherwise the "where?" prompt field.
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
  ) : (
    <input
      type="text"
      value={askedPlace}
      onChange={(e) => setAskedPlace(e.target.value)}
      placeholder={`Where in ${destination} are you headed?`}
      className="block w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
    />
  )

  // Until a place is known, prompt instead of searching an empty destination.
  const prompt = (
    <p className="text-[13px] text-muted-foreground">
      Tell me where in {destination} first.
    </p>
  )

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: needsPlace ? (
        prompt
      ) : (
        <DiscoverySection
          key={`${keyBase}-food`}
          category="food"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={place}
          when="dinner"
          defaultNear={place}
          defaultWalkable={false}
          addTarget={{
            kind: "select",
            days: dayOptions,
            locationId: location?.id ?? null,
            newDayTitle: location?.name,
            defaultDate: location?.startDate ?? undefined,
          }}
          buildEventText={(s) => `Dinner · ${s.name}`}
          ctaLabel={cta}
        />
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: needsPlace ? (
        prompt
      ) : (
        <DiscoverySection
          key={`${keyBase}-activity`}
          category="activity"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={place}
          when=""
          defaultNear={place}
          defaultWalkable={false}
          addTarget={{
            kind: "select",
            days: dayOptions,
            locationId: location?.id ?? null,
            newDayTitle: location?.name,
            defaultDate: location?.startDate ?? undefined,
          }}
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
