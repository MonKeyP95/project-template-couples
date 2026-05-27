import type { WeatherGlyph } from "@/components/together"

export type ItineraryTone = "sea" | "clay" | "moss" | "sand"

export interface ItineraryDay {
  d: string
  dow: string
  date: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface WeatherDay {
  d: string
  t: number
  glyph: WeatherGlyph
}

/**
 * Trip detail parts NOT yet in the database. The itinerary lands in the DB at
 * step 8; weather is likely to come from an external API later. For now we
 * compose a live `TripHeader` from Supabase with a static `TripDetail` from here.
 */
export interface TripDetail {
  itinerary: ItineraryDay[]
  weather: WeatherDay[]
  /** Index into `weather` for the day the user is currently on. */
  weatherActive: number
}

const LOMBOK_DETAIL: TripDetail = {
  weatherActive: 2,
  weather: [
    { d: "THU", t: 28, glyph: "sun" },
    { d: "FRI", t: 29, glyph: "sun" },
    { d: "SAT", t: 29, glyph: "sun" },
    { d: "SUN", t: 27, glyph: "haze" },
    { d: "MON", t: 26, glyph: "rain" },
    { d: "TUE", t: 28, glyph: "sun" },
    { d: "WED", t: 29, glyph: "sun" },
  ],
  itinerary: [
    {
      d: "01",
      dow: "Sat",
      date: "Jun 12",
      title: "Land in Mataram",
      sub: "Pickup → south to Kuta. Sunset at Mandalika.",
      tag: "ARRIVE",
      tone: "sand",
    },
    {
      d: "02",
      dow: "Sun",
      date: "Jun 13",
      title: "Selong Belanak",
      sub: "Long lefts. Lunch at the warung. Mawi at golden.",
      tag: "SURF",
      tone: "sea",
    },
    {
      d: "03",
      dow: "Mon",
      date: "Jun 14",
      title: "Gili Trawangan",
      sub: "Ferry 09:00. Refresher dive + snorkel turtles.",
      tag: "DIVE",
      tone: "sea",
    },
    {
      d: "04",
      dow: "Tue",
      date: "Jun 15",
      title: "Gili Meno · slow",
      sub: "Hammock day. Sunset dive 17:00.",
      tag: "DIVE",
      tone: "sea",
    },
    {
      d: "05",
      dow: "Wed",
      date: "Jun 16",
      title: "Senaru gateway",
      sub: "Return to Lombok. Drive to Senaru. Pre-trek brief.",
      tag: "TRANSIT",
      tone: "clay",
    },
    {
      d: "06",
      dow: "Thu",
      date: "Jun 17",
      title: "Rinjani · ascent",
      sub: "Sembalun route. Camp at 2,639m. Cold night.",
      tag: "TREK",
      tone: "moss",
    },
    {
      d: "07",
      dow: "Fri",
      date: "Jun 18",
      title: "Rinjani · summit",
      sub: "02:30 push. 3,726m. Descent to crater lake.",
      tag: "TREK",
      tone: "moss",
    },
    {
      d: "08",
      dow: "Sat",
      date: "Jun 19",
      title: "Slow morning + fly",
      sub: "Hot springs, drive south, evening flight.",
      tag: "DEPART",
      tone: "sand",
    },
  ],
}

const DETAIL_BY_SLUG: Record<string, TripDetail> = {
  lombok: LOMBOK_DETAIL,
}

export function getTripDetailBySlug(slug: string): TripDetail | null {
  return DETAIL_BY_SLUG[slug] ?? null
}
