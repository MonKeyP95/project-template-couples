"use client"

import * as React from "react"

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Label, MonoBadge, SuggestionCard } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addItineraryDay,
  createItineraryLocation,
  deleteItineraryDay,
  deleteItineraryLocation,
  renameItineraryLocation,
  rescheduleItineraryDays,
  updateItineraryDay,
} from "@/lib/trips/actions"
import {
  ITINERARY_TONES,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { slugToTone } from "@/lib/trips/slug-tone"

const itineraryBorder: Record<ItineraryTone, string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}

// Tone outline + text for location tabs, matching the MonoBadge day-tag look.
const tabTone: Record<ItineraryTone, string> = {
  sea: "border-sea text-sea",
  clay: "border-clay text-clay",
  moss: "border-moss text-moss",
  sand: "border-sand text-sand",
}

interface RealtimeRow {
  id: string
  trip_id: string
  day_date: string
  title: string
  sub: string | null
  tag: string
  tone: string
  group_id: string | null
  location_id: string | null
  created_by: string
  created_at: string
}

interface DaySegment {
  groupId: string | null
  days: ItineraryDay[]
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

function nextDayAfter(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Order locations by earliest day date, empties last by sortOrder. */
function orderTabs(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): ItineraryLocation[] {
  const earliest = new Map<string, string>()
  for (const d of days) {
    if (!d.locationId) continue
    const cur = earliest.get(d.locationId)
    if (cur === undefined || d.dayDate < cur) earliest.set(d.locationId, d.dayDate)
  }
  return [...locations].sort((a, b) => {
    const da = earliest.get(a.id)
    const db = earliest.get(b.id)
    if (da && db) return da < db ? -1 : da > db ? 1 : a.sortOrder - b.sortOrder
    if (da) return -1
    if (db) return 1
    return a.sortOrder - b.sortOrder
  })
}

export function ItineraryTab({
  tripId,
  tripSlug,
  tripStartDate,
  initialItems,
  initialLocations,
}: {
  tripId: string
  tripSlug: string
  tripStartDate: string
  initialItems: ItineraryDay[]
  initialLocations: ItineraryLocation[]
}) {
  const [days, setDays] = React.useState<ItineraryDay[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setDays(initialItems)
  }

  const [locations, setLocations] = React.useState<ItineraryLocation[]>(
    initialLocations,
  )
  const [lastInitialLocations, setLastInitialLocations] =
    React.useState(initialLocations)
  const [activeLocationId, setActiveLocationId] = React.useState<string | null>(
    initialLocations[0]?.id ?? null,
  )

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
            const incoming = rowToItineraryDay(payload.new as RealtimeRow)
            setDays((prev) =>
              prev.some((d) => d.id === incoming.id)
                ? prev
                : withOrdinals([...prev, incoming]),
            )
          } else if (payload.eventType === "UPDATE") {
            const incoming = rowToItineraryDay(payload.new as RealtimeRow)
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
  }, [tripId])

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
            const r = payload.new as {
              id: string
              name: string
              sort_order: number
            }
            const incoming: ItineraryLocation = {
              id: r.id,
              name: r.name,
              sortOrder: r.sort_order,
            }
            setLocations((prev) =>
              prev.some((l) => l.id === incoming.id)
                ? prev
                : [...prev, incoming].sort((a, b) => a.sortOrder - b.sortOrder),
            )
          } else if (payload.eventType === "UPDATE") {
            const r = payload.new as {
              id: string
              name: string
              sort_order: number
            }
            setLocations((prev) =>
              prev
                .map((l) =>
                  l.id === r.id
                    ? { id: r.id, name: r.name, sortOrder: r.sort_order }
                    : l,
                )
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

  const defaultDate =
    days.length > 0
      ? nextDayAfter(days[days.length - 1].dayDate)
      : tripStartDate

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  // Stable id keeps dnd-kit's aria-describedby deterministic across SSR/CSR.
  const dndId = React.useId()
  const [, startReschedule] = React.useTransition()

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = days.findIndex((d) => d.id === active.id)
    const newIndex = days.findIndex((d) => d.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const snapshot = days
    const reordered = arrayMove(days, oldIndex, newIndex)
    // The trip's existing dates, sorted, are the fixed slots. yyyy-mm-dd sorts
    // lexically = chronologically. Rebuild via rowToItineraryDay so dow/date
    // recompute from the reassigned day_date.
    const slots = days.map((d) => d.dayDate).sort()
    const reassigned = withOrdinals(
      reordered.map((d, i) =>
        rowToItineraryDay({
          id: d.id,
          day_date: slots[i],
          title: d.title,
          sub: d.sub,
          tag: d.tag,
          tone: d.tone,
        }),
      ),
    )
    setDays(reassigned)

    startReschedule(async () => {
      const result = await rescheduleItineraryDays(
        tripId,
        tripSlug,
        reordered.map((d) => d.id),
      )
      if (result.error) setDays(snapshot)
    })
  }

  const orderedTabs = orderTabs(locations, days)
  const hasTravel = days.some((d) => !d.locationId)
  const tabIds = orderedTabs.map((t) => t.id)
  const effectiveActive =
    activeLocationId !== null && tabIds.includes(activeLocationId)
      ? activeLocationId
      : activeLocationId === null && hasTravel
        ? null
        : (tabIds[0] ?? null)
  const tabDays = days.filter((d) => (d.locationId ?? null) === effectiveActive)

  const [addMenuOpen, setAddMenuOpen] = React.useState(false)
  const [addDayOpen, setAddDayOpen] = React.useState(false)
  const [addingLocation, setAddingLocation] = React.useState(false)
  const [newLocName, setNewLocName] = React.useState("")
  const [renaming, setRenaming] = React.useState(false)
  const [renameVal, setRenameVal] = React.useState("")
  const [, startLoc] = React.useTransition()

  function submitNewLocation(e: React.FormEvent) {
    e.preventDefault()
    const name = newLocName.trim()
    if (!name) return
    startLoc(async () => {
      const result = await createItineraryLocation(tripId, tripSlug, name)
      if (!result.error && result.location) {
        setActiveLocationId(result.location.id)
      }
      setNewLocName("")
      setAddingLocation(false)
    })
  }

  function submitRename(e: React.FormEvent) {
    e.preventDefault()
    const name = renameVal.trim()
    if (!name || effectiveActive === null) return
    startLoc(async () => {
      await renameItineraryLocation(effectiveActive, tripSlug, name)
      setRenaming(false)
    })
  }

  function removeActiveLocation() {
    if (effectiveActive === null) return
    if (
      !window.confirm("Delete this location? Its days become travel days.")
    ) {
      return
    }
    const id = effectiveActive
    startLoc(async () => {
      await deleteItineraryLocation(id, tripSlug)
      setActiveLocationId(null)
    })
  }

  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5 lg:px-10 lg:pt-6">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 px-5 pt-3 lg:px-10">
        <div className="flex gap-1.5 overflow-x-auto">
        {orderedTabs.map((loc, i) => {
          const active = effectiveActive === loc.id
          const tone = slugToTone(loc.id)
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => setActiveLocationId(loc.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase leading-none tracking-[0.16em] transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : `bg-transparent ${tabTone[tone]}`
              }`}
            >
              <span className={active ? "text-background/60" : "opacity-50"}>
                {String(i + 1).padStart(2, "0")}
              </span>
              {loc.name}
            </button>
          )
        })}
        {hasTravel ? (
          <button
            type="button"
            onClick={() => setActiveLocationId(null)}
            aria-pressed={effectiveActive === null}
            className={`inline-flex items-center whitespace-nowrap rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase leading-none tracking-[0.16em] transition-colors ${
              effectiveActive === null
                ? "border-foreground bg-foreground text-background"
                : "border-rule bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            In transit
          </button>
        ) : null}
        </div>
        {addingLocation ? (
          <form onSubmit={submitNewLocation} className="inline-flex">
            <input
              type="text"
              autoFocus
              value={newLocName}
              onChange={(e) => setNewLocName(e.target.value)}
              onBlur={() => {
                if (!newLocName.trim()) setAddingLocation(false)
              }}
              placeholder="Location name"
              className="rounded-full border border-clay bg-transparent px-3 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </form>
        ) : (
          <div className="relative shrink-0 group">
            <button
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              aria-expanded={addMenuOpen}
              aria-label="Add to itinerary"
              className="rounded-full border border-dashed border-rule px-3 py-1 font-mono text-[13px] leading-none text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              +
            </button>
            <div
              className={`absolute right-0 z-20 mt-1 w-32 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm ${
                addMenuOpen ? "flex" : "hidden group-hover:flex"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setAddMenuOpen(false)
                  setAddDayOpen(true)
                }}
                className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-foreground hover:text-background"
              >
                + day
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddMenuOpen(false)
                  setAddingLocation(true)
                }}
                className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-foreground hover:text-background"
              >
                + location
              </button>
            </div>
          </div>
        )}
      </div>

      {effectiveActive !== null ? (
        <div className="flex items-center gap-3 px-5 pt-2 lg:px-10">
          {renaming ? (
            <form onSubmit={submitRename} className="inline-flex">
              <input
                type="text"
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={() => setRenaming(false)}
                className="border-0 border-b border-rule bg-transparent py-0.5 text-[13px] text-foreground focus:border-clay focus:outline-none"
              />
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  const name =
                    orderedTabs.find((t) => t.id === effectiveActive)?.name ?? ""
                  setRenameVal(name)
                  setRenaming(true)
                }}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                rename
              </button>
              <button
                type="button"
                onClick={removeActiveLocation}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-clay"
              >
                delete
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="px-5 pt-2.5 lg:px-10">
        <AddDayRow
          tripId={tripId}
          tripSlug={tripSlug}
          defaultDate={defaultDate}
          locationId={effectiveActive}
          open={addDayOpen}
          onClose={() => setAddDayOpen(false)}
        />
      </div>

      <div className="px-5 pt-4 lg:px-10">
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

      <div className="px-5 pt-4 pb-6 lg:px-10">
        {tabDays.length === 0 ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            No days planned yet — add the first one.
          </p>
        ) : (
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={tabDays.map((d) => d.id)}
              strategy={verticalListSortingStrategy}
            >
              {toSegments(tabDays).map((seg) => {
                const cards = seg.days.map((day) => (
                  <SortableDayCard
                    key={day.id}
                    id={day.id}
                    day={day}
                    tripSlug={tripSlug}
                    isLast={day.id === tabDays[tabDays.length - 1].id}
                    isEditing={editingId === day.id}
                    onStartEdit={() => setEditingId(day.id)}
                    onStopEdit={() => setEditingId(null)}
                    locations={locations}
                  />
                ))
                if (seg.groupId && seg.days.length > 1) {
                  return (
                    <div
                      key={seg.groupId}
                      className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1"
                    >
                      <span className="absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                        added together
                      </span>
                      {cards}
                    </div>
                  )
                }
                return (
                  <React.Fragment key={seg.days[0].id}>{cards}</React.Fragment>
                )
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  )
}

interface DayCardProps {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
  locations: ItineraryLocation[]
}

function DayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
  dragHandle,
  locations,
}: DayCardProps) {
  if (isEditing) {
    return (
      <DayEditor
        day={day}
        tripSlug={tripSlug}
        locations={locations}
        onDone={onStopEdit}
      />
    )
  }
  return (
    <DayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
    />
  )
}

function SortableDayCard({ id, ...rest }: DayCardProps & { id: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }

  const handle = (
    <button
      type="button"
      aria-label="Drag to reschedule day"
      className="cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[12px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <DayCard {...rest} dragHandle={handle} />
    </div>
  )
}

function DayView({
  day,
  tripSlug,
  isLast,
  onStartEdit,
  dragHandle,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  onStartEdit: () => void
  dragHandle?: React.ReactNode
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
          <div className="flex items-center gap-1.5">
            {dragHandle}
            <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
          </div>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {day.date}
          </span>
        </div>
        <div className="t-display mb-1 text-[22px] leading-tight text-foreground">
          {day.title}
        </div>
        {day.sub ? (
          <div className="text-[12.5px] leading-snug text-muted-foreground">
            {day.sub}
          </div>
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
  locations,
  onDone,
}: {
  day: ItineraryDay
  tripSlug: string
  locations: ItineraryLocation[]
  onDone: () => void
}) {
  const [dayDate, setDayDate] = React.useState(day.dayDate)
  const [tag, setTag] = React.useState(day.tag)
  const [title, setTitle] = React.useState(day.title)
  const [sub, setSub] = React.useState(day.sub)
  const [tone, setTone] = React.useState<ItineraryTone>(day.tone)
  const [locationId, setLocationId] = React.useState<string | null>(
    day.locationId,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await updateItineraryDay({
        dayId: day.id,
        tripSlug,
        dayDate,
        title,
        sub,
        tag,
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
      dayDate={dayDate}
      setDayDate={setDayDate}
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
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
  defaultDate,
  locationId,
  open,
  onClose,
}: {
  tripId: string
  tripSlug: string
  defaultDate: string
  locationId: string | null
  open: boolean
  onClose: () => void
}) {
  const [dayDate, setDayDate] = React.useState(defaultDate)
  const [endDate, setEndDate] = React.useState("")
  const [tag, setTag] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    onClose()
    setDayDate(defaultDate)
    setEndDate("")
    setTag("")
    setTitle("")
    setSub("")
    setTone("sea")
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addItineraryDay({
        tripId,
        tripSlug,
        dayDate,
        endDate,
        title,
        sub,
        tag,
        tone,
        locationId,
      })
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
      dayDate={dayDate}
      setDayDate={setDayDate}
      endDate={endDate}
      setEndDate={setEndDate}
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
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
  dayDate,
  setDayDate,
  endDate,
  setEndDate,
  tag,
  setTag,
  title,
  setTitle,
  sub,
  setSub,
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
  dayDate: string
  setDayDate: (s: string) => void
  /** When provided (Add mode), a second "To" date enables multi-day creation. */
  endDate?: string
  setEndDate?: (s: string) => void
  tag: string
  setTag: (s: string) => void
  title: string
  setTitle: (s: string) => void
  sub: string
  setSub: (s: string) => void
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
            {setEndDate ? "From" : "Date"}
          </span>
          <input
            type="date"
            value={dayDate}
            onChange={(e) => setDayDate(e.target.value)}
            disabled={isPending}
            required
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
        {setEndDate ? (
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              To
            </span>
            <input
              type="date"
              value={endDate ?? ""}
              min={dayDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isPending}
              className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        ) : (
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Tag
            </span>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={isPending}
              className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        )}
      </div>

      {setEndDate ? (
        <label className="mt-3 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Tag
          </span>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
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
          Sub
        </span>
        <input
          type="text"
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder="Optional"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

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
          <select
            value={locationId ?? ""}
            onChange={(e) =>
              setLocationId(e.target.value === "" ? null : e.target.value)
            }
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            <option value="">In transit (no location)</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
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
          disabled={isPending || !title.trim() || !tag.trim()}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : submitLabel}
        </button>
      </div>
    </form>
  )
}
