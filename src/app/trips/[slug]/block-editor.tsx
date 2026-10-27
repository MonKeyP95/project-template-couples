"use client"

import * as React from "react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { editItineraryBlock } from "@/lib/trips/actions"
import { blockTemplate, type BlockEventEdit } from "@/lib/trips/itinerary-blocks"
import type { ItineraryDay, ItineraryEvent } from "@/lib/trips/itinerary-types"
import {
  EventDraftList,
  draftToEvent,
  newEventDraft,
  toEventDrafts,
  type EventDraft,
} from "./event-draft-rows"

const labelClass =
  "block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
const inputClass =
  "mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"

/** Edits a block's shared headline and events across all its days. */
export function BlockEditor({
  tripId,
  tripSlug,
  days,
  groupId,
  floor,
  onClose,
}: {
  tripId: string
  tripSlug: string
  days: ItineraryDay[]
  groupId: string | null
  floor: string | null
  onClose: () => void
}) {
  const [template] = React.useState(() => blockTemplate(days))
  const [initial] = React.useState(() => toEventDrafts(template.events))
  const [name, setName] = React.useState(days[0]?.groupName ?? "")
  const [title, setTitle] = React.useState(template.title)
  const [events, setEvents] = React.useState<EventDraft[]>(initial)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const pastCount = floor ? days.filter((d) => d.dayDate < floor).length : 0

  function eventEdits(): BlockEventEdit[] {
    const origin = new Map<string, ItineraryEvent>(
      initial.map((d, i) => [d.key, template.events[i]]),
    )
    const kept = new Set(events.map((d) => d.key))
    return [
      ...events.map((d) => ({ old: origin.get(d.key) ?? null, next: draftToEvent(d) })),
      ...initial
        .filter((d) => !kept.has(d.key))
        .map((d) => ({ old: origin.get(d.key) ?? null, next: null })),
    ]
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await editItineraryBlock({
        tripId,
        tripSlug,
        dayIds: days.map((d) => d.id),
        groupId,
        groupName: name,
        oldTitle: template.title,
        newTitle: title,
        events: eventEdits(),
        floor,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Editing {days.length} days{days[0]?.groupName ? ` - ${days[0].groupName}` : ""}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={save}>
          <label className="block">
            <span className={labelClass}>Block name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional, e.g. Surf school"
              disabled={isPending}
              className={inputClass}
            />
          </label>
          <label className="mt-3 block">
            <span className={labelClass}>Headline</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
              className={`${inputClass} text-[16px]`}
            />
          </label>
          <div className="mt-3">
            <span className={labelClass}>Plan for every day</span>
            <div className="mt-1.5 space-y-2">
              <EventDraftList events={events} setEvents={setEvents} isPending={isPending} />
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-snug text-muted-foreground">
            Changes skip anything edited on a single day.
            {pastCount > 0
              ? ` ${pastCount} past ${pastCount === 1 ? "day stays" : "days stay"} as they are.`
              : ""}
          </p>
          {error ? <div className="mt-3 font-mono text-[10px] text-clay">{error}</div> : null}
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
                onClick={onClose}
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
                {isPending ? "…" : "save"}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
