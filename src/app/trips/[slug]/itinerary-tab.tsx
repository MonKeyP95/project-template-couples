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
  deleteItineraryDay,
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

const itineraryBorder: Record<ItineraryTone, string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
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

export function ItineraryTab({
  tripId,
  tripSlug,
  tripStartDate,
  initialItems,
}: {
  tripId: string
  tripSlug: string
  tripStartDate: string
  initialItems: ItineraryDay[]
}) {
  const [days, setDays] = React.useState<ItineraryDay[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setDays(initialItems)
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

  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5 lg:px-10 lg:pt-6">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="px-5 pt-2.5 lg:px-10">
        <AddDayRow
          tripId={tripId}
          tripSlug={tripSlug}
          defaultDate={defaultDate}
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
        {days.length === 0 ? (
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
              items={days.map((d) => d.id)}
              strategy={verticalListSortingStrategy}
            >
              {toSegments(days).map((seg) => {
                const cards = seg.days.map((day) => (
                  <SortableDayCard
                    key={day.id}
                    id={day.id}
                    day={day}
                    tripSlug={tripSlug}
                    isLast={day.id === days[days.length - 1].id}
                    isEditing={editingId === day.id}
                    onStartEdit={() => setEditingId(day.id)}
                    onStopEdit={() => setEditingId(null)}
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
}

function DayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
  dragHandle,
}: DayCardProps) {
  if (isEditing) {
    return <DayEditor day={day} tripSlug={tripSlug} onDone={onStopEdit} />
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
  onDone,
}: {
  day: ItineraryDay
  tripSlug: string
  onDone: () => void
}) {
  const [dayDate, setDayDate] = React.useState(day.dayDate)
  const [tag, setTag] = React.useState(day.tag)
  const [title, setTitle] = React.useState(day.title)
  const [sub, setSub] = React.useState(day.sub)
  const [tone, setTone] = React.useState<ItineraryTone>(day.tone)
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
}: {
  tripId: string
  tripSlug: string
  defaultDate: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [dayDate, setDayDate] = React.useState(defaultDate)
  const [endDate, setEndDate] = React.useState("")
  const [tag, setTag] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    setExpanded(false)
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
      })
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add day
      </button>
    )
  }

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
