"use client"

import * as React from "react"

import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  EventDraftList,
  draftToEvent,
  newEventDraft,
  sortEvents,
  toEventDrafts,
  type EventDraft,
} from "./event-draft-rows"
import { BlockEditor } from "./block-editor"
import {
  SelectionBox,
  SelectionTray,
  inSelectZone,
  useDaySelection,
  type DaySelection,
} from "./day-selection"
import { Label } from "@/components/together"
import { AssistantBlock } from "@/components/assistant-block"
import { EventRating } from "@/components/event-rating"
import { PlanningPlaceDoor } from "./find-a-place-planning"
import { BudgetScopeEditor } from "./budget-scope-editor"
import { EventExpense } from "./event-expense"
import { PlanItinerary } from "./plan-itinerary"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { MemberToneEntry } from "./packing-tab"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import {
  addItineraryDay,
  createItineraryLocation,
  deleteItineraryDay,
  deleteItineraryGroup,
  deleteItineraryLocation,
  insertItineraryDayWithShift,
  renameItineraryLocation,
  rescheduleItineraryDaysTo,
  setLocationSpanWithShift,
  updateItineraryDay,
} from "@/lib/trips/actions"
import {
  ITINERARY_TONES,
  dateOfIndex,
  dayIndexOf,
  formatEventTime,
  reassignDayIndex,
  reorderRangeSlots,
  liveRowToItineraryDay,
  positionLabel,
  planFloor,
  tripActive,
  withOrdinals,
  type DayZone,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
import {
  rowToLocation,
  type ItineraryLocation,
  type ItineraryLocationRow,
} from "@/lib/trips/location-types"
import { slugToTone } from "@/lib/trips/slug-tone"
import { DayInput } from "./day-input"
import { moneyRounded } from "@/lib/money"
import { useCurrency } from "@/components/currency-context"
import { currencyOptions } from "@/lib/fx/currency-list"

const itineraryBorder: Record<ItineraryTone, string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}

// Tone text color for the location header name (matches MonoBadge tones).
const toneText: Record<ItineraryTone, string> = {
  sea: "text-sea",
  clay: "text-clay",
  moss: "text-moss",
  sand: "text-sand",
}

interface RealtimeRow {
  id: string
  trip_id: string
  day_date: string | null
  day_index: number
  title: string
  sub: string | null
  events: unknown
  tag: string
  tone: string
  group_id: string | null
  group_name: string | null
  location_id: string | null
  created_by: string
  created_at: string
}

type RealtimeLocationRow = ItineraryLocationRow & { start_date: string | null }

// Realtime location rows read their trip start off the row, as days do (see
// liveRowToItineraryDay); a dream's rows have no date and stay positional.
function rowToLiveLocation(row: RealtimeLocationRow): ItineraryLocation {
  const start =
    row.start_date && row.start_index != null
      ? dateOfIndex(2 - row.start_index, row.start_date)
      : null
  return rowToLocation(row, start)
}

interface DaySegment {
  groupId: string | null
  days: ItineraryDay[]
}


/** One-line summary for a collapsed day: the typed sub, else a cheap derived
 * hint from the events (first event text, or "N events"), else "". */
function daySummary(day: ItineraryDay): string {
  if (day.sub.trim()) return day.sub
  const evs = sortEvents(day.events)
  if (evs.length === 0) return ""
  if (evs.length === 1) {
    const e = evs[0]
    const label = formatEventTime(e.time, e.endTime)
    return label ? `${label} ${e.text}` : e.text
  }
  return `${evs.length} events`
}

/** Collapse sorted days into maximal runs of consecutive same-group_id days. */
function toSegments(days: ItineraryDay[]): DaySegment[] {
  const segments: DaySegment[] = []
  for (const day of days) {
    const last = segments[segments.length - 1]
    if (day.groupId && last && last.groupId === day.groupId) {
      last.days.push(day)
    } else {
      segments.push({ groupId: day.groupId, days: [day] })
    }
  }
  return segments
}

/** Order locations by earliest day, empties last by sortOrder. */
function orderTabs(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): ItineraryLocation[] {
  const earliest = new Map<string, number>()
  for (const d of days) {
    if (!d.locationId) continue
    const cur = earliest.get(d.locationId)
    if (cur === undefined || d.dayIndex < cur) earliest.set(d.locationId, d.dayIndex)
  }
  return [...locations].sort((a, b) => {
    const da = a.startIndex ?? earliest.get(a.id)
    const db = b.startIndex ?? earliest.get(b.id)
    if (da !== undefined && db !== undefined) return da - db || a.sortOrder - b.sortOrder
    if (da !== undefined) return -1
    if (db !== undefined) return 1
    return a.sortOrder - b.sortOrder
  })
}

const LOOSE_KEY = "__loose__"

interface DayGroup {
  /** Location id. */
  key: string
  name: string
  tone: ItineraryTone | null
  /** 1-based location number. */
  ord: number | null
  /** Declared span start day number; null = implied by days. */
  start: number | null
  /** Declared span end day number; null = implied by days. */
  end: number | null
  /** What you spend here; null = the trip's currency. */
  currency: string | null
  days: ItineraryDay[]
}

function byIndex(a: ItineraryDay, b: ItineraryDay): number {
  return a.dayIndex - b.dayIndex
}

type TimelineItem =
  | { kind: "location"; group: DayGroup }
  | { kind: "loose"; seg: DaySegment }

/**
 * One day-sorted sequence of timeline items: each location is a collapsible
 * block; each run of location-less days is a bare "loose" segment (single day
 * or a group_id trek). No "In transit" bucket -- loose days float at their date.
 */
function buildTimeline(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): TimelineItem[] {
  const byLoc = new Map<string, ItineraryDay[]>()
  const loose: ItineraryDay[] = []
  for (const d of days) {
    if (d.locationId) {
      const arr = byLoc.get(d.locationId)
      if (arr) arr.push(d)
      else byLoc.set(d.locationId, [d])
    } else {
      loose.push(d)
    }
  }

  const items: { item: TimelineItem; sort: number | null }[] = []

  orderTabs(locations, days).forEach((loc, i) => {
    const gdays = (byLoc.get(loc.id) ?? []).slice().sort(byIndex)
    const group: DayGroup = {
      key: loc.id,
      name: loc.name,
      tone: slugToTone(loc.id),
      ord: i + 1,
      start: loc.startIndex,
      end: loc.endIndex,
      currency: loc.currency,
      days: gdays,
    }
    items.push({
      item: { kind: "location", group },
      sort: loc.startIndex ?? gdays[0]?.dayIndex ?? null,
    })
  })

  for (const seg of toSegments(loose.slice().sort(byIndex))) {
    items.push({ item: { kind: "loose", seg }, sort: seg.days[0].dayIndex })
  }

  return items
    .map((x, idx) => ({ ...x, idx }))
    .sort((a, b) => {
      if (a.sort !== null && b.sort !== null) return a.sort - b.sort || a.idx - b.idx
      if (a.sort !== null) return -1
      if (b.sort !== null) return 1
      return a.idx - b.idx
    })
    .map((x) => x.item)
}

/** Zone a location group: past if its whole span is before today, future if
 * wholly after, else current (contains/straddles today, or undated). */
function groupZone(group: DayGroup, todayIndex: number): DayZone {
  const idx = group.days.map((d) => d.dayIndex)
  const lows = [group.start, ...idx].filter((v): v is number => v !== null)
  const highs = [group.end, ...idx].filter((v): v is number => v !== null)
  if (highs.length && Math.max(...highs) < todayIndex) return "past"
  if (lows.length && Math.min(...lows) > todayIndex) return "future"
  return "today"
}

/** During an active trip, future location groups start collapsed (past ones go
 * into the Past bar, current stays open). Outside a trip, nothing is collapsed. */
function defaultCollapsed(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
  today: string,
  start: string | null,
  end: string | null,
): Set<string> {
  const s = new Set<string>()
  if (start === null || !tripActive(today, start, end ?? start)) return s
  const todayIndex = dayIndexOf(today, start)
  for (const item of buildTimeline(locations, days)) {
    if (item.kind !== "location") continue
    if (groupZone(item.group, todayIndex) === "future") s.add(item.group.key)
  }
  return s
}

export function ItineraryTab({
  tripId,
  tripSlug,
  tripName,
  destination,
  avoid,
  tripStartDate,
  tripEndDate,
  tripDayCount,
  today,
  initialItems,
  initialLocations,
  budgetItems,
  categories,
  members,
  currentPersonId,
}: {
  tripId: string
  tripSlug: string
  tripName: string
  destination: string
  avoid: string
  /** Null on a dream: days show as "Day N" and nothing is past or today. */
  tripStartDate: string | null
  tripEndDate: string | null
  /** The trip's length; null on an older dream that never set one. */
  tripDayCount: number | null
  today: string
  initialItems: ItineraryDay[]
  initialLocations: ItineraryLocation[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentPersonId: string
}) {
  const { currency } = useCurrency()
  const [days, setDays] = React.useState<ItineraryDay[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [blockEdit, setBlockEdit] = React.useState<{
    dayIds: string[]
    groupId: string | null
  } | null>(null)

  function openBlock(dayIds: string[], groupId: string | null) {
    setBlockEdit({ dayIds, groupId })
  }

  const selection = useDaySelection()
  // days is kept date-sorted (withOrdinals), so these ids are in date order.
  const looseIds = days.filter((d) => !d.locationId).map((d) => d.id)

  /** Edit the selected days; reuse their block only if they are all of it. */
  function editSelection() {
    const picked = days.filter((d) => selection.selected.has(d.id))
    const gid = picked[0]?.groupId ?? null
    const wholeBlock =
      gid !== null &&
      picked.every((d) => d.groupId === gid) &&
      days.filter((d) => d.groupId === gid).length === picked.length
    openBlock(
      picked.map((d) => d.id),
      wholeBlock ? gid : null,
    )
    selection.clear()
  }

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setDays(initialItems)
  }

  const [locations, setLocations] = React.useState<ItineraryLocation[]>(
    initialLocations,
  )
  const [lastInitialLocations, setLastInitialLocations] =
    React.useState(initialLocations)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() =>
    defaultCollapsed(initialLocations, initialItems, today, tripStartDate, tripEndDate),
  )
  // Days show their events by default; this tracks the ones the user collapsed.
  const [collapsedDays, setCollapsedDays] = React.useState<Set<string>>(new Set())
  const [pastBarOpen, setPastBarOpen] = React.useState(false)
  const [earlierOpen, setEarlierOpen] = React.useState<Set<string>>(new Set())

  function toggleEarlier(key: string) {
    setEarlierOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleDay(id: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (initialLocations !== lastInitialLocations) {
    setLastInitialLocations(initialLocations)
    setLocations(initialLocations)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`itinerary-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "itinerary_days",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = liveRowToItineraryDay(payload.new as RealtimeRow, tripStartDate)
            setDays((prev) =>
              prev.some((d) => d.id === incoming.id)
                ? prev
                : withOrdinals([...prev, incoming]),
            )
          } else if (payload.eventType === "UPDATE") {
            const incoming = liveRowToItineraryDay(payload.new as RealtimeRow, tripStartDate)
            setDays((prev) =>
              withOrdinals(
                prev.map((d) => (d.id === incoming.id ? incoming : d)),
              ),
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setDays((prev) =>
                withOrdinals(prev.filter((d) => d.id !== old.id)),
              )
            }
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId, tripStartDate])

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`itinerary-locations-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "itinerary_locations",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = rowToLiveLocation(payload.new as RealtimeLocationRow)
            setLocations((prev) =>
              prev.some((l) => l.id === incoming.id)
                ? prev
                : [...prev, incoming].sort((a, b) => a.sortOrder - b.sortOrder),
            )
          } else if (payload.eventType === "UPDATE") {
            const incoming = rowToLiveLocation(payload.new as RealtimeLocationRow)
            setLocations((prev) =>
              prev
                .map((l) => (l.id === incoming.id ? incoming : l))
                .sort((a, b) => a.sortOrder - b.sortOrder),
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setLocations((prev) => prev.filter((l) => l.id !== old.id))
            }
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])

  const defaultIndex = days.length > 0 ? days[days.length - 1].dayIndex + 1 : 1

  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  const [, startReschedule] = React.useTransition()

  // Reorder a group's days and empty-day gaps as one sequence over `slotIndexes`
  // (see reorderRangeSlots). Optimistic; rolls back on error. The caller builds
  // slotIndexes and pre-filters out past days so a live trip stays out of the past.
  function onGroupDragEnd(
    groupDays: ItineraryDay[],
    slotIndexes: number[],
    e: DragEndEvent,
  ) {
    const over = e.over
    const activeId = String(e.active.id)
    if (!over || activeId === String(over.id)) return
    const changes = reorderRangeSlots(groupDays, slotIndexes, activeId, String(over.id))
    if (changes.length === 0) return

    const snapshot = days
    const newIndexById = new Map(changes.map((c) => [c.id, c.dayIndex]))
    setDays((prev) =>
      withOrdinals(
        prev.map((d) =>
          newIndexById.has(d.id)
            ? reassignDayIndex(d, newIndexById.get(d.id)!, tripStartDate)
            : d,
        ),
      ),
    )
    startReschedule(async () => {
      const result = await rescheduleItineraryDaysTo(tripId, tripSlug, changes)
      if (result.error) setDays(snapshot)
    })
  }

  const timeline = buildTimeline(locations, days)

  const budgetByLoc = React.useMemo(() => {
    const m = new Map<string, BudgetItem[]>()
    for (const it of budgetItems) {
      if (!it.locationId) continue
      const arr = m.get(it.locationId)
      if (arr) arr.push(it)
      else m.set(it.locationId, [it])
    }
    return m
  }, [budgetItems])
  const tripWideItems = React.useMemo(
    () => budgetItems.filter((it) => !it.locationId),
    [budgetItems],
  )
  const plannedTotalCents = budgetItems.reduce((s, it) => s + it.amountCents, 0)

  const active =
    tripStartDate !== null && tripActive(today, tripStartDate, tripEndDate ?? tripStartDate)
  // A dream has no today: 0 sits before every day, so nothing reads as past.
  const todayIndex = tripStartDate === null ? 0 : dayIndexOf(today, tripStartDate)
  const plan =
    tripStartDate === null ? null : planFloor(today, tripStartDate, tripEndDate ?? tripStartDate)
  const floorIndex = plan === null || tripStartDate === null ? null : dayIndexOf(plan, tripStartDate)
  // Mid-trip the walk opens on the days that remain; the server floor is what
  // actually protects the earlier ones.
  const plannerDays = active ? days.filter((d) => d.dayIndex >= todayIndex) : days
  const itemIsPast = (it: TimelineItem) =>
    it.kind === "location"
      ? groupZone(it.group, todayIndex) === "past"
      : it.seg.days[it.seg.days.length - 1].dayIndex < todayIndex
  const pastDayTotal = active
    ? timeline.reduce(
        (n, it) =>
          itemIsPast(it)
            ? n +
              (it.kind === "location"
                ? it.group.days.length
                : it.seg.days.length)
            : n,
        0,
      )
    : 0

  const [addDayFor, setAddDayFor] = React.useState<string | null>(null)
  const [addingLocation, setAddingLocation] = React.useState(false)
  const [newLocName, setNewLocName] = React.useState("")
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameVal, setRenameVal] = React.useState("")
  const [renameStart, setRenameStart] = React.useState<number | null>(null)
  const [renameEnd, setRenameEnd] = React.useState<number | null>(null)
  const [renameCurrency, setRenameCurrency] = React.useState("")
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [, startLoc] = React.useTransition()

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function submitNewLocation(e: React.FormEvent) {
    e.preventDefault()
    const name = newLocName.trim()
    if (!name) return
    startLoc(async () => {
      await createItineraryLocation(tripId, tripSlug, name)
      setNewLocName("")
      setAddingLocation(false)
    })
  }

  function submitRename(e: React.FormEvent, locationId: string) {
    e.preventDefault()
    const name = renameVal.trim()
    if (!name) return
    const start = renameStart
    const end = renameEnd
    const useSpan = start !== null && end !== null
    if (useSpan && end < start) return
    setRenameError(null)
    startLoc(async () => {
      const result = await renameItineraryLocation(
        locationId,
        tripId,
        tripSlug,
        name,
        useSpan ? start : null,
        useSpan ? end : null,
        renameCurrency || null,
      )
      if (result.error) {
        setRenameError(result.error)
        return
      }
      if (result.needsPush) {
        if (
          window.confirm(
            "Those dates overlap other plans — push the following days and locations forward to make room?",
          )
        ) {
          const pushed = await setLocationSpanWithShift(
            locationId,
            tripId,
            tripSlug,
            name,
            start!,
            end!,
            renameCurrency || null,
          )
          if (pushed.error) {
            setRenameError(pushed.error)
            return
          }
          setRenamingId(null)
        }
        return
      }
      setRenamingId(null)
    })
  }

  function removeLocation(locationId: string) {
    if (!window.confirm("Delete this location? Its days become travel days.")) {
      return
    }
    startLoc(async () => {
      await deleteItineraryLocation(locationId, tripSlug)
    })
  }

  const planningBlock = (
    <div className={`space-y-2 ${active ? "pt-4 opacity-70" : "pb-4"}`}>
      <AddDayRow
        key="add-loose"
        tripId={tripId}
        tripSlug={tripSlug}
        tripStartDate={tripStartDate}
        defaultIndex={defaultIndex}
        locationId={null}
        open={addDayFor === LOOSE_KEY}
        onClose={() => setAddDayFor(null)}
      />
      {addDayFor === LOOSE_KEY ? null : (
        <button
          type="button"
          onClick={() => setAddDayFor(LOOSE_KEY)}
          className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          + day
        </button>
      )}
      {addingLocation ? (
        <form onSubmit={submitNewLocation}>
          <input
            type="text"
            autoFocus
            value={newLocName}
            onChange={(e) => setNewLocName(e.target.value)}
            onBlur={() => {
              if (!newLocName.trim()) setAddingLocation(false)
            }}
            placeholder="Location name"
            className="block w-full rounded-lg border border-clay bg-transparent px-3 py-2.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddingLocation(true)}
          className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          + location
        </button>
      )}
      <AssistantBlock
        surface="itinerary"
        tripSlug={tripSlug}
        door={
          <PlanningPlaceDoor
            tripId={tripId}
            tripSlug={tripSlug}
            destination={destination}
            locations={locations}
            days={days}
          />
        }
      />
      <PlanItinerary
        tripId={tripId}
        tripSlug={tripSlug}
        tripName={tripName}
        destination={destination}
        avoid={avoid}
        locations={locations}
        days={plannerDays}
        startDate={tripStartDate}
        dayCount={tripDayCount}
      />
    </div>
  )

  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5 lg:px-10 lg:pt-6">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="px-5 pt-4 pb-6 lg:px-10">
        {active ? null : planningBlock}

        {timeline.length === 0 ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            Nothing planned yet — add a day, or a location to group them.
          </p>
        ) : (
          <>
            {pastDayTotal > 0 ? (
              <button
                type="button"
                onClick={() => setPastBarOpen((v) => !v)}
                aria-expanded={pastBarOpen}
                className="flex w-full items-center gap-3 border-t border-rule py-3 text-left opacity-60 first:border-t-0"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Past · {pastDayTotal} {pastDayTotal === 1 ? "day" : "days"}
                </span>
                <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground">
                  {pastBarOpen ? "⌄" : "›"}
                </span>
              </button>
            ) : null}
            {(() => {
            const rendered = timeline.map((item) => {
            if (item.kind === "loose") {
              if (itemIsPast(item) && !pastBarOpen) return null
              return (
                <div
                  key={item.seg.groupId ?? item.seg.days[0].id}
                  className="border-t border-rule first:border-t-0 py-1 pl-10"
                >
                  <DaySegmentView
                    seg={item.seg}
                    tripId={tripId}
                    tripSlug={tripSlug}
                    lastDayId={item.seg.days[item.seg.days.length - 1].id}
                    editingId={editingId}
                    setEditingId={setEditingId}
                    locations={locations}
                    collapsedDays={collapsedDays}
                    toggleDay={toggleDay}
                    dimBefore={active ? todayIndex : null}
                    todayIndex={todayIndex}
                    tripStartDate={tripStartDate}
                    categories={categories}
                    members={members}
                    currentPersonId={currentPersonId}
                    sortable={locations.length === 0}
                    onEditBlock={openBlock}
                    selection={selection}
                    scopeKey="loose"
                    orderedIds={looseIds}
                  />
                </div>
              )
            }
            const group = item.group
            const groupPast = active && groupZone(group, todayIndex) === "past"
            if (groupPast && !pastBarOpen) return null
            const open = !collapsed.has(group.key)
            const isLoc = true
            const count = group.days.length
            const last = group.days[count - 1]
            const range =
              count === 0
                ? ""
                : count === 1
                  ? group.days[0].date
                  : `${group.days[0].date} – ${last.date}`
            const spanRange =
              group.start !== null && group.end !== null
                ? `${positionLabel(group.start, tripStartDate)} – ${positionLabel(group.end, tripStartDate)}`
                : ""
            return (
              <div
                key={group.key}
                className={`border-t border-rule first:border-t-0 ${
                  groupPast ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-3 py-3">
                  <span className="w-7 flex-shrink-0 font-mono text-[18px] leading-none text-muted-foreground">
                    {group.ord !== null
                      ? String(group.ord).padStart(2, "0")
                      : "··"}
                  </span>
                  <div className="min-w-0 flex-1">
                    {isLoc && renamingId === group.key ? (
                      <form
                        onSubmit={(e) => submitRename(e, group.key)}
                        className="space-y-2"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          className="t-display w-full border-0 border-b border-rule bg-transparent text-[20px] leading-none text-foreground focus:border-clay focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <DayInput
                            ariaLabel="Location start date"
                            value={renameStart}
                            onChange={setRenameStart}
                            startDate={tripStartDate}
                            className="t-num border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground focus:border-clay focus:outline-none"
                          />
                          <span className="font-mono text-[10px] text-muted-foreground">
                            –
                          </span>
                          <DayInput
                            ariaLabel="Location end date"
                            value={renameEnd}
                            min={renameStart}
                            onChange={setRenameEnd}
                            startDate={tripStartDate}
                            className="t-num border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground focus:border-clay focus:outline-none"
                          />
                          <select
                            aria-label="Location currency"
                            value={renameCurrency}
                            onChange={(e) => setRenameCurrency(e.target.value)}
                            className="max-w-[8rem] border-0 border-b border-rule bg-transparent py-1 font-mono text-[11px] text-foreground focus:border-clay focus:outline-none"
                          >
                            <option value="">Trip currency</option>
                            {currencyOptions().map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-clay hover:text-foreground"
                          >
                            save
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
                          >
                            cancel
                          </button>
                        </div>
                        {renameError ? (
                          <p className="font-mono text-[10px] text-clay">
                            {renameError}
                          </p>
                        ) : null}
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleCollapse(group.key)}
                        aria-expanded={open}
                        className={`t-display text-left text-[20px] leading-none ${
                          group.tone ? toneText[group.tone] : "text-foreground"
                        }`}
                      >
                        {group.name}
                      </button>
                    )}
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {count === 0
                        ? spanRange || "no days"
                        : `${count} ${count === 1 ? "day" : "days"} · ${
                            spanRange || range
                          }`}
                    </div>
                  </div>
                  {isLoc ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Edit location"
                        onClick={() => {
                          setRenameVal(group.name)
                          setRenameStart(group.start)
                          setRenameEnd(group.end)
                          setRenameCurrency(group.currency ?? "")
                          setRenameError(null)
                          setRenamingId(group.key)
                        }}
                        className="border-0 bg-transparent px-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        aria-label="Delete location"
                        onClick={() => removeLocation(group.key)}
                        className="border-0 bg-transparent px-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    aria-label={open ? "Collapse" : "Expand"}
                    onClick={() => toggleCollapse(group.key)}
                    className="border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground"
                  >
                    {open ? "⌄" : "›"}
                  </button>
                </div>

                {open ? (
                  <div className="pb-3 pl-10">
                    {(() => {
                      const dayRows = (() => {
                      const segs = toSegments(group.days)
                      type Row = { kind: "seg"; seg: (typeof segs)[number] }
                      const rows: Row[] = segs.map((seg) => ({ kind: "seg", seg }))

                      // Real days present -> the group is wrapped in a
                      // DndContext below and its slots are draggable.
                      const canSort = group.days.length > 0

                      const renderRow = (row: Row, sortable: boolean) => (
                        <DaySegmentView
                          key={row.seg.groupId ?? row.seg.days[0].id}
                          seg={row.seg}
                          tripId={tripId}
                          tripSlug={tripSlug}
                          lastDayId={last.id}
                          editingId={editingId}
                          setEditingId={setEditingId}
                          locations={locations}
                          collapsedDays={collapsedDays}
                          toggleDay={toggleDay}
                          dimBefore={active ? todayIndex : null}
                          todayIndex={todayIndex}
                          tripStartDate={tripStartDate}
                          categories={categories}
                          members={members}
                          currentPersonId={currentPersonId}
                          sortable={sortable}
                          onEditBlock={openBlock}
                          selection={selection}
                          scopeKey={group.key}
                          orderedIds={[...group.days].sort(byIndex).map((d) => d.id)}
                        />
                      )

                      const rowSortableIds = (row: Row): string[] =>
                        canSort ? row.seg.days.map((d) => d.id) : []

                      const isCurrentLoc =
                        active && groupZone(group, todayIndex) === "today"
                      if (!isCurrentLoc)
                        return {
                          rendered: rows.map((r) => renderRow(r, canSort)),
                          ids: rows.flatMap(rowSortableIds),
                        }

                      const rowEnd = (row: Row) =>
                        row.seg.days[row.seg.days.length - 1].dayIndex
                      const pastRows = rows.filter((r) => rowEnd(r) < todayIndex)
                      const liveRows = rows.filter((r) => rowEnd(r) >= todayIndex)
                      const pastDayCount = pastRows.reduce(
                        (n, r) => n + r.seg.days.length,
                        0,
                      )
                      const earlierExpanded = earlierOpen.has(group.key)

                      return {
                        rendered: (
                          <>
                            {pastDayCount > 0 ? (
                              <div className="my-1">
                                <button
                                  type="button"
                                  onClick={() => toggleEarlier(group.key)}
                                  aria-expanded={earlierExpanded}
                                  className="flex w-full items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2 text-left opacity-70 transition-colors hover:border-foreground"
                                >
                                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                    {pastDayCount} earlier{" "}
                                    {pastDayCount === 1 ? "day" : "days"}
                                  </span>
                                  <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground">
                                    {earlierExpanded ? "⌄" : "›"}
                                  </span>
                                </button>
                                {earlierExpanded
                                  ? pastRows.map((r) => renderRow(r, false))
                                  : null}
                              </div>
                            ) : null}
                            {liveRows.map((r) => renderRow(r, canSort))}
                          </>
                        ),
                        ids: liveRows.flatMap(rowSortableIds),
                      }
                      })()
                      if (group.days.length === 0) return dayRows.rendered
                      // Occupied days only (all span days are real rows now);
                      // past-filtered on a live trip so the past can't be a drop.
                      const slotIndexes = group.days
                        .map((d) => d.dayIndex)
                        .sort((a, b) => a - b)
                        .filter((i) => !active || i >= todayIndex)
                      return (
                        <DndContext
                          id={`dnd-${group.key}`}
                          sensors={dragSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(e) => onGroupDragEnd(group.days, slotIndexes, e)}
                        >
                          <SortableContext
                            items={dayRows.ids}
                            strategy={verticalListSortingStrategy}
                          >
                            {dayRows.rendered}
                          </SortableContext>
                        </DndContext>
                      )
                    })()}

                    <div className="pt-2">
                      <AddDayRow
                        key={`add-${group.key}`}
                        tripId={tripId}
                        tripSlug={tripSlug}
                        tripStartDate={tripStartDate}
                        defaultIndex={defaultIndex}
                        locationId={isLoc ? group.key : null}
                        open={addDayFor === group.key}
                        onClose={() => setAddDayFor(null)}
                      />
                      {addDayFor === group.key ? null : (
                        <button
                          type="button"
                          onClick={() => setAddDayFor(group.key)}
                          className="block w-full rounded-lg border border-dashed border-rule py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
                        >
                          + day
                        </button>
                      )}
                    </div>
                    <BudgetScopeEditor
                      tripId={tripId}
                      tripSlug={tripSlug}
                      locationId={group.key}
                      items={budgetByLoc.get(group.key) ?? []}
                      withDates={false}
                      defaultCategory="Accommodation"
                      label="Budget"
                    />
                  </div>
                ) : null}
              </div>
            )
            })
            if (locations.length !== 0) return rendered
            // Locationless: one loose run, no empty slots rendered, so the slots
            // are the occupied days only (past-filtered on a live trip).
            const looseSlotIndexes = days
              .map((d) => d.dayIndex)
              .sort((a, b) => a - b)
              .filter((i) => !active || i >= todayIndex)
            return (
              <DndContext
                id="dnd-loose"
                sensors={dragSensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => onGroupDragEnd(days, looseSlotIndexes, e)}
              >
                <SortableContext
                  items={days.map((d) => d.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {rendered}
                </SortableContext>
              </DndContext>
            )
            })()}
          </>
        )}
        <div className="border-t border-rule pt-3">
          {locations.length === 0 ? (
            <BudgetScopeEditor
              tripId={tripId}
              tripSlug={tripSlug}
              locationId={null}
              items={tripWideItems}
              withDates={false}
              defaultCategory="Accommodation"
              label={tripName}
            />
          ) : (
            <BudgetScopeEditor
              tripId={tripId}
              tripSlug={tripSlug}
              locationId={null}
              items={tripWideItems}
              withDates
              defaultCategory="Other"
              label="Trip-wide"
            />
          )}
          <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Planned total
            </span>
            <span className="t-num font-mono text-[14px] text-foreground">
              {moneyRounded(plannedTotalCents, currency)}
            </span>
          </div>
        </div>
        {active ? planningBlock : null}
      </div>
      <SelectionBox boxRef={selection.boxRef} />
      {selection.selected.size >= 2 ? (
        <SelectionTray
          count={selection.selected.size}
          onEdit={editSelection}
          onClear={selection.clear}
        />
      ) : null}
      {blockEdit ? (
        <BlockEditor
          tripId={tripId}
          tripSlug={tripSlug}
          days={days.filter((d) => blockEdit.dayIds.includes(d.id))}
          groupId={blockEdit.groupId}
          floor={floorIndex}
          onClose={() => setBlockEdit(null)}
        />
      ) : null}
    </section>
  )
}

function DaySegmentView({
  seg,
  tripId,
  tripSlug,
  lastDayId,
  editingId,
  setEditingId,
  locations,
  collapsedDays,
  toggleDay,
  dimBefore,
  todayIndex,
  tripStartDate,
  categories,
  members,
  currentPersonId,
  sortable,
  onEditBlock,
  selection,
  scopeKey,
  orderedIds,
}: {
  seg: DaySegment
  tripId: string
  tripSlug: string
  lastDayId: string
  editingId: string | null
  setEditingId: (id: string | null) => void
  locations: ItineraryLocation[]
  collapsedDays: Set<string>
  toggleDay: (id: string) => void
  dimBefore: number | null
  todayIndex: number
  tripStartDate: string | null
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentPersonId: string
  sortable: boolean
  onEditBlock: (dayIds: string[], groupId: string) => void
  selection: DaySelection
  /** Selection scope (location key) and its days in date order. */
  scopeKey: string
  orderedIds: string[]
}) {
  const cards = seg.days.map((day) => {
    const cardProps = {
      day,
      tripId,
      tripSlug,
      expanded: !collapsedDays.has(day.id),
      onToggle: () => toggleDay(day.id),
      dimBefore,
      todayIndex,
      tripStartDate,
      isLast: day.id === lastDayId,
      isEditing: editingId === day.id,
      onStartEdit: () => setEditingId(day.id),
      onStopEdit: () => setEditingId(null),
      locations,
      categories,
      members,
      currentPersonId,
      selected: selection.selected.has(day.id),
      onSelectStart: (shift: boolean, x: number, y: number) =>
        selection.begin(scopeKey, orderedIds, day.id, shift, x, y),
    }
    return sortable ? (
      <SortableDayCard key={day.id} id={day.id} {...cardProps} />
    ) : (
      <DayCard key={day.id} {...cardProps} />
    )
  })
  if (seg.groupId && seg.days.length > 1) {
    return (
      <div className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1">
        <span
          className={`absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
            seg.days[0].groupName ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {seg.days[0].groupName ?? "added together"}
        </span>
        <button
          type="button"
          onClick={() => onEditBlock(seg.days.map((d) => d.id), seg.groupId!)}
          className="absolute right-8 top-0.5 border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-sea hover:text-foreground"
        >
          edit all
        </button>
        <form
          action={deleteItineraryGroup.bind(null, tripId, tripSlug, seg.groupId)}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete all ${seg.days.length} days in this block? This can't be undone.`,
              )
            ) {
              e.preventDefault()
            }
          }}
          className="absolute right-1 top-0.5 inline-flex"
        >
          <button
            type="submit"
            aria-label="Delete block"
            className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
          >
            ×
          </button>
        </form>
        {cards}
      </div>
    )
  }
  return <>{cards}</>
}

interface DayCardProps {
  day: ItineraryDay
  tripId: string
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  expanded: boolean
  onToggle: () => void
  dimBefore: number | null
  todayIndex: number
  tripStartDate: string | null
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentPersonId: string
  selected: boolean
  onSelectStart: (shift: boolean, x: number, y: number) => void
}

function SortableDayCard({ id, ...rest }: DayCardProps & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: rest.isEditing })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DayCard {...rest} />
    </div>
  )
}

function DayCard({
  day,
  tripId,
  tripSlug,
  isLast,
  isEditing,
  expanded,
  onToggle,
  dimBefore,
  todayIndex,
  tripStartDate,
  onStartEdit,
  onStopEdit,
  dragHandle,
  locations,
  categories,
  members,
  currentPersonId,
  selected,
  onSelectStart,
}: DayCardProps) {
  if (isEditing) {
    return (
      <DayEditor
        day={day}
        tripSlug={tripSlug}
        tripStartDate={tripStartDate}
        locations={locations}
        onDone={onStopEdit}
      />
    )
  }
  return (
    <DayView
      day={day}
      tripId={tripId}
      tripSlug={tripSlug}
      isLast={isLast}
      expanded={expanded}
      onToggle={onToggle}
      dimBefore={dimBefore}
      todayIndex={todayIndex}
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
      locations={locations}
      categories={categories}
      members={members}
      currentPersonId={currentPersonId}
      selected={selected}
      onSelectStart={onSelectStart}
    />
  )
}

function DayView({
  day,
  tripId,
  tripSlug,
  isLast,
  expanded,
  onToggle,
  dimBefore,
  todayIndex,
  onStartEdit,
  dragHandle,
  locations,
  categories,
  members,
  currentPersonId,
  selected,
  onSelectStart,
}: {
  day: ItineraryDay
  tripId: string
  tripSlug: string
  isLast: boolean
  expanded: boolean
  onToggle: () => void
  dimBefore: number | null
  todayIndex: number
  onStartEdit: () => void
  dragHandle?: React.ReactNode
  locations: ItineraryLocation[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  currentPersonId: string
  selected: boolean
  onSelectStart: (shift: boolean, x: number, y: number) => void
}) {
  // Which event's panel is open (press the event), and whether that panel's
  // expense form has been asked for. Only one event is open at a time.
  const [openEvent, setOpenEvent] = React.useState<number | null>(null)
  const [openExpense, setOpenExpense] = React.useState<number | null>(null)
  return (
    // A mouse press anywhere in the row but the card selects days (desktop
    // only; a touch tap is ignored). -ml-10 pl-10 stretches the row over the
    // left margin. stopPropagation keeps dnd-kit's mouse drag from starting.
    <div
      data-day-id={day.id}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && inSelectZone(e.target as Element)) {
          onSelectStart(e.shiftKey, e.clientX, e.clientY)
        }
      }}
      onMouseDown={(e) => {
        if (!inSelectZone(e.target as Element)) return
        e.stopPropagation()
        e.preventDefault()
      }}
      className="relative -ml-10 flex cursor-crosshair gap-3.5 py-3.5 pl-10"
    >
      <div className="relative w-9 flex-shrink-0 select-none">
        <div className="font-mono text-[22px] leading-none tracking-[-0.02em] text-foreground">
          {day.dom}
        </div>
        <div className="mt-0.5 font-mono text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
          {day.mon.toUpperCase()}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {day.dow.toUpperCase()}
        </div>
        {!isLast ? (
          <div className="absolute -bottom-3.5 left-[11px] top-14 w-px bg-border" />
        ) : null}
      </div>
      <div
        data-day-card
        className={`flex-1 cursor-auto rounded-lg border px-3.5 py-3 border-l-[3px] ${
          selected ? "border-sea bg-sea/10" : "border-border bg-card"
        } ${itineraryBorder[day.tone]} ${
          dimBefore !== null && day.dayIndex < dimBefore ? "opacity-60" : ""
        }`}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {dragHandle}
          </div>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            day {Number(day.d)}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="t-display mb-1 block w-full text-left text-[22px] leading-tight text-foreground"
        >
          {day.title}
        </button>
        {expanded ? (
          day.events.length > 0 ? (
            <div className="space-y-0.5">
              {sortEvents(day.events).map((ev, i) => (
                <div key={i}>
                  <div className="flex gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenEvent(openEvent === i ? null : i)
                        setOpenExpense(null)
                      }}
                      aria-expanded={openEvent === i}
                      className="flex gap-1.5 border-0 bg-transparent p-0 text-left text-[12.5px] leading-snug text-muted-foreground"
                    >
                      {ev.time ? (
                        <span className="t-num shrink-0 whitespace-nowrap text-foreground/70">
                          {formatEventTime(ev.time, ev.endTime)}
                        </span>
                      ) : null}
                      <span>{ev.text}</span>
                    </button>
                    {ev.url ? (
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                      >
                        ↗ source
                      </a>
                    ) : null}
                  </div>
                  {openEvent === i ? (
                    <div className="mt-0.5 mb-1">
                      {ev.details ? (
                        <p className="whitespace-pre-line text-[12px] leading-snug text-muted-foreground/80">
                          {ev.details}
                        </p>
                      ) : null}
                      {openExpense === i ? (
                        <EventExpense
                          tripId={tripId}
                          tripSlug={tripSlug}
                          eventText={ev.text}
                          eventCategory={ev.category}
                          dayDate={day.dayDate}
                          locationId={day.locationId}
                          locationCurrency={
                            locations.find((l) => l.id === day.locationId)
                              ?.currency ?? null
                          }
                          currentPersonId={currentPersonId}
                          categories={categories}
                          members={members}
                          onClose={() => setOpenExpense(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOpenExpense(i)}
                          className="mt-1 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                        >
                          + expense
                        </button>
                      )}
                    </div>
                  ) : null}
                  {day.dayIndex < todayIndex ? (
                    <EventRating
                      tripSlug={tripSlug}
                      dayId={day.id}
                      eventIndex={i}
                      rating={ev.rating}
                      note={ev.note}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null
        ) : daySummary(day) ? (
          <button
            type="button"
            onClick={onToggle}
            className="block w-full text-left text-[12.5px] leading-snug text-muted-foreground"
          >
            {daySummary(day)}
          </button>
        ) : null}
        <div className="mt-2 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onStartEdit}
            aria-label="Edit day"
            className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            ✎
          </button>
          <form
            action={deleteItineraryDay.bind(null, day.id, tripSlug)}
            onSubmit={(e) => {
              if (
                !window.confirm("Delete this day? This can't be undone.")
              ) {
                e.preventDefault()
              }
            }}
            className="inline-flex"
          >
            <button
              type="submit"
              aria-label="Delete day"
              className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function DayEditor({
  day,
  tripSlug,
  tripStartDate,
  locations,
  onDone,
}: {
  day: ItineraryDay
  tripSlug: string
  tripStartDate: string | null
  locations: ItineraryLocation[]
  onDone: () => void
}) {
  const [dayIndex, setDayIndex] = React.useState<number | null>(day.dayIndex)
  const [title, setTitle] = React.useState(day.title)
  const [sub, setSub] = React.useState(day.sub)
  const [events, setEvents] = React.useState<EventDraft[]>(() =>
    toEventDrafts(day.events),
  )
  const [tone, setTone] = React.useState<ItineraryTone>(day.tone)
  const [locationId, setLocationId] = React.useState<string | null>(
    day.locationId,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || dayIndex === null) return
    setError(null)
    startTransition(async () => {
      const result = await updateItineraryDay({
        dayId: day.id,
        tripSlug,
        dayIndex,
        title,
        sub,
        events: events.map(draftToEvent),
        tone,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <DayForm
      heading="Edit day"
      tripStartDate={tripStartDate}
      dayIndex={dayIndex}
      setDayIndex={setDayIndex}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      events={events}
      setEvents={setEvents}
      tone={tone}
      setTone={setTone}
      locations={locations}
      locationId={locationId}
      setLocationId={setLocationId}
      error={error}
      isPending={isPending}
      submitLabel="save"
      onSubmit={save}
      onCancel={onDone}
    />
  )
}

function AddDayRow({
  tripId,
  tripSlug,
  tripStartDate,
  defaultIndex,
  locationId,
  open,
  onClose,
}: {
  tripId: string
  tripSlug: string
  tripStartDate: string | null
  defaultIndex: number
  locationId: string | null
  open: boolean
  onClose: () => void
}) {
  const [dayIndex, setDayIndex] = React.useState<number | null>(defaultIndex)
  const [endIndex, setEndIndex] = React.useState<number | null>(null)
  const [groupName, setGroupName] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [events, setEvents] = React.useState<EventDraft[]>([])
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    onClose()
    setDayIndex(defaultIndex)
    setEndIndex(null)
    setGroupName("")
    setTitle("")
    setSub("")
    setEvents([])
    setTone("sea")
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || dayIndex === null) return
    setError(null)
    startTransition(async () => {
      const payload = {
        tripId,
        tripSlug,
        dayIndex,
        endIndex: endIndex ?? undefined,
        groupName,
        title,
        sub,
        events: events.map(draftToEvent),
        tone,
        locationId,
      }
      const result = await addItineraryDay(payload)
      if (result.dateTaken) {
        if (
          window.confirm(
            "No empty day there — push the following days forward to make room?",
          )
        ) {
          const pushed = await insertItineraryDayWithShift(payload)
          if (pushed.error) {
            setError(pushed.error)
            return
          }
          reset()
        }
        return
      }
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
  }

  if (!open) return null

  return (
    <DayForm
      heading="Add day"
      tripStartDate={tripStartDate}
      dayIndex={dayIndex}
      setDayIndex={setDayIndex}
      endIndex={endIndex}
      setEndIndex={setEndIndex}
      groupName={groupName}
      setGroupName={setGroupName}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      events={events}
      setEvents={setEvents}
      tone={tone}
      setTone={setTone}
      error={error}
      isPending={isPending}
      submitLabel="add"
      onSubmit={submit}
      onCancel={reset}
    />
  )
}


function DayForm({
  heading,
  tripStartDate,
  dayIndex,
  setDayIndex,
  endIndex,
  setEndIndex,
  groupName,
  setGroupName,
  title,
  setTitle,
  sub,
  setSub,
  events,
  setEvents,
  tone,
  setTone,
  locations,
  locationId,
  setLocationId,
  error,
  isPending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string
  tripStartDate: string | null
  dayIndex: number | null
  setDayIndex: (i: number | null) => void
  /** When provided (Add mode), a second "To" day enables multi-day creation. */
  endIndex?: number | null
  setEndIndex?: (i: number | null) => void
  /** When provided (Add mode), the block-name field for multi-day spans. */
  groupName?: string
  setGroupName?: (s: string) => void
  title: string
  setTitle: (s: string) => void
  sub: string
  setSub: (s: string) => void
  events: EventDraft[]
  setEvents: (e: EventDraft[]) => void
  tone: ItineraryTone
  setTone: (t: ItineraryTone) => void
  /** When provided (Edit mode), a Location select moves the day. */
  locations?: ItineraryLocation[]
  locationId?: string | null
  setLocationId?: (v: string | null) => void
  error: string | null
  isPending: boolean
  submitLabel: string
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}) {

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-clay bg-card p-3.5"
    >
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        / {heading}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {setEndIndex ? "From" : "Date"}
          </span>
          <DayInput
            value={dayIndex}
            onChange={setDayIndex}
            startDate={tripStartDate}
            disabled={isPending}
            required
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
        {setEndIndex ? (
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              To
            </span>
            <DayInput
              value={endIndex ?? null}
              min={dayIndex}
              onChange={setEndIndex}
              startDate={tripStartDate}
              disabled={isPending}
              className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        ) : null}
      </div>

      {setEndIndex && setGroupName && endIndex != null ? (
        <label className="mt-3 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Block name
          </span>
          <input
            type="text"
            value={groupName ?? ""}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Optional, e.g. Rinjani Trek"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
      ) : null}

      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Title
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Summary
        </span>
        <input
          type="text"
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder="One-line overview of the day"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <div className="mt-3">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Events
        </span>
        <div className="mt-1.5 space-y-2">
          <EventDraftList
            events={events}
            setEvents={setEvents}
            isPending={isPending}
          />
        </div>
      </div>

      <div className="mt-4">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Tone
        </span>
        <div className="mt-1.5 flex gap-1.5">
          {ITINERARY_TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              disabled={isPending}
              aria-pressed={tone === t}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors disabled:opacity-50 ${
                tone === t
                  ? "border-foreground bg-foreground text-background"
                  : "border-rule bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`h-2 w-2 rounded-full bg-${t}`} aria-hidden />
              {t}
            </button>
          ))}
        </div>
      </div>

      {locations && setLocationId ? (
        <label className="mt-3 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Location
          </span>
          <Select
            value={locationId}
            onValueChange={(value: string | null) => setLocationId(value)}
            disabled={isPending}
          >
            <SelectTrigger className="py-1.5">
              <SelectValue>
                {(value: string | null) =>
                  value === null
                    ? "In transit (no location)"
                    : (locations.find((l) => l.id === value)?.name ??
                      "In transit (no location)")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>In transit (no location)</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setEvents([...events, newEventDraft()])}
          disabled={isPending}
          className="border-0 bg-transparent px-1 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          + add event
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !title.trim()}
            className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
