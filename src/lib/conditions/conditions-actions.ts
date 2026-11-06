"use server"

import { searchPlaces, type PlaceMatch } from "@/lib/weather/geocode"
import type { Activity } from "./activity"
import { nearest } from "./distance"
import { getConditions, type Conditions } from "./get-conditions"

export type NearbyPlace = PlaceMatch & { distanceKm: number }

/** Up to three places named `query`, nearest to `origin` first, so "Kuta" in
 * Bali means Bali's Kuta. Only reads public forecast data. */
export async function findPlacesNear(
  query: string,
  origin: { lat: number; lng: number },
): Promise<NearbyPlace[]> {
  if (!query.trim()) return []
  return nearest(await searchPlaces(query.trim(), 10), origin, 3)
}

/** Conditions at a place the couple picked; nothing is stored. */
export async function conditionsAt(
  activity: Activity,
  place: PlaceMatch,
  dayDate: string,
): Promise<Conditions | null> {
  return getConditions(activity, place, dayDate)
}
