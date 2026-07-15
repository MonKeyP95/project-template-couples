import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  Bar,
  Coord,
  DayChip,
  Label,
  PairAvatar,
  TopoBg,
  WaveGlyph,
} from "@/components/together"
import { RefreshOnVisible } from "@/components/refresh-on-visible"
import { TripCountdown } from "@/components/trip-countdown"
import { WeekForecast } from "@/components/week-forecast"
import { createClient } from "@/lib/supabase/server"
import { isDarkTheme } from "@/lib/theme"
import { localToday } from "@/lib/time/local-today"
import {
  getTripExpenses,
  getTripExpenseCategories,
} from "@/lib/trips/expense-queries"
import { getTripSavings } from "@/lib/trips/savings-queries"
import { getTripBudgetMoves } from "@/lib/trips/budget-move-queries"
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { budgetBucketFor } from "@/lib/ai/budget-planner"
import { getProfileBudgetData } from "@/lib/trips/budget-history-queries"
import { recommendBufferPct } from "@/lib/trips/budget-history-types"
import { summarizeBudget } from "@/lib/trips/expense-types"
import { getTripDetailBySlug } from "@/lib/trips/fixtures"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getDreamItineraryDays } from "@/lib/trips/dream-itinerary-queries"
import { getTripNotes } from "@/lib/trips/note-queries"
import { getPackingCategories, getPackingItems } from "@/lib/trips/packing-queries"
import { computeTripDays } from "@/lib/trips/trip-days"
import { getTripWeather, getTripWeekForecast } from "@/lib/weather/get-trip-weather"
import type { DayForecast } from "@/lib/weather/get-weather"
import { detectWeatherPacking } from "@/lib/nudges/weather-packing"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getTripBySlug, type TripHeader } from "@/lib/trips/queries"
import { getTripShareState } from "@/lib/trips/shared-trip-queries"
import { ShareTripDialog } from "@/components/share-trip-dialog"
import {
  getCurrentWorkspace,
  type CurrentWorkspace,
} from "@/lib/workspace/queries"
import {
  LeftRail,
  MobileHeaderNav,
  buildNavDestinations,
  type NavDestination,
} from "@/components/app-nav"

import { BudgetTab } from "./budget-tab"
import { ItineraryTab } from "./itinerary-tab"
import { DreamItineraryTab } from "./dream-itinerary-tab"
import { ProfileTab } from "./profile-tab"
import { TripRoutePanel } from "./trip-route-panel"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"

type TabId = "itinerary" | "packing" | "budget" | "profile"

const TABS: { id: TabId; label: string }[] = [
  { id: "budget", label: "Budget" },
  { id: "itinerary", label: "Itinerary" },
  { id: "packing", label: "Packing" },
  { id: "profile", label: "Profile" },
]

function isTab(value: string | undefined): value is TabId {
  return (
    value === "itinerary" ||
    value === "packing" ||
    value === "budget" ||
    value === "profile"
  )
}

function formatCoord(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null
  const latStr = `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? "S" : "N"}`
  const lngStr = `${Math.abs(lng).toFixed(1)}° ${lng < 0 ? "W" : "E"}`
  return `${latStr} · ${lngStr}`
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function formatDayLabel(date: string): string {
  return SHORT_MONTH.format(new Date(date)).toUpperCase()
}

function formatDateRange(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate || !endDate) return null
  const startYear = startDate.slice(0, 4)
  const endYear = endDate.slice(0, 4)
  // Show the year once when start and end share it; otherwise on both ends.
  const start =
    startYear === endYear
      ? formatDayLabel(startDate)
      : `${formatDayLabel(startDate)} ${startYear}`
  return `${start} — ${formatDayLabel(endDate)} ${endYear}`
}

function computeDaysOut(startDate: string | null): number | null {
  if (!startDate) return null
  const start = new Date(`${startDate}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  return Math.max(0, Math.ceil((start.getTime() - todayUtc) / 86_400_000))
}

function memberToneMap(
  workspace: CurrentWorkspace,
): Record<string, MemberToneEntry> {
  const owner = workspace.members.find((m) => m.role === "owner")
  const map: Record<string, MemberToneEntry> = {}
  for (const m of workspace.members) {
    const initial = (m.display_name ?? "?").trim().charAt(0).toUpperCase()
    map[m.user_id] = {
      initial,
      displayName: m.display_name,
      tone: owner && m.user_id === owner.user_id ? "sea" : "clay",
    }
  }
  return map
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tab?: string; onboarding?: string }>
}) {
  const { slug } = await params
  const { tab, onboarding } = await searchParams

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/signin?next=/trips/${slug}`)

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  const header = await getTripBySlug(workspace.id, slug)
  if (!header) notFound()

  const shareState = await getTripShareState(header.id)

  const detail = getTripDetailBySlug(slug)
  const activeTab: TabId = isTab(tab) ? tab : "budget"

  const memberTones = memberToneMap(workspace)
  const memberIds = workspace.members.map((m) => m.user_id)
  const partnerId =
    workspace.members.find((m) => m.user_id !== userData.user!.id)?.user_id ??
    null

  // Right rail needs packing + budget counts always, so load both at the page
  // level and share the result with the active tab below.
  const showItinerary = activeTab === "itinerary"
  const isDream = header.startDate === null
  const [datedItinerary, dreamItinerary, locations, notes, packingItems, packingCategories, expenses, expenseCategories, savings, budgetMoves, budgetItems] =
    await Promise.all([
      (showItinerary && !isDream) || activeTab === "budget"
        ? getItineraryDays(header.id)
        : Promise.resolve(null),
      showItinerary && isDream ? getDreamItineraryDays(header.id) : Promise.resolve(null),
      getItineraryLocations(header.id),
      activeTab === "profile" ? getTripNotes(header.id) : Promise.resolve(null),
      getPackingItems(header.id),
      getPackingCategories(header.id),
      getTripExpenses(header.id),
      activeTab === "budget" ||
      activeTab === "profile" ||
      (showItinerary && !isDream)
        ? getTripExpenseCategories(header.id)
        : Promise.resolve(null),
      getTripSavings(header.id, memberIds),
      activeTab === "budget" ? getTripBudgetMoves(header.id) : Promise.resolve(null),
      activeTab === "budget" || activeTab === "itinerary"
        ? getBudgetItems(header.id)
        : Promise.resolve(null),
    ])

  const budgetSummary = summarizeBudget(expenses, memberIds)
  const myPackingItems = packingItems.filter(
    (i) => i.ownerId === null || i.ownerId === userData.user!.id,
  )
  const packingTotal = myPackingItems.length
  const packingDone = myPackingItems.filter((i) => i.done).length
  const [packingWeather, weekForecast] = await Promise.all([
    getTripWeather(header, header.startDate ?? undefined),
    getTripWeekForecast(header),
  ])
  const packingNudge = detectWeatherPacking({
    destination: header.country ?? header.name,
    weather: packingWeather,
    packingLabels: packingItems.map((i) => i.label.toLowerCase()),
  })
  const dark = await isDarkTheme()
  const navTrips = await listTripsForWorkspace(workspace.id)
  const navDestinations = buildNavDestinations({
    onTheRoad: navTrips.now.length > 0,
    tripSlug: header.slug,
  })

  // Budget-drafter inputs: seed the walk from the itinerary (categorized events
  // per location), and recommend a buffer from the couple's past overspend.
  const itinerarySeeds: Record<string, string[]> = {}
  let bufferRec = { pct: 10, reason: "a typical starting buffer" }
  if (activeTab === "budget") {
    const seen = new Set<string>()
    for (const day of datedItinerary ?? []) {
      for (const ev of day.events) {
        if (!ev.category) continue
        const bucket = budgetBucketFor(ev.category, day.locationId)
        const text = ev.text.trim()
        if (!bucket || !text) continue
        const dedupe = `${bucket}::${text.toLowerCase()}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        ;(itinerarySeeds[bucket] ??= []).push(text)
      }
    }
    const { summaries } = await getProfileBudgetData([
      ...navTrips.now,
      ...navTrips.past,
    ])
    bufferRec = recommendBufferPct(summaries)
  }

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[440px] pb-32 lg:flex lg:max-w-none lg:items-stretch lg:pb-0">
      <RefreshOnVisible />
      <LeftRail
        workspace={workspace}
        initialDark={dark}
        destinations={navDestinations}
        current="trip"
      />

      <div className="lg:min-w-0 lg:flex-1">
        <TripHeaderView
          header={header}
          workspace={workspace}
          destinations={navDestinations}
          shareState={shareState}
        />
        <DesktopTabs slug={header.slug} active={activeTab} />
        {activeTab === "itinerary" && detail && header.startDate ? (
          <div className="lg:hidden">
            <WeatherStrip detail={detail} />
          </div>
        ) : null}
        {activeTab === "itinerary" ? (
          header.startDate === null ? (
            <DreamItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              initialItems={dreamItinerary ?? []}
            />
          ) : (
            <ItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              tripName={header.name}
              destination={header.country ?? header.name}
              tripStartDate={header.startDate}
              tripEndDate={header.endDate ?? header.startDate}
              today={await localToday()}
              initialItems={datedItinerary ?? []}
              initialLocations={locations ?? []}
              budgetItems={budgetItems ?? []}
              categories={expenseCategories ?? []}
              members={memberTones}
              currentUserId={userData.user.id}
            />
          )
        ) : activeTab === "packing" ? (
          <PackingTab
            tripId={header.id}
            tripSlug={header.slug}
            destination={header.country ?? header.name}
            currentUserId={userData.user.id}
            partnerId={partnerId}
            initialItems={packingItems}
            initialCategories={packingCategories}
            members={memberTones}
            daysOut={computeDaysOut(header.startDate)}
            packingNudge={packingNudge}
          />
        ) : activeTab === "budget" ? (
          <BudgetTab
            tripId={header.id}
            tripSlug={header.slug}
            destination={header.country ?? header.name}
            tripName={header.name}
            tripDays={computeTripDays(header.startDate, header.endDate)}
            expenses={expenses}
            expenseCategories={expenseCategories ?? []}
            summary={budgetSummary}
            members={memberTones}
            plannedBudgetCents={header.plannedBudgetCents}
            savedCents={savings.totalCents}
            savingsContributions={savings.contributions}
            savedPerUser={savings.perUser}
            locations={locations ?? []}
            itineraryDays={datedItinerary ?? []}
            moves={budgetMoves ?? []}
            budgetItems={budgetItems ?? []}
            itinerarySeeds={itinerarySeeds}
            bufferRec={bufferRec}
            currentUserId={userData.user.id}
          />
        ) : (
          <ProfileTab
            profile={header.tripProfile}
            expenseCategories={expenseCategories ?? []}
            tripId={header.id}
            tripSlug={header.slug}
            destination={header.country ?? header.name}
            initialNotes={notes ?? []}
            locations={locations ?? []}
            members={memberTones}
            onboarding={onboarding === "1"}
          />
        )}
      </div>

      <DesktopRightRail
        slug={header.slug}
        locations={(locations ?? []).map((l) => l.name)}
        forecast={weekForecast}
        packing={{ done: packingDone, total: packingTotal }}
        budget={{
          spentCents: budgetSummary.expenseTotalCents,
          plannedCents: header.plannedBudgetCents,
        }}
        saved={{
          savedCents: savings.totalCents,
          plannedCents: header.plannedBudgetCents,
        }}
      />

      <BottomNav slug={header.slug} active={activeTab} />
    </main>
  )
}

function TripHeaderView({
  header,
  workspace,
  destinations,
  shareState,
}: {
  header: TripHeader
  workspace: NonNullable<Awaited<ReturnType<typeof getCurrentWorkspace>>>
  destinations: NavDestination[]
  shareState: { isPublic: boolean; shareToken: string | null }
}) {
  const coord = formatCoord(header.lat, header.lng)
  const dateRange = formatDateRange(header.startDate, header.endDate)
  const members = workspace.members
  const tripCount = `${String(header.index).padStart(2, "0")} of ${String(header.total).padStart(2, "0")}`
  const isDream = header.startDate === null
  const fuzzyLabel = (header.fuzzyWhen ?? "someday").toUpperCase()

  return (
    <header className="relative overflow-hidden bg-sea-tint px-5 pt-14 pb-5 lg:px-10 lg:pt-10 lg:pb-7">
      <TopoBg tone="sea" opacity={0.18} />
      <MobileHeaderNav
        destinations={destinations}
        current="trip"
        className="relative mb-6"
        center={
          <Link
            href={`/trips/${header.slug}/edit`}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {"// edit trip"}
          </Link>
        }
      />
      <div className="relative hidden lg:mb-2 lg:flex lg:items-center lg:justify-between">
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
        <div className="flex items-center gap-4">
          <ShareTripDialog
            tripId={header.id}
            tripSlug={header.slug}
            initialPublic={shareState.isPublic}
            initialToken={shareState.shareToken}
          />
          <Link
            href={`/trips/${header.slug}/edit`}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {"// edit trip"}
          </Link>
        </div>
      </div>
      <div className="relative flex items-end justify-between">
        <div>
          {coord ? <Coord>{coord}</Coord> : null}
          <div className="flex items-baseline gap-4">
            <h1 className="t-display mt-0.5 text-[64px] text-foreground lg:text-[88px] lg:leading-[0.9]">
              <em>{header.name}</em>
            </h1>
            <WaveGlyph color="var(--sea)" w={56} h={14} className="hidden lg:block" />
          </div>
          {header.country ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {header.country}
            </div>
          ) : null}
          {header.tripProfile.idea ? (
            <div className="mt-1.5 truncate font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
              {header.tripProfile.idea}
            </div>
          ) : null}
        </div>
        <WaveGlyph color="var(--sea)" w={56} h={14} className="lg:hidden" />
      </div>
      <div className="relative mt-4 flex items-center justify-between lg:mt-5">
        {isDream ? (
          <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-foreground">
            {fuzzyLabel}
          </div>
        ) : dateRange ? (
          <div className="flex items-baseline gap-3">
            <div className="font-mono text-[12px] text-foreground">{dateRange}</div>
            {header.startDate ? (
              <TripCountdown startDate={header.startDate} />
            ) : null}
          </div>
        ) : (
          <span />
        )}
        {members.length >= 2 ? (
          <PairAvatar
            a={members[0].display_name}
            b={members[1].display_name}
            size={22}
          />
        ) : null}
      </div>
    </header>
  )
}

function WeatherStrip({ detail }: { detail: { weather: { d: string; t: number; glyph: "sun" | "haze" | "rain" }[]; weatherActive: number } }) {
  return (
    <div className="flex border-b border-border bg-card">
      {detail.weather.map((day, i) => (
        <DayChip
          key={day.d + i}
          d={day.d}
          t={day.t}
          glyph={day.glyph}
          active={i === detail.weatherActive}
        />
      ))}
    </div>
  )
}

function BottomNav({ slug, active }: { slug: string; active: TabId }) {
  return (
    <div className="fixed inset-x-0 bottom-7 z-40 lg:hidden">
      <div className="mx-auto w-full max-w-[440px] px-4">
        <nav className="flex gap-1 rounded-full border border-border bg-card/80 p-1.5 shadow-md backdrop-blur-xl">
          {TABS.map((t) => {
            const isActive = t.id === active
            const href =
              t.id === "budget"
                ? `/trips/${slug}`
                : `/trips/${slug}?tab=${t.id}`
            return (
              <Link
                key={t.id}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`flex-1 rounded-full py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

function DesktopTabs({ slug, active }: { slug: string; active: TabId }) {
  return (
    <div className="hidden border-b border-border lg:flex lg:gap-7 lg:px-10 lg:pt-3">
      {TABS.map((t) => {
        const isActive = t.id === active
        const href =
          t.id === "budget" ? `/trips/${slug}` : `/trips/${slug}?tab=${t.id}`
        return (
          <Link
            key={t.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2 border-b-2 py-3 transition-colors ${
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
              {t.label}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function DesktopRightRail({
  slug,
  locations,
  forecast,
  packing,
  budget,
  saved,
}: {
  slug: string
  locations: string[]
  forecast: DayForecast[] | null
  packing: { done: number; total: number }
  budget: { spentCents: number; plannedCents: number }
  saved: { savedCents: number; plannedCents: number }
}) {
  const packingPct =
    packing.total === 0 ? 0 : Math.round((packing.done / packing.total) * 100)
  const budgetPct =
    budget.plannedCents === 0
      ? 0
      : Math.min(100, Math.round((budget.spentCents / budget.plannedCents) * 100))
  const savedPct =
    saved.plannedCents === 0
      ? 0
      : Math.min(100, Math.round((saved.savedCents / saved.plannedCents) * 100))
  return (
    <aside className="hidden lg:flex lg:w-[280px] lg:flex-shrink-0 lg:flex-col lg:gap-8 lg:border-l lg:border-border lg:bg-card lg:px-6 lg:py-8">
      <div className="h-[200px]">
        <TripRoutePanel slug={slug} locations={locations} />
      </div>

      <div>
        <Label>Pre-trip</Label>
        <div className="mt-3 flex flex-col gap-3.5">
          <ProgressRow
            label="Packing"
            value={`${packing.done} / ${packing.total}`}
            pct={packingPct}
            tone="clay"
          />
          <ProgressRow
            label="Budget"
            value={`€${(budget.spentCents / 100).toFixed(0)} / €${(budget.plannedCents / 100).toFixed(0)}`}
            pct={budgetPct}
            tone="sea"
          />
          <ProgressRow
            label="Saved"
            value={`€${(saved.savedCents / 100).toFixed(0)} / €${(saved.plannedCents / 100).toFixed(0)}`}
            pct={savedPct}
            tone="moss"
          />
        </div>
      </div>

      {forecast ? <WeekForecast forecast={forecast} /> : null}
    </aside>
  )
}

function ProgressRow({
  label,
  value,
  pct,
  tone,
}: {
  label: string
  value: string
  pct: number
  tone: "sea" | "clay" | "moss"
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-serif text-[13px] italic text-foreground">
          {label}
        </span>
        <span className="t-num text-[11px] text-muted-foreground">{value}</span>
      </div>
      <Bar pct={pct} tone={tone} />
    </div>
  )
}
