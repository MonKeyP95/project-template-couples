import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  Avatar,
  Bar,
  Chevron,
  Coord,
  DayChip,
  Label,
  MonoBadge,
  PairAvatar,
  SuggestionCard,
  TopoBg,
  WaveGlyph,
} from "@/components/together"
import { RefreshOnVisible } from "@/components/refresh-on-visible"
import { createClient } from "@/lib/supabase/server"
import { getTripExpenses } from "@/lib/trips/expense-queries"
import { summarizeBudget } from "@/lib/trips/expense-types"
import { getTripDetailBySlug, type TripDetail } from "@/lib/trips/fixtures"
import {
  getItineraryDays,
  type ItineraryDay,
} from "@/lib/trips/itinerary-queries"
import { getPackingItems } from "@/lib/trips/packing-queries"
import { getTripBySlug, type TripHeader } from "@/lib/trips/queries"
import {
  getCurrentWorkspace,
  type CurrentWorkspace,
} from "@/lib/workspace/queries"

import { BudgetTab } from "./budget-tab"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"

type TabId = "itinerary" | "packing" | "budget"

const TABS: { id: TabId; label: string }[] = [
  { id: "itinerary", label: "Itinerary" },
  { id: "packing", label: "Packing" },
  { id: "budget", label: "Budget" },
]

const itineraryBorder: Record<ItineraryDay["tone"], string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}

function isTab(value: string | undefined): value is TabId {
  return value === "itinerary" || value === "packing" || value === "budget"
}

function formatCoord(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null
  const latStr = `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? "S" : "N"}`
  const lngStr = `${Math.abs(lng).toFixed(1)}° ${lng < 0 ? "W" : "E"}`
  return `${latStr} · ${lngStr}`
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", {
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
  return `${formatDayLabel(startDate)} — ${formatDayLabel(endDate)}`
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
  if (!header) notFound()

  const detail = getTripDetailBySlug(slug)
  const activeTab: TabId = isTab(tab) ? tab : "itinerary"

  const memberTones = memberToneMap(workspace)
  const memberIds = workspace.members.map((m) => m.user_id)

  // Right rail needs packing + budget counts always, so load both at the page
  // level and share the result with the active tab below.
  const [itinerary, packingItems, expenses] = await Promise.all([
    activeTab === "itinerary" ? getItineraryDays(header.id) : Promise.resolve(null),
    getPackingItems(header.id),
    getTripExpenses(header.id),
  ])

  const budgetSummary = summarizeBudget(expenses, memberIds)
  const packingTotal = packingItems.length
  const packingDone = packingItems.filter((i) => i.done).length

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[440px] bg-background pb-32 lg:flex lg:max-w-none lg:items-stretch lg:pb-0">
      <RefreshOnVisible />
      <DesktopLeftRail workspace={workspace} />

      <div className="lg:min-w-0 lg:flex-1">
        <TripHeaderView header={header} workspace={workspace} />
        <DesktopTabs
          slug={header.slug}
          active={activeTab}
          counts={{
            itinerary: itinerary?.length ?? null,
            packing: packingTotal,
            budget: budgetSummary.expenseTotalCents,
          }}
        />
        {activeTab === "itinerary" && detail ? (
          <div className="lg:hidden">
            <WeatherStrip detail={detail} />
          </div>
        ) : null}
        {activeTab === "itinerary" ? (
          itinerary && itinerary.length > 0 ? (
            <ItineraryView itinerary={itinerary} />
          ) : (
            <TabStub label="Itinerary" />
          )
        ) : activeTab === "packing" ? (
          <PackingTab
            tripId={header.id}
            initialItems={packingItems}
            members={memberTones}
            daysOut={computeDaysOut(header.startDate)}
          />
        ) : (
          <BudgetTab
            tripId={header.id}
            tripSlug={header.slug}
            tripName={header.name}
            expenses={expenses}
            summary={budgetSummary}
            members={memberTones}
            plannedBudgetCents={detail?.plannedBudgetCents ?? 0}
            startDate={header.startDate}
            endDate={header.endDate}
            currentUserId={userData.user.id}
          />
        )}
      </div>

      <DesktopRightRail
        detail={detail}
        packing={{ done: packingDone, total: packingTotal }}
        budget={{
          spentCents: budgetSummary.expenseTotalCents,
          plannedCents: detail?.plannedBudgetCents ?? 0,
        }}
      />

      <BottomNav slug={header.slug} active={activeTab} />
    </main>
  )
}

function TripHeaderView({
  header,
  workspace,
}: {
  header: TripHeader
  workspace: NonNullable<Awaited<ReturnType<typeof getCurrentWorkspace>>>
}) {
  const coord = formatCoord(header.lat, header.lng)
  const dateRange = formatDateRange(header.startDate, header.endDate)
  const members = workspace.members
  const tripCount = `${String(header.index).padStart(2, "0")} of ${String(header.total).padStart(2, "0")}`

  return (
    <header className="relative overflow-hidden bg-sea-tint px-5 pt-14 pb-5 lg:px-10 lg:pt-10 lg:pb-7">
      <TopoBg tone="sea" opacity={0.18} />
      <div className="relative mb-6 flex items-center justify-between lg:hidden">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <Chevron dir="left" /> back
        </Link>
        <Label>Trip · {tripCount}</Label>
      </div>
      <div className="relative hidden lg:block lg:mb-2">
        <Label>Trip · {tripCount}</Label>
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
        </div>
        <WaveGlyph color="var(--sea)" w={56} h={14} className="lg:hidden" />
      </div>
      <div className="relative mt-4 flex items-center justify-between lg:mt-5">
        {dateRange ? (
          <div className="font-mono text-[12px] text-foreground">{dateRange}</div>
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

function ItineraryView({
  itinerary,
}: {
  itinerary: ItineraryDay[]
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>
      <div className="px-5 pt-2.5">
        {itinerary.map((day, i) => (
          <ItineraryRow
            key={day.d}
            day={day}
            isLast={i === itinerary.length - 1}
          />
        ))}
      </div>
      <div className="px-5 pt-4 pb-6">
        <SuggestionCard
          label="/ assistant"
          applyLabel="apply"
          dismissLabel="dismiss"
        >
          Day 05 has a 4-hour drive after the ferry. Want me to{" "}
          <span className="font-serif italic text-foreground">
            split it across two days
          </span>{" "}
          so you&apos;re not arriving in Senaru tired?
        </SuggestionCard>
      </div>
    </section>
  )
}

function ItineraryRow({
  day,
  isLast,
}: {
  day: ItineraryDay
  isLast: boolean
}) {
  return (
    <div className="relative flex gap-3.5 py-3.5">
      <div className="relative w-9 flex-shrink-0">
        <div className="font-mono text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
          DAY
        </div>
        <div className="mt-0.5 font-mono text-[22px] leading-none tracking-[-0.02em] text-foreground">
          {day.d}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {day.dow.toUpperCase()}
        </div>
        {!isLast ? (
          <div className="absolute -bottom-3.5 left-[11px] top-14 w-px bg-border" />
        ) : null}
      </div>
      <div
        className={`flex-1 rounded-lg border border-border bg-card px-3.5 py-3 border-l-[3px] ${itineraryBorder[day.tone]}`}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {day.date}
          </span>
        </div>
        <div className="t-display mb-1 text-[22px] leading-tight text-foreground">
          {day.title}
        </div>
        <div className="text-[12.5px] leading-snug text-muted-foreground">
          {day.sub}
        </div>
      </div>
    </div>
  )
}

function TabStub({ label }: { label: string }) {
  return (
    <section className="px-5 pt-6">
      <Label>{label}</Label>
      <p className="mt-3 font-serif text-[15px] italic text-muted-foreground">
        Arriving soon.
      </p>
    </section>
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
              t.id === "itinerary"
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

function DesktopTabs({
  slug,
  active,
  counts,
}: {
  slug: string
  active: TabId
  counts: { itinerary: number | null; packing: number; budget: number }
}) {
  const labelFor = (t: TabId) => {
    if (t === "itinerary") {
      return counts.itinerary != null ? `${counts.itinerary} days` : null
    }
    if (t === "packing") return `${counts.packing}`
    return `€${(counts.budget / 100).toFixed(0)}`
  }
  return (
    <div className="hidden border-b border-border lg:flex lg:gap-7 lg:px-10 lg:pt-3">
      {TABS.map((t) => {
        const isActive = t.id === active
        const href =
          t.id === "itinerary" ? `/trips/${slug}` : `/trips/${slug}?tab=${t.id}`
        const count = labelFor(t.id)
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
            {count ? (
              <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                · {count}
              </span>
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

function DesktopLeftRail({ workspace }: { workspace: CurrentWorkspace }) {
  const estYear = new Date(workspace.createdAt).getFullYear()
  return (
    <aside className="hidden lg:flex lg:w-[220px] lg:flex-shrink-0 lg:flex-col lg:gap-9 lg:border-r lg:border-border lg:bg-card lg:px-6 lg:py-8">
      <div>
        <Label>Together</Label>
        <div className="t-display mt-2 text-[28px] leading-[0.95] text-foreground">
          {workspace.members.map((m, i) => (
            <span key={m.user_id}>
              {i > 0 ? (
                <span className="text-muted-foreground"> &amp; </span>
              ) : null}
              <em>{m.display_name}</em>
            </span>
          ))}
        </div>
        <Coord>workspace · est. {estYear}</Coord>
      </div>

      <div>
        <Label className="mb-2.5 block">Navigate</Label>
        <nav className="flex flex-col gap-0.5">
          <Link
            href="/home"
            className="flex items-center justify-between rounded-md px-2.5 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-sea-tint hover:text-foreground"
          >
            <span>Home</span>
            <Chevron />
          </Link>
          <div className="flex items-center justify-between rounded-md bg-sea-tint px-2.5 py-2 text-[13.5px] text-foreground">
            <span className="font-serif italic">Trip</span>
            <Chevron />
          </div>
        </nav>
      </div>

      <div className="mt-auto">
        <Label className="mb-2.5 block">Members</Label>
        <div className="flex flex-col gap-2">
          {workspace.members.map((m, i) => (
            <div key={m.user_id} className="flex items-center gap-2.5">
              <Avatar
                name={m.display_name}
                size={24}
                tone={i === 0 ? "sea" : "clay"}
              />
              <div className="font-serif text-[13px] italic text-foreground">
                {m.display_name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function DesktopRightRail({
  detail,
  packing,
  budget,
}: {
  detail: TripDetail | null
  packing: { done: number; total: number }
  budget: { spentCents: number; plannedCents: number }
}) {
  const packingPct =
    packing.total === 0 ? 0 : Math.round((packing.done / packing.total) * 100)
  const budgetPct =
    budget.plannedCents === 0
      ? 0
      : Math.min(100, Math.round((budget.spentCents / budget.plannedCents) * 100))
  return (
    <aside className="hidden lg:flex lg:w-[280px] lg:flex-shrink-0 lg:flex-col lg:gap-8 lg:border-l lg:border-border lg:bg-card lg:px-6 lg:py-8">
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
        </div>
      </div>

      {detail ? (
        <div>
          <Label>Weather · 7 day</Label>
          <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-7">
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
          </div>
        </div>
      ) : null}
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
