import { redirect } from "next/navigation"

import { Label } from "@/components/together"
import { BoxCard } from "@/components/collapsible-box"
import { isDarkTheme } from "@/lib/theme"
import {
  LeftRail,
  MobileNavPill,
  SignOutButton,
  buildNavDestinations,
} from "@/components/app-nav"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getTodayForTrip, getItineraryDays } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { formatShortDate, isDated } from "@/lib/trips/itinerary-types"
import { getTripWeather } from "@/lib/weather/get-trip-weather"
import { getUpcomingConditions } from "@/lib/conditions/day-conditions"
import { getUsualActivities } from "@/lib/conditions/usual-activities"
import { DispatchBox } from "@/components/dispatch-box"
import { getNewsDays } from "@/lib/trips/news-days"
import { DispatchTrigger } from "./dispatch-trigger"
import {
  getTripExpenseCategories,
  getTripExpenses,
} from "@/lib/trips/expense-queries"
import { homeCents } from "@/lib/trips/expense-types"
import { getTripDocuments, getTripReceipts, receiptClockMs } from "@/lib/trips/receipt-queries"
import { DocumentsToday } from "./documents-today"
import { ReceiptPile } from "@/components/receipts/receipt-pile"
import { getNotesForDay } from "@/lib/trips/note-queries"
import { computeLookingAhead } from "@/lib/trips/looking-ahead"
import { localTimeZone } from "@/lib/time/local-today"
import { todayInTimeZone } from "@/lib/time/today"
import { detectNearDailyCap } from "@/lib/nudges/near-daily-cap"
import { computeTripDays } from "@/lib/trips/trip-days"
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { budgetPace, dayLabel } from "@/lib/trips/budget-pace"
import { detectUnloggedDays } from "@/lib/nudges/unlogged-days"
import { periodCheck } from "@/lib/trips/budget-period"
import { CatchUpNudge } from "./catch-up-nudge"

import { CurrencyProvider } from "@/components/currency-context"
import { getRates } from "@/lib/fx/get-rates"

import { AssistantBlock } from "@/components/assistant-block"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { QuickExpense } from "./quick-expense"
import { QuickNote } from "./quick-note"
import { RoadPlaceDoor } from "./find-a-place"
import { RoadNudge } from "./road-nudge"
import { RoadHeaderLine, TodayCard } from "./road-cards"

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

  const tz = await localTimeZone()
  const today = todayInTimeZone(tz)
  const todayDay = await getTodayForTrip(trip.id, today)
  const locations = await getItineraryLocations(trip.id)
  const dark = await isDarkTheme()
  const navDestinations = buildNavDestinations({
    onTheRoad: true,
    tripSlug: trip.slug,
  })

  const rates = await getRates(trip.homeCurrency)

  const categories = await getTripExpenseCategories(trip.id)
  const expenses = await getTripExpenses(trip.id)
  const receipts = await getTripReceipts(trip.id)
  const documents = await getTripDocuments(trip.id)
  const spentTodayCents = expenses
    .filter((e) => !e.isSettlement && e.dayDate === today)
    .reduce((sum, e) => sum + homeCents(e), 0)
  const tripSpentCents = expenses
    .filter((e) => !e.isSettlement)
    .reduce((sum, e) => sum + homeCents(e), 0)
  const capNudge = detectNearDailyCap({
    plannedBudgetCents: trip.plannedBudgetCents,
    tripDays: computeTripDays(trip.startDate, trip.endDate),
    spentTodayCents,
    currency: trip.homeCurrency,
  })
  const notes = await getNotesForDay(trip.id, today)
  const days = (await getItineraryDays(trip.id)).filter(isDated)
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
  const place = locationName ?? trip.country
  const searchDestination = locationName ?? trip.country ?? trip.name
  const weatherPlace = { ...trip, locationName }
  const weather = await getTripWeather(weatherPlace)
  const usual = await getUsualActivities(workspace.id)
  const conditions = await getUpcomingConditions(trip, days, locations, today, usual)
  const news = await getNewsDays(trip, today, tz)

  return (
    <CurrencyProvider
      currency={trip.homeCurrency}
      spendCurrency={trip.currency}
      rates={rates}
    >
    <main className="relative mx-auto min-h-screen w-full max-w-[440px] pb-28 lg:flex lg:max-w-none lg:items-stretch lg:pb-0">
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
        <MobileNavPill destinations={navDestinations} current="on-the-road" />
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[13px] text-muted-foreground">
            {workspace.members.map((m, i) => (
              <span key={m.user_id}>
                {i > 0 ? " & " : null}
                <span className="font-serif italic text-foreground">
                  {m.display_name}
                </span>
              </span>
            ))}
          </div>
          <SignOutButton className="flex items-center text-muted-foreground hover:text-foreground lg:hidden" />
        </div>
        <RoadHeaderLine
          place={place}
          dateLabel={fullDate}
          dayOfTrip={computeTripDays(trip.startDate, today)}
          tripDays={computeTripDays(trip.startDate, trip.endDate)}
        />
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

      <BoxCard className="px-3 pt-2.5 pb-1">
        <Label className="px-1.5">Feed</Label>
          <DispatchBox
            weather={weather}
            conditions={conditions}
            usual={usual}
            news={news}
            budget={
              pace
                ? periodCheck(pace, trip.budgetPeriod, today, {
                    budgetCents: trip.plannedBudgetCents,
                    spentCents: tripSpentCents,
                  })
                : null
            }
            storageKey={`${trip.slug}:${today}`}
            tripId={trip.id}
            tripSlug={trip.slug}
            days={days.map((d) => ({
              id: d.id,
              dayDate: d.dayDate,
              label: `${d.dow} ${d.dom} ${d.mon}`,
            }))}
            className="mt-2"
          />
          {news
            .filter((day) => day.checkedAt === null)
            .map((day) => (
              <DispatchTrigger
                key={day.dayDate}
                tripSlug={trip.slug}
                dayDate={day.dayDate}
              />
            ))}
      </BoxCard>

      <TodayCard
        todayDay={todayDay}
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        ahead={ahead}
      />

      {capNudge ? <RoadNudge nudge={capNudge} /> : null}

      {unloggedNudge ? <CatchUpNudge nudge={unloggedNudge} /> : null}

      <div id="road-expense">
        <QuickExpense
          tripId={trip.id}
          tripSlug={trip.slug}
          today={today}
          currentPersonId={workspace.myPersonId ?? ""}
          categories={categories}
          spentTodayCents={spentTodayCents}
          locationCurrency={
            locations.find((l) => l.id === todayDay?.locationId)?.currency ?? null
          }
        />
      </div>

      <div className="mt-4 empty:hidden">
        <ReceiptPile
          tripSlug={trip.slug}
          receipts={receipts}
          expenses={expenses}
          nowMs={receiptClockMs()}
        />
      </div>

      <DocumentsToday documents={documents} today={today} tripId={trip.id} tripSlug={trip.slug} />

      <QuickNote
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        notes={notes}
      />
      </div>
    </main>
    </CurrencyProvider>
  )
}
