"use server"

import { searchPlaces, type PlaceMatch } from "@/lib/weather/geocode"

/** Up to five places named `query` for the couple to pin, matches in
 * `prefer` (the trip's country) first. Only reads public geocoding data. */
export async function searchPinCandidates(
  query: string,
  prefer: string | null,
): Promise<PlaceMatch[]> {
  if (!query.trim()) return []
  return searchPlaces(query.trim(), 5, prefer)
}
