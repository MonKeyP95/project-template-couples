import { redirect } from "next/navigation"

import { Coord, Label, TopoBg } from "@/components/together"
import { isDarkTheme } from "@/lib/theme"
import { LeftRail, MobileHeaderNav, buildNavDestinations } from "@/components/app-nav"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getTodayForTrip, getItineraryDays } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { slugToTone } from "@/lib/trips/slug-tone"
import { formatShortDate, daySummary } from "@/lib/trips/itinerary-types"
import { getWeather } from "@/lib/weather/get-weather"
import { WeatherCard } from "@/components/weather-card"
import {
  getTripExpenseCategories,
  getTripExpenses,
} from "@/lib/trips/expense-queries"
import { getNotesForDay } from "@/lib/trips/note-queries"
import { computeLookingAhead } from "@/lib/trips/looking-ahead"
import { localToday } from "@/lib/time/local-today"

import { AiSuggestion } from "@/components/ai-suggestion"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { QuickExpense } from "./quick-expense"
import { QuickNote } from "./quick-note"
import { LookingAheadPanel } from "./looking-ahead-panel"
import { AddTodayEvent } from "./add-today-event"
import { TodayUpcoming } from "./today-upcoming"
import { TodayPast } from "./today-past"
import { FindAPlace } from "./find-a-place"

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
})

export default async function OnTheRoadPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/on-the-road")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const buckets = await listTripsForWorkspace(workspace.id)
  const trip = buckets.now[0]
  if (!trip) redirect("/home")

  const today = await localToday()
  const todayDay = await getTodayForTrip(trip.id, today)
  const locations = await getItineraryLocations(trip.id)
  const tone = slugToTone(trip.slug)
  const dark = await isDarkTheme()
  const navDestinations = buildNavDestinations({
    onTheRoad: true,
    tripSlug: trip.slug,
  })

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

  const fullDate = `${WEEKDAY_FMT.format(new Date(`${today}T00:00:00Z`))} ${formatShortDate(today)}`
  const locationName = todayDay?.locationId
    ? locations.find((l) => l.id === todayDay.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? "On the road"
  // "On the road" is a UI placeholder, not a place to search — fall back to the
  // trip's country/name instead.
  const searchDestination = locationName ?? trip.country ?? trip.name

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[440px] pb-16 lg:flex lg:max-w-none lg:items-stretch lg:pb-0">
      <RealtimeRefresh
        tripId={trip.id}
        tables={["expenses", "trip_notes", "itinerary_days"]}
      />
      <LeftRail
        workspace={workspace}
        initialDark={dark}
        destinations={navDestinations}
        current="on-the-road"
      />
      <div className="px-5 pt-6 pb-16 lg:min-w-0 lg:flex-1 lg:px-8 lg:py-8">
        <MobileHeaderNav
          destinations={navDestinations}
          current="on-the-road"
          className="mb-4"
        />
        <Label className="mb-4 block">{`On the road · ${trip.name}`}</Label>
        <AiSuggestion surface="road" tripSlug={trip.slug} className="mb-4 block" />

      <section className="relative overflow-hidden rounded-[14px] border border-border bg-card p-5">
        <TopoBg tone={tone} opacity={0.12} />
        <div className="relative">
          <Coord>{fullDate}</Coord>
          <div className="t-display mt-2 text-[36px] leading-none text-foreground">
            <em>{place}</em>
          </div>
          {weather ? <WeatherCard weather={weather} className="mt-3" /> : null}
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
            <TodayUpcoming events={todayDay.events} />
            <TodayPast
              tripSlug={trip.slug}
              dayId={todayDay.id}
              events={todayDay.events}
            />
          </>
        ) : (
          <div className="mt-2 text-[13px] text-muted-foreground">
            Nothing planned for today.
          </div>
        )}
        <AddTodayEvent
          tripId={trip.id}
          tripSlug={trip.slug}
          dayDate={today}
          dayId={todayDay?.id ?? null}
        />
      </section>

      <FindAPlace
        tripId={trip.id}
        tripSlug={trip.slug}
        dayDate={today}
        dayId={todayDay?.id ?? null}
        destination={searchDestination}
      />

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
      </div>
    </main>
  )
}
