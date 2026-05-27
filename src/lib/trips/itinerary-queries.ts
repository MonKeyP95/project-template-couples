import { createClient } from "@/lib/supabase/server"

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

const DOW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
})

const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function toUtc(dayDate: string): Date {
  return new Date(`${dayDate}T00:00:00Z`)
}

export async function getItineraryDays(
  tripId: string,
): Promise<ItineraryDay[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("day_date, title, sub, tag, tone")
    .eq("trip_id", tripId)
    .order("day_date", { ascending: true })

  return (data ?? []).map((row, i) => {
    const utc = toUtc(row.day_date)
    return {
      d: String(i + 1).padStart(2, "0"),
      dow: DOW_FMT.format(utc),
      date: SHORT_DATE_FMT.format(utc),
      title: row.title,
      sub: row.sub ?? "",
      tag: row.tag,
      tone: row.tone as ItineraryTone,
    }
  })
}
