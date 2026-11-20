import Link from "next/link"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { userAgent } from "next/server"

import {
  Coord,
  DayChip,
  TopoBg,
  WaveGlyph,
} from "@/components/together"
import { RefreshOnVisible } from "@/components/refresh-on-visible"
import { CurrencyProvider } from "@/components/currency-context"
import { entryCurrency } from "@/lib/fx/entry-currency"
import { AssistantPill } from "@/components/ai-mode"
import { getRates } from "@/lib/fx/get-rates"
import { FlipCountdown } from "@/components/flip-countdown"
import { WeekForecast } from "@/components/week-forecast"
import { createClient } from "@/lib/supabase/server"
import { isDarkTheme } from "@/lib/theme"
import { localToday } from "@/lib/time/local-today"
import {
  getTripExpenses,
  getTripExpenseCategories,
} from "@/lib/trips/expense-queries"
import { getTripDocuments, getTripReceipts, receiptClockMs } from "@/lib/trips/receipt-queries"
import { DocumentsSection } from "@/components/documents/documents-section"
import { getTripSavings } from "@/lib/trips/savings-queries"
import { getTripBudgetMoves } from "@/lib/trips/budget-move-queries"
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
import { getTripSuggestions } from "@/lib/trips/suggestion-queries"
import { budgetBucketFor } from "@/lib/ai/budget-planner"
import { getProfileBudgetData } from "@/lib/trips/budget-history-queries"
import { recommendBufferPct } from "@/lib/trips/budget-history-types"
import { homeCents, summarizeBudget, type Expense } from "@/lib/trips/expense-types"
import { getTripDetailBySlug, type TripDetail } from "@/lib/trips/fixtures"
import { getItineraryDays, getUnplacedDays } from "@/lib/trips/itinerary-queries"
import { isDated } from "@/lib/trips/itinerary-types"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripNotes } from "@/lib/trips/note-queries"
import { getPackingCategories, getPackingItems } from "@/lib/trips/packing-queries"
import { CHECKLIST_CATEGORY } from "@/lib/trips/packing-types"
import { computeTripDays } from "@/lib/trips/trip-days"
import {
  getTripSeasonalEstimate,
  getTripWeekForecast,
} from "@/lib/weather/get-trip-weather"
import type { DayForecast } from "@/lib/weather/get-weather"
import { pickWeatherLocation } from "@/lib/weather/place-for-weather"
import { detectWeatherPacking } from "@/lib/nudges/weather-packing"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import {
  findWorkspaceForTripSlug,
  getTripBySlug,
  type TripHeader,
} from "@/lib/trips/queries"
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
import { NotesTab } from "./notes-tab"
import { TripFolder } from "./trip-folder"
import { Fragment, type ReactNode } from "react"
import { MobileTrip } from "./mobile-trip"
import { TripRoutePanel } from "./trip-route-panel"
import { PackingMini } from "./packing-mini"
import { BudgetMini, FolderMini, ItineraryMini, SideCard } from "./trip-side-cards"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"

type TabId = "itinerary" | "packing" | "budget" | "notes"

const TABS: { id: TabId; label: string }[] = [
  { id: "budget", label: "Budget" },
  { id: "itinerary", label: "Itinerary" },
  { id: "packing", label: "Packing" },
  // Id stays "notes" so existing ?tab=notes links land here.
  { id: "notes", label: "Trip folder" },
]

function tabHref(slug: string, tab: TabId): string {
  return tab === "budget" ? `/trips/${slug}` : `/trips/${slug}?tab=${tab}`
}

function isTab(value: string | undefined): value is TabId {
  return (
    value === "itinerary" ||
    value === "packing" ||
    value === "budget" ||
    value === "notes"
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
  const map: Record<string, MemberToneEntry> = {}
  for (const p of workspace.people) {
    const initial = (p.display_name ?? "?").trim().charAt(0).toUpperCase()
    const entry: MemberToneEntry = {
      initial,
      displayName: p.display_name,
      // The signed-in user reads as "sea"; everyone else, member or avatar, as
      // "clay". Previously keyed off the workspace owner, which says nothing
      // useful once a workspace can hold people who never sign in.
      tone: p.id === workspace.myPersonId ? "sea" : "clay",
    }
    // Keyed by BOTH ids on purpose. Subject columns (paid_by, savings user_id)
    // hold person ids; author columns (added_by, created_by) reference
    // auth.users and always will. This map is asked for both, so it answers to
    // both rather than each caller having to know which space its id is in.
    map[p.id] = entry
    if (p.user_id) map[p.user_id] = entry
  }
  return map
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { slug } = await params
  const { tab } = await searchParams

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/signin?next=/trips/${slug}`)

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  const header = await getTripBySlug(workspace.id, slug)
  if (!header) {
    // The slug may belong to another of the caller's workspaces — follow it
    // rather than 404ing on a bookmark saved before the last switch.
    const elsewhere = await findWorkspaceForTripSlug(slug, workspace.id)
    if (elsewhere) {
      redirect(
        `/api/workspace/switch?to=${elsewhere}&next=${encodeURIComponent(`/trips/${slug}`)}`,
      )
    }
    notFound()
  }

  const shareState = await getTripShareState(header.id)

  // Fetched once per trip render and handed to the whole subtree, so the
  // expense form's live preview is arithmetic rather than a request.
  const rates = await getRates(header.homeCurrency)

  const detail = getTripDetailBySlug(slug)
  const activeTab: TabId = isTab(tab) ? tab : "budget"
  // Phones get the one-page layout, so every section's data loads; desktop keeps
  // loading only the active tab.
  const isMobile = userAgent({ headers: await headers() }).device.type === "mobile"
  const wants = (t: TabId) => isMobile || activeTab === t

  const memberTones = memberToneMap(workspace)
  const memberIds = workspace.people.map((p) => p.id)
  const partnerId =
    workspace.members.find((m) => m.user_id !== userData.user!.id)?.user_id ??
    null

  // Right rail needs packing + budget counts always, so load both at the page
  // level and share the result with the active tab below.
  const showItinerary = wants("itinerary")
  const isDream = header.startDate === null
  const [itineraryDays, locations, notes, packingItems, packingCategories, expenses, expenseCategories, savings, budgetMoves, budgetItems, receipts, documents, unplacedDays, suggestions] =
    await Promise.all([
      // Days, notes and documents load on every tab: the right-rail cards show them.
      getItineraryDays(header.id),
      getItineraryLocations(header.id),
      getTripNotes(header.id),
      getPackingItems(header.id),
      getPackingCategories(header.id),
      getTripExpenses(header.id),
      wants("budget") || showItinerary
        ? getTripExpenseCategories(header.id)
        : Promise.resolve(null),
      getTripSavings(header.id, memberIds),
      wants("budget") ? getTripBudgetMoves(header.id) : Promise.resolve(null),
      wants("budget") || wants("itinerary")
        ? getBudgetItems(header.id)
        : Promise.resolve(null),
      wants("budget") ? getTripReceipts(header.id) : Promise.resolve([]),
      getTripDocuments(header.id),
      showItinerary ? getUnplacedDays(header.id) : Promise.resolve([]),
      showItinerary ? getTripSuggestions(header.id) : Promise.resolve([]),
    ])

  const budgetSummary = summarizeBudget(expenses, memberIds)
  // The Checklist category isn't packing, so it stays out of the packing count.
  const myPackingItems = packingItems.filter(
    (i) =>
      (i.ownerId === null || i.ownerId === userData.user!.id) &&
      i.category !== CHECKLIST_CATEGORY,
  )
  const today = await localToday()
  const weatherPlace = {
    ...header,
    locationName: pickWeatherLocation(locations ?? [], today)?.name ?? null,
  }
  const [packingWeather, weekForecast] = await Promise.all([
    getTripSeasonalEstimate(weatherPlace, header.startDate ?? today),
    getTripWeekForecast(weatherPlace),
  ])
  const packingNudge = detectWeatherPacking({
    destination: weekForecast?.label ?? weatherPlace.locationName ?? header.name,
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
  if (wants("budget")) {
    const seen = new Set<string>()
    for (const day of itineraryDays ?? []) {
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
    // Only `summaries` is used here, and those are per-trip and un-normalised;
    // recommendBufferPct works on plan-vs-actual ratios, so the unit is moot.
    const { summaries } = await getProfileBudgetData(
      [...navTrips.now, ...navTrips.past],
      workspace.currency,
    )
    bufferRec = recommendBufferPct(summaries)
  }

  const itinerary = (
    <ItineraryTab
      tripId={header.id}
      tripSlug={header.slug}
      tripName={header.name}
      destination={header.country ?? header.name}
      idea={header.tripProfile.idea}
      avoid={header.tripProfile.avoid}
      answers={header.tripProfile}
      tripStartDate={header.startDate}
      tripEndDate={header.endDate ?? header.startDate}
      tripDayCount={header.dayCount}
      today={today}
      initialItems={itineraryDays ?? []}
      initialUnplaced={unplacedDays}
      suggestions={suggestions}
      initialLocations={locations ?? []}
      budgetItems={budgetItems ?? []}
      showAssistantPill={isMobile}
    />
  )
  const packing = (layout: "tab" | "boxes" | "checklist", between?: ReactNode) => (
    <PackingTab
      tripId={header.id}
      tripSlug={header.slug}
      destination={header.country ?? header.name}
      currentUserId={userData.user!.id}
      partnerId={partnerId}
      initialItems={packingItems}
      initialCategories={packingCategories}
      members={memberTones}
      daysOut={computeDaysOut(header.startDate)}
      packingNudge={packingNudge}
      assistantBar={isMobile}
      layout={layout}
      between={between}
    />
  )
  const budget = (
    <BudgetTab
      tripId={header.id}
      tripSlug={header.slug}
      destination={header.country ?? header.name}
      tripName={header.name}
      tripDays={computeTripDays(header.startDate, header.endDate)}
      startDate={header.startDate}
      endDate={header.endDate}
      today={today}
      expenses={expenses}
      expenseCategories={expenseCategories ?? []}
      summary={budgetSummary}
      members={memberTones}
      plannedBudgetCents={header.plannedBudgetCents}
      savedCents={savings.totalCents}
      savingsContributions={savings.contributions}
      savedPerUser={savings.perUser}
      locations={locations ?? []}
      itineraryDays={(itineraryDays ?? []).filter(isDated)}
      moves={budgetMoves ?? []}
      budgetItems={budgetItems ?? []}
      itinerarySeeds={itinerarySeeds}
      bufferRec={bufferRec}
      currentPersonId={workspace.myPersonId ?? ""}
      receipts={receipts}
      nowMs={receiptClockMs()}
      showAssistantPill={isMobile}
    />
  )
  const documentsSection = (
    <DocumentsSection
      tripId={header.id}
      tripSlug={header.slug}
      documents={documents}
      nowMs={receiptClockMs()}
    />
  )
  const notesSection = (
    <NotesTab
      tripId={header.id}
      tripSlug={header.slug}
      destination={header.country ?? header.name}
      initialNotes={notes ?? []}
      locations={locations ?? []}
      members={memberTones}
      assistantBar={isMobile}
    />
  )

  if (isMobile) {
    return (
      <CurrencyProvider
        currency={header.homeCurrency}
        spendCurrency={header.currency}
        entryCurrency={entryCurrency(header, today)}
        rates={rates}
      >
        <main className="relative mx-auto min-h-screen w-full max-w-[440px] pt-14 pb-32">
          <RefreshOnVisible />
          <MobileTrip
            header={header}
            destinations={navDestinations}
            dateRange={formatDateRange(header.startDate, header.endDate)}
            dayCount={
              isDream
                ? (header.dayCount ?? (itineraryDays ?? []).length)
                : computeTripDays(header.startDate, header.endDate)
            }
            spentCents={budgetSummary.expenseTotalCents}
            notesCount={(notes ?? []).length}
            itinerary={itinerary}
            budget={budget}
            packingAround={(between) => packing("boxes", between)}
            documents={documentsSection}
            documentsCount={documents.length}
            notes={notesSection}
          />
        </main>
      </CurrencyProvider>
    )
  }

  return (
    <CurrencyProvider
      currency={header.homeCurrency}
      spendCurrency={header.currency}
      entryCurrency={entryCurrency(header, today)}
      rates={rates}
    >
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
          destinations={navDestinations}
          shareState={shareState}
        />
        <DesktopTabs slug={header.slug} active={activeTab} />
        {/* Header and pills span the page; the right rail starts below them. */}
        <div className="lg:flex lg:items-stretch">
        <div className="lg:min-w-0 lg:flex-1">
        {activeTab === "itinerary" && detail && header.startDate ? (
          <div className="lg:hidden">
            <WeatherStrip detail={detail} />
          </div>
        ) : null}
        {activeTab === "itinerary"
          ? itinerary
          : activeTab === "packing"
            ? <div className="lg:px-5">{packing("tab")}</div>
            : activeTab === "budget"
              ? <div className="lg:px-5">{budget}</div>
              : (
                <TripFolder
                  documents={documentsSection}
                  notes={notesSection}
                  checklist={packing("checklist")}
                />
              )}
        </div>

      <DesktopRightRail
        active={activeTab}
        forecast={weekForecast}
        map={
          <RailMap
            slug={header.slug}
            locations={(locations ?? []).map((l) => l.name)}
          />
        }
        cards={{
          budget: (
            <SideCard id="budget" title="Budget" href={tabHref(header.slug, "budget")}>
              <BudgetMini
                spentCents={budgetSummary.expenseTotalCents}
                savedCents={savings.totalCents}
                plannedCents={header.plannedBudgetCents}
                topCategories={topCategories(expenses)}
                currency={header.homeCurrency}
              />
            </SideCard>
          ),
          itinerary: (
            <SideCard id="itinerary" title="Itinerary" href={tabHref(header.slug, "itinerary")}>
              <ItineraryMini
                locations={locations.map((l) => l.name)}
                days={itineraryDays}
                today={today}
              />
            </SideCard>
          ),
          packing: (
            <SideCard id="packing" title="Packing" href={tabHref(header.slug, "packing")}>
              <PackingMini items={myPackingItems} owners={memberTones} />
            </SideCard>
          ),
          notes: (
            <SideCard id="notes" title="Trip folder" href={tabHref(header.slug, "notes")}>
              <FolderMini documents={documents} notes={notes} />
            </SideCard>
          ),
        }}
      />
        </div>
      </div>
    </main>
    </CurrencyProvider>
  )
}

function TripHeaderView({
  header,
  destinations,
  shareState,
}: {
  header: TripHeader
  destinations: NavDestination[]
  shareState: { isPublic: boolean; shareToken: string | null }
}) {
  const coord = formatCoord(header.lat, header.lng)
  const dateRange = formatDateRange(header.startDate, header.endDate)
  const isDream = header.startDate === null
  const fuzzyLabel = (header.fuzzyWhen ?? "someday").toUpperCase()

  return (
    <header className="relative overflow-hidden bg-sea-tint px-5 pt-14 pb-5 lg:px-10 lg:pt-6 lg:pb-6">
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
      <div className="hidden lg:absolute lg:top-4 lg:right-10 lg:z-10 lg:flex">
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
      {/* Desktop: name, country + dates, countdown beside them; share and edit
          float top right. */}
      <div className="relative flex items-end justify-between gap-6">
        <div className="min-w-0 lg:flex lg:items-center lg:gap-10">
          <div className="min-w-0">
          {coord ? <Coord>{coord}</Coord> : null}
          <h1 className="t-display mt-0.5 text-[64px] text-foreground lg:text-[48px] lg:leading-[0.95]">
            <em>{header.name}</em>
          </h1>
          <div className="flex flex-wrap gap-x-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground lg:mt-2">
            {header.country ? <span>{header.country}</span> : null}
            <span className="hidden lg:inline">{isDream ? fuzzyLabel : dateRange}</span>
          </div>
          <div className="relative mt-4 lg:hidden">
            {isDream ? (
              <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-foreground">
                {fuzzyLabel}
              </div>
            ) : dateRange ? (
              <div className="font-mono text-[12px] text-foreground">{dateRange}</div>
            ) : null}
          </div>
          </div>
          {!isDream && header.startDate ? (
            <FlipCountdown
              startDate={header.startDate}
              size="lg"
              className="mt-4 lg:mt-0 lg:[--flip-f:37px] lg:[--flip-gap:4px] lg:[--flip-h:38px] lg:[--flip-w:48px]"
            />
          ) : null}
        </div>
        <WaveGlyph color="var(--sea)" w={56} h={14} className="lg:hidden" />
      </div>
    </header>
  )
}

/** Route map at the bottom of the desktop right rail; it opens the itinerary. */
function RailMap({ slug, locations }: { slug: string; locations: string[] }) {
  return (
    <Link
      href={tabHref(slug, "itinerary")}
      aria-label="Route map. Opens the itinerary"
      className="block h-[180px] shrink-0 rounded-[14px] transition-opacity hover:opacity-90"
    >
      <TripRoutePanel slug={slug} locations={locations} />
    </Link>
  )
}

function WeatherStrip({ detail }: { detail: TripDetail }) {
  return (
    <div className="flex border-b border-border bg-card">
      {detail.weather.map((day, i) => (
        <DayChip
          key={day.d + i}
          d={day.d}
          t={day.t}
          code={day.code}
          active={i === detail.weatherActive}
        />
      ))}
    </div>
  )
}

/** Tab row for the non-phone layout. Shown at every width so narrow desktop
 * windows and tablets keep a way between tabs; phones use MobileTrip instead. */
function DesktopTabs({ slug, active }: { slug: string; active: TabId }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3.5 lg:px-10">
      <AssistantPill className="order-last ml-auto" />
      {TABS.map((t) => {
        const isActive = t.id === active
        return (
          <Link
            key={t.id}
            href={tabHref(slug, t.id)}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
              isActive
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

/** Desktop right rail: a small card for every section except the one in the main column. */
function DesktopRightRail({
  active,
  forecast,
  map,
  cards,
}: {
  active: TabId
  forecast: { label: string; days: DayForecast[] } | null
  map: ReactNode
  cards: Record<TabId, ReactNode>
}) {
  return (
    <aside className="hidden lg:flex lg:w-[340px] lg:flex-shrink-0 lg:flex-col lg:gap-4 lg:border-l lg:border-border lg:bg-card lg:px-5 lg:py-6">
      {forecast ? (
        <div className="mb-2">
          <WeekForecast forecast={forecast.days} label={forecast.label} />
        </div>
      ) : null}
      {TABS.filter((t) => t.id !== active).map((t) => (
        <Fragment key={t.id}>{cards[t.id]}</Fragment>
      ))}
      {map}
    </aside>
  )
}

/** The two categories with the most real spend (settlements excluded). */
function topCategories(expenses: Expense[]): { name: string; cents: number }[] {
  const byName = new Map<string, number>()
  for (const e of expenses) {
    if (e.isSettlement) continue
    byName.set(e.category, (byName.get(e.category) ?? 0) + homeCents(e))
  }
  return [...byName]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 2)
}
