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
import { getTripWeather } from "@/lib/weather/get-trip-weather"
import { WeatherCard } from "@/components/weather-card"
import {
  getTripExpenseCategories,
  getTripExpenses,
} from "@/lib/trips/expense-queries"
import { homeCents } from "@/lib/trips/expense-types"
import { getNotesForDay } from "@/lib/trips/note-queries"
import { computeLookingAhead } from "@/lib/trips/looking-ahead"
import { localToday } from "@/lib/time/local-today"
import { detectNearDailyCap } from "@/lib/nudges/near-daily-cap"
import { computeTripDays } from "@/lib/trips/trip-days"
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { budgetPace, dayLabel } from "@/lib/trips/budget-pace"
import { detectUnloggedDays } from "@/lib/nudges/unlogged-days"
import { PaceLine } from "@/components/budget-pace-strip"
import { CatchUpNudge } from "./catch-up-nudge"

import { CurrencyProvider } from "@/components/currency-context"
import { getRates } from "@/lib/fx/get-rates"

import { AssistantBlock } from "@/components/assistant-block"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { QuickExpense } from "./quick-expense"
import { QuickNote } from "./quick-note"
import { LookingAheadPanel } from "./looking-ahead-panel"
import { AddTodayEvent } from "./add-today-event"
import { TodayUpcoming } from "./today-upcoming"
import { TodayPast } from "./today-past"
import { RoadPlaceDoor } from "./find-a-place"
import { RoadNudge } from "./road-nudge"

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

  const rates = await getRates(trip.homeCurrency)

  const categories = await getTripExpenseCategories(trip.id)
  const expenses = await getTripExpenses(trip.id)
  const spentTodayCents = expenses
    .filter((e) => !e.isSettlement && e.dayDate === today)
    .reduce((sum, e) => sum + homeCents(e), 0)
  const capNudge = detectNearDailyCap({
    plannedBudgetCents: trip.plannedBudgetCents,
    tripDays: computeTripDays(trip.startDate, trip.endDate),
    spentTodayCents,
    currency: trip.homeCurrency,
  })
  const notes = await getNotesForDay(trip.id, today)
  const days = await getItineraryDays(trip.id)
  const ahead = computeLookingAhead(
    today,
    todayDay?.locationId ?? null,
    days,
    locations,
  )

  const budgetItems = await getBudgetItems(trip.id)
  const locationDays: Record<string, string[]> = {}
  for (const day of days) {
    if (day.locationId) (locationDays[day.locationId] ??= []).push(day.dayDate)
  }
  for (const dates of Object.values(locationDays)) dates.sort()

  const pace = budgetPace({
    startDate: trip.startDate,
    endDate: trip.endDate,
    today,
    plannedBudgetCents: trip.plannedBudgetCents,
    budgetItems,
    expenses: expenses.map((e) => ({
      category: e.category,
      dayDate: e.dayDate,
      isSettlement: e.isSettlement,
      amountCents: homeCents(e),
    })),
    locationDays,
  })
  const unloggedNudge = pace
    ? detectUnloggedDays({
        unloggedDays: pace.unloggedDays,
        lastLoggedLabel: pace.lastLogged ? dayLabel(pace.lastLogged) : null,
      })
    : null

  const fullDate = `${WEEKDAY_FMT.format(new Date(`${today}T00:00:00Z`))} ${formatShortDate(today)}`
  const locationName = todayDay?.locationId
    ? locations.find((l) => l.id === todayDay.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? "On the road"
  // "On the road" is a UI placeholder, not a place to search — fall back to the
  // trip's country/name instead.
  const searchDestination = locationName ?? trip.country ?? trip.name
  const weatherPlace = { ...trip, locationName }
  const weather = await getTripWeather(weatherPlace)

  return (
    <CurrencyProvider
      currency={trip.homeCurrency}
      spendCurrency={trip.currency}
      rates={rates}
    >
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
        <div id="road-assistant">
          <AssistantBlock
            surface="road"
            tripSlug={trip.slug}
            className="mb-4 block"
            door={
              <RoadPlaceDoor
                tripId={trip.id}
                tripSlug={trip.slug}
                dayDate={today}
                dayId={todayDay?.id ?? null}
                destination={searchDestination}
              />
            }
          />
        </div>

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

      {capNudge ? <RoadNudge nudge={capNudge} /> : null}

      {pace ? <PaceLine pace={pace} className="mt-4 block" /> : null}
      {unloggedNudge ? <CatchUpNudge nudge={unloggedNudge} /> : null}

      <div id="road-expense">
        <QuickExpense
          tripId={trip.id}
          tripSlug={trip.slug}
          today={today}
          tripStartDate={trip.startDate ?? today}
          currentPersonId={workspace.myPersonId ?? ""}
          categories={categories}
          spentTodayCents={spentTodayCents}
          locationCurrency={
            locations.find((l) => l.id === todayDay?.locationId)?.currency ?? null
          }
        />
      </div>

      <QuickNote
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        notes={notes}
      />

      <LookingAheadPanel ahead={ahead} />
      </div>
    </main>
    </CurrencyProvider>
  )
}
