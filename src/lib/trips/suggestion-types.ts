// No imports: a plain Node check script loads this file directly.

/** big = an activity worth comparing options for; small = a place to eat or drink. */
export type SuggestionKind = "big" | "small"

export interface SuggestionOption {
  name: string
  location: string
  /** In `currency`, the place's own money; converted only when it reaches the budget. */
  priceCents: number | null
  currency: string
  priceUnit: "total" | "per_person"
  url: string
  reviews: string
}

export interface TripSuggestion {
  id: string
  kind: SuggestionKind
  category: string
  title: string
  locationId: string | null
  /** The blank day it sits on; null = in the box. */
  dayIndex: number | null
  why: string
  /** Null until the card is first opened. */
  options: SuggestionOption[] | null
}

interface SuggestionOptionJson {
  name: string
  location: string
  price_cents: number | null
  currency: string
  price_unit: "total" | "per_person"
  url: string
  reviews: string
}

export interface TripSuggestionRow {
  id: string
  kind: SuggestionKind
  category: string
  title: string
  location_id: string | null
  day_index: number | null
  why: string
  options: SuggestionOptionJson[] | null
}

export function rowToSuggestion(row: TripSuggestionRow): TripSuggestion {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title,
    locationId: row.location_id,
    dayIndex: row.day_index,
    why: row.why,
    options:
      row.options?.map((o) => ({
        name: o.name,
        location: o.location,
        priceCents: o.price_cents,
        currency: o.currency,
        priceUnit: o.price_unit,
        url: o.url,
        reviews: o.reviews,
      })) ?? null,
  }
}

export function optionsToJson(options: SuggestionOption[]): SuggestionOptionJson[] {
  return options.map((o) => ({
    name: o.name,
    location: o.location,
    price_cents: o.priceCents,
    currency: o.currency,
    price_unit: o.priceUnit,
    url: o.url,
    reviews: o.reviews,
  }))
}

/** The day an idea sits on: its day when that day is blank, in range and not
 * already past; otherwise null (the box). */
export function ideaDay(
  day: number,
  dayCount: number,
  blank: ReadonlySet<number>,
  floor: number | null,
): number | null {
  if (day < 1 || day > dayCount || !blank.has(day)) return null
  if (floor !== null && day < floor) return null
  return day
}

/** The budget amount for an option: per-person prices count every member. */
export function costCents(option: SuggestionOption, memberCount: number): number | null {
  if (option.priceCents === null) return null
  return option.priceUnit === "per_person" ? option.priceCents * memberCount : option.priceCents
}
