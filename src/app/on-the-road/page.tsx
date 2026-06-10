import { redirect } from "next/navigation"

import { Coord, Label, TopoBg } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getTodayForTrip, getItineraryDays } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { slugToTone } from "@/lib/trips/slug-tone"
import { formatShortDate, daySummary } from "@/lib/trips/itinerary-types"
import { dayWithinTrip } from "@/app/home/format-helpers"
import { getWeather } from "@/lib/weather/get-weather"
import { TodayNextEvent } from "@/app/home/today-next-event"
import {
  getTripExpenseCategories,
  getTripExpenses,
} from "@/lib/trips/expense-queries"
import { getNotesForDay } from "@/lib/trips/note-queries"
import { computeLookingAhead } from "@/lib/trips/looking-ahead"

import { QuickExpense } from "./quick-expense"
import { QuickNote } from "./quick-note"
import { LookingAheadPanel } from "./looking-ahead-panel"

export default async function OnTheRoadPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/on-the-road")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const buckets = await listTripsForWorkspace(workspace.id)
  const trip = buckets.now[0]
  if (!trip) redirect("/home")

  const today = new Date().toISOString().slice(0, 10)
  const todayDay = await getTodayForTrip(trip.id, today)
  const locations = await getItineraryLocations(trip.id)
  const tone = slugToTone(trip.slug)

  const weather =
    trip.lat != null && trip.lng != null
      ? await getWeather(trip.lat, trip.lng)
      : null

  const categories = await getTripExpenseCategories(trip.id)
  const expenses = await getTripExpenses(trip.id)
  const spentTodayCents = expenses
    .filter((e) => !e.isSettlement && e.dayDate === today)
    .reduce((sum, e) => sum + e.amountCents, 0)
  const notes = await getNotesForDay(trip.id, today)
  const days = await getItineraryDays(trip.id)
  const ahead = computeLookingAhead(
    today,
    todayDay?.locationId ?? null,
    days,
    locations,
  )

  const dayCount = dayWithinTrip(trip.startDate, trip.endDate)
  const locationName = todayDay?.locationId
    ? locations.find((l) => l.id === todayDay.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? "On the road"

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] px-5 pt-12 pb-16 md:max-w-[560px] md:px-8">
      <header className="mb-6 flex items-center justify-between">
        <Label>{`On the road · ${trip.name}`}</Label>
        <a
          href="/home"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          home
        </a>
      </header>

      <section className="relative overflow-hidden rounded-[14px] border border-border bg-card p-5">
        <TopoBg tone={tone} opacity={0.12} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coord>{formatShortDate(today)}</Coord>
              {weather ? (
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  {Math.round(weather.tempC)}°
                </span>
              ) : null}
            </div>
            {dayCount ? (
              <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                day {dayCount.day} / {dayCount.total}
              </span>
            ) : null}
          </div>
          <div className="t-display mt-2 text-[36px] leading-none text-foreground">
            <em>{place}</em>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
        <Label>Today</Label>
        {todayDay ? (
          <>
            <div className="t-display mt-2 text-[24px] leading-tight text-foreground">
              {todayDay.title}
            </div>
            {daySummary(todayDay) ? (
              <div className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {daySummary(todayDay)}
              </div>
            ) : null}
            <TodayNextEvent events={todayDay.events} />
          </>
        ) : (
          <div className="mt-2 text-[13px] text-muted-foreground">
            Nothing planned for today.
          </div>
        )}
      </section>

      <QuickExpense
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        currentUserId={userData.user.id}
        categories={categories}
        spentTodayCents={spentTodayCents}
      />

      <QuickNote
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        notes={notes}
      />

      <LookingAheadPanel ahead={ahead} />
    </main>
  )
}
