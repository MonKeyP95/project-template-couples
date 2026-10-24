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
import { Label, MonoBadge } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addDreamItineraryDay,
  deleteDreamItineraryDay,
  rescheduleDreamItineraryDays,
  updateDreamItineraryDay,
} from "@/lib/trips/actions"
import {
  dreamSlots,
  rowToDreamDay,
  withDreamOrdinals,
  type DreamDay,
  type DreamSlot,
} from "@/lib/trips/dream-itinerary-types"
import { ITINERARY_TONES, type ItineraryTone } from "@/lib/trips/itinerary-types"
import { PlanItinerary } from "./plan-itinerary"

const itineraryBorder: Record<ItineraryTone, string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}

interface RealtimeRow {
  id: string
  trip_id: string
  day_index: number
  title: string
  sub: string | null
  tag: string
  tone: string
  created_by: string
  created_at: string
}

export function DreamItineraryTab({
  tripId,
  tripSlug,
  initialItems,
  dayCount,
  tripName,
  destination,
  avoid,
}: {
  tripId: string
  tripSlug: string
  initialItems: DreamDay[]
  /** Planned length; when set, days sit at real positions with empty slots. */
  dayCount: number | null
  tripName: string
  destination: string
  avoid: string
}) {
  const positional = dayCount !== null
  const [days, setDays] = React.useState<DreamDay[]>(() =>
    withDreamOrdinals(initialItems, positional),
  )
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setDays(withDreamOrdinals(initialItems, positional))
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`dream-itinerary-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dream_itinerary_days",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = rowToDreamDay(payload.new as RealtimeRow)
            setDays((prev) =>
              prev.some((d) => d.id === incoming.id)
                ? prev
                : withDreamOrdinals([...prev, incoming], positional),
            )
          } else if (payload.eventType === "UPDATE") {
            const incoming = rowToDreamDay(payload.new as RealtimeRow)
            setDays((prev) =>
              withDreamOrdinals(
                prev.map((d) => (d.id === incoming.id ? incoming : d)),
                positional,
              ),
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setDays((prev) =>
                withDreamOrdinals(prev.filter((d) => d.id !== old.id), positional),
              )
            }
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId, positional])

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
    // The trip's existing day_index values, sorted, are the fixed slots; the
    // card at position i takes slot[i]. withDreamOrdinals re-pads display d.
    const slots = days.map((d) => d.dayIndex).sort((a, b) => a - b)
    const reassigned = withDreamOrdinals(
      reordered.map((d, i) => ({ ...d, dayIndex: slots[i] })),
      positional,
    )
    setDays(reassigned)

    startReschedule(async () => {
      const result = await rescheduleDreamItineraryDays(
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
          dream plan
        </span>
      </div>

      <div className="px-5 pt-2.5 lg:px-10">
        {days.length === 0 && !positional ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            No days dreamed up yet — add the first one.
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
              {slotsFor(days, dayCount).map((slot, i, all) =>
                slot.kind === "empty" ? (
                  <div key={`empty-${slot.dayIndex}`} className="py-1.5">
                    <AddDreamDayRow
                      tripId={tripId}
                      tripSlug={tripSlug}
                      dayIndex={slot.dayIndex}
                    />
                  </div>
                ) : (
                  <SortableDreamDayCard
                    key={slot.day.id}
                    id={slot.day.id}
                    day={slot.day}
                    tripSlug={tripSlug}
                    isLast={i === all.length - 1}
                    isEditing={editingId === slot.day.id}
                    onStartEdit={() => setEditingId(slot.day.id)}
                    onStopEdit={() => setEditingId(null)}
                  />
                ),
              )}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="px-5 pt-4 pb-6 lg:px-10">
        <AddDreamDayRow tripId={tripId} tripSlug={tripSlug} />
      </div>
      <PlanItinerary
        tripId={tripId}
        tripSlug={tripSlug}
        tripName={tripName}
        destination={destination}
        avoid={avoid}
        locations={[]}
        days={[]}
        dream={{ dayCount, cards: days }}
      />
    </section>
  )
}

/** Without a day count, just the days in order; with one, every position. */
function slotsFor(days: DreamDay[], dayCount: number | null): DreamSlot[] {
  return dayCount === null
    ? days.map((day) => ({ kind: "day", day }))
    : dreamSlots(days, dayCount)
}

interface DreamDayCardProps {
  day: DreamDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
}

function DreamDayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
  dragHandle,
}: DreamDayCardProps) {
  if (isEditing) {
    return <DreamDayEditor day={day} tripSlug={tripSlug} onDone={onStopEdit} />
  }
  return (
    <DreamDayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
    />
  )
}

function SortableDreamDayCard({
  id,
  ...rest
}: DreamDayCardProps & { id: string }) {
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
      aria-label="Drag to reorder day"
      className="cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[12px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <DreamDayCard {...rest} dragHandle={handle} />
    </div>
  )
}

function DreamDayView({
  day,
  tripSlug,
  isLast,
  onStartEdit,
  dragHandle,
}: {
  day: DreamDay
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
        {!isLast ? (
          <div className="absolute -bottom-3.5 left-[11px] top-9 w-px bg-border" />
        ) : null}
      </div>
      <div
        className={`flex-1 rounded-lg border border-border bg-card px-3.5 py-3 border-l-[3px] ${itineraryBorder[day.tone]}`}
      >
        <div className="mb-1.5 flex items-center gap-1.5">
          {dragHandle}
          <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
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
            action={deleteDreamItineraryDay.bind(null, day.id, tripSlug)}
            onSubmit={(e) => {
              if (!window.confirm("Delete this day? This can't be undone.")) {
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

function DreamDayEditor({
  day,
  tripSlug,
  onDone,
}: {
  day: DreamDay
  tripSlug: string
  onDone: () => void
}) {
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
      const result = await updateDreamItineraryDay({
        dayId: day.id,
        tripSlug,
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
    <DreamDayForm
      heading="Edit day"
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

function AddDreamDayRow({
  tripId,
  tripSlug,
  dayIndex,
}: {
  tripId: string
  tripSlug: string
  /** Set for an empty slot: fills that position with one day. */
  dayIndex?: number
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [tag, setTag] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [count, setCount] = React.useState("1")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    setExpanded(false)
    setTag("")
    setTitle("")
    setSub("")
    setTone("sea")
    setCount("1")
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addDreamItineraryDay({
        tripId,
        tripSlug,
        title,
        sub,
        tag,
        tone,
        count: Number(count),
        dayIndex,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
  }

  if (!expanded && dayIndex) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex min-h-12 w-full items-center justify-between rounded-[10px] border border-dashed border-rule bg-transparent px-3.5 text-[15px] text-foreground hover:border-foreground"
      >
        <span>Day {dayIndex}</span>
        <span className="text-[13px] text-sea">+ add</span>
      </button>
    )
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
    <DreamDayForm
      heading={dayIndex ? `Day ${dayIndex}` : "Add day"}
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      tone={tone}
      setTone={setTone}
      count={dayIndex ? undefined : count}
      setCount={dayIndex ? undefined : setCount}
      error={error}
      isPending={isPending}
      submitLabel="add"
      onSubmit={submit}
      onCancel={reset}
    />
  )
}

function DreamDayForm({
  heading,
  tag,
  setTag,
  title,
  setTitle,
  sub,
  setSub,
  tone,
  setTone,
  count,
  setCount,
  error,
  isPending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string
  tag: string
  setTag: (s: string) => void
  title: string
  setTitle: (s: string) => void
  sub: string
  setSub: (s: string) => void
  tone: ItineraryTone
  setTone: (t: ItineraryTone) => void
  /** When provided (Add mode), a "days" count enables multi-day creation. */
  count?: string
  setCount?: (s: string) => void
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

      {setCount ? (
        <label className="mt-4 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Days
          </span>
          <input
            type="number"
            min={1}
            max={31}
            value={count ?? "1"}
            onChange={(e) => setCount(e.target.value)}
            disabled={isPending}
            className="t-num mt-1 w-20 border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
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
