"use client"

import * as React from "react"

import { Label, MonoBadge, SuggestionCard } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addItineraryDay,
  createItineraryLocation,
  deleteItineraryDay,
  deleteItineraryGroup,
  deleteItineraryLocation,
  renameItineraryLocation,
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
  day_date: string
  title: string
  sub: string | null
  tag: string
  tone: string
  group_id: string | null
  group_name: string | null
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

const TRANSIT_KEY = "__transit__"

interface DayGroup {
  /** Location id, or TRANSIT_KEY for unfiled travel days. */
  key: string
  name: string
  /** null for the transit group. */
  tone: ItineraryTone | null
  /** 1-based location number, or null for transit. */
  ord: number | null
  days: ItineraryDay[]
}

function byDate(a: ItineraryDay, b: ItineraryDay): number {
  return a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0
}

/**
 * Split days into location groups (+ a trailing transit group for unfiled
 * days), ordered top-to-bottom by each group's earliest day. Empty locations
 * sort last. Location ordinals follow the location order (earliest day first).
 */
function buildGroups(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): DayGroup[] {
  const byLoc = new Map<string, ItineraryDay[]>()
  const travel: ItineraryDay[] = []
  for (const d of days) {
    if (d.locationId) {
      const arr = byLoc.get(d.locationId)
      if (arr) arr.push(d)
      else byLoc.set(d.locationId, [d])
    } else {
      travel.push(d)
    }
  }

  const groups: DayGroup[] = orderTabs(locations, days).map((loc, i) => ({
    key: loc.id,
    name: loc.name,
    tone: slugToTone(loc.id),
    ord: i + 1,
    days: (byLoc.get(loc.id) ?? []).slice().sort(byDate),
  }))

  if (travel.length) {
    groups.push({
      key: TRANSIT_KEY,
      name: "In transit",
      tone: null,
      ord: null,
      days: travel.slice().sort(byDate),
    })
  }

  // Chronological top-to-bottom; empty groups (no days) keep their order, last.
  return groups
    .map((g, idx) => ({ g, e: g.days[0]?.dayDate ?? null, idx }))
    .sort((a, b) => {
      if (a.e && b.e) return a.e < b.e ? -1 : a.e > b.e ? 1 : a.idx - b.idx
      if (a.e) return -1
      if (b.e) return 1
      return a.idx - b.idx
    })
    .map((x) => x.g)
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
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

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

  const groups = buildGroups(locations, days)

  const [addDayFor, setAddDayFor] = React.useState<string | null>(null)
  const [addingLocation, setAddingLocation] = React.useState(false)
  const [newLocName, setNewLocName] = React.useState("")
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameVal, setRenameVal] = React.useState("")
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
    startLoc(async () => {
      await renameItineraryLocation(locationId, tripSlug, name)
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

  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5 lg:px-10 lg:pt-6">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
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
        {groups.length === 0 ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            No days planned yet — add a location to start.
          </p>
        ) : (
          groups.map((group) => {
            const open = !collapsed.has(group.key)
            const isLoc = group.key !== TRANSIT_KEY
            const count = group.days.length
            const last = group.days[count - 1]
            const range =
              count === 0
                ? ""
                : count === 1
                  ? group.days[0].date
                  : `${group.days[0].date} – ${last.date}`
            return (
              <div
                key={group.key}
                className="border-t border-rule first:border-t-0"
              >
                <div className="flex items-center gap-3 py-3">
                  <span className="w-7 flex-shrink-0 font-mono text-[18px] leading-none text-muted-foreground">
                    {group.ord !== null
                      ? String(group.ord).padStart(2, "0")
                      : "··"}
                  </span>
                  <div className="min-w-0 flex-1">
                    {isLoc && renamingId === group.key ? (
                      <form onSubmit={(e) => submitRename(e, group.key)}>
                        <input
                          type="text"
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onBlur={() => setRenamingId(null)}
                          className="t-display w-full border-0 border-b border-rule bg-transparent text-[20px] leading-none text-foreground focus:border-clay focus:outline-none"
                        />
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
                        ? "no days"
                        : `${count} ${count === 1 ? "day" : "days"}${
                            range ? ` · ${range}` : ""
                          }`}
                    </div>
                  </div>
                  {isLoc ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Rename location"
                        onClick={() => {
                          setRenameVal(group.name)
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
                    {toSegments(group.days).map((seg) => {
                      const cards = seg.days.map((day) => (
                        <DayCard
                          key={day.id}
                          day={day}
                          tripSlug={tripSlug}
                          isLast={day.id === last.id}
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
                            <span
                              className={`absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                                seg.days[0].groupName
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {seg.days[0].groupName ?? "added together"}
                            </span>
                            <form
                              action={deleteItineraryGroup.bind(
                                null,
                                tripId,
                                tripSlug,
                                seg.groupId,
                              )}
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
                      return (
                        <React.Fragment key={seg.days[0].id}>
                          {cards}
                        </React.Fragment>
                      )
                    })}

                    <div className="pt-2">
                      <AddDayRow
                        tripId={tripId}
                        tripSlug={tripSlug}
                        defaultDate={defaultDate}
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
                  </div>
                ) : null}
              </div>
            )
          })
        )}

        <div className="pt-4">
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
        </div>
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
  const [groupName, setGroupName] = React.useState("")
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
    setGroupName("")
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
        groupName,
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
      groupName={groupName}
      setGroupName={setGroupName}
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
  groupName,
  setGroupName,
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
  /** When provided (Add mode), the block-name field for multi-day spans. */
  groupName?: string
  setGroupName?: (s: string) => void
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

      {setEndDate && setGroupName && endDate ? (
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
