"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createTrip } from "@/lib/trips/actions"
import { currencySymbol } from "@/lib/money"
import {
  prefillPrefs,
  readNote,
  type PrefKey,
} from "@/lib/trips/trip-note-parse"
import { NotePage } from "./note-page"
import { PrefsPage } from "./prefs-page"

export interface TripDraft {
  note: string
  days: string
  start: string
  showDates: boolean
  budget: string
  place: string
  unsure: boolean
  what: string
  prefs: Record<PrefKey, string>
}

export type DraftField = "days" | "budget" | "place" | PrefKey

const EMPTY_DRAFT: TripDraft = {
  note: "",
  days: "",
  start: "",
  showDates: false,
  budget: "",
  place: "",
  unsure: false,
  what: "",
  prefs: { stay: "", move: "", acts: "", food: "", avoid: "" },
}

/** The note-first new trip flow: basic profile, then optional preferences. */
export function NewTripForm({ currency }: { currency: string }) {
  const router = useRouter()
  const symbol = currencySymbol(currency)
  const [draft, setDraft] = React.useState<TripDraft>(EMPTY_DRAFT)
  const [touched, setTouched] = React.useState<Set<DraftField>>(new Set())
  const [page, setPage] = React.useState<"note" | "prefs">("note")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function changeNote(note: string) {
    const r = readNote(note, currency, symbol)
    const guessed = prefillPrefs(note)
    const keep = (f: DraftField) => touched.has(f)
    setDraft((d) => ({
      ...d,
      note,
      what: r.what,
      days: keep("days") ? d.days : r.days ? String(r.days) : "",
      budget: keep("budget") ? d.budget : r.budget ? String(r.budget) : "",
      place: keep("place") ? d.place : r.place,
      unsure: r.place ? false : d.unsure,
      prefs: Object.fromEntries(
        Object.entries(guessed).map(([k, v]) => [
          k,
          keep(k as PrefKey) ? d.prefs[k as PrefKey] : v,
        ]),
      ) as Record<PrefKey, string>,
    }))
  }

  function edit(field: DraftField, value: string) {
    setTouched((t) => new Set(t).add(field))
    setDraft((d) =>
      field === "days" || field === "budget" || field === "place"
        ? { ...d, [field]: value }
        : { ...d, prefs: { ...d.prefs, [field]: value } },
    )
  }

  function create(withPrefs: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await createTrip({
        note: draft.note,
        days: Number(draft.days),
        startDate: draft.showDates && draft.start ? draft.start : null,
        budget: Number(draft.budget) || 0,
        place: draft.unsure ? null : draft.place,
        what: draft.what,
        prefs: withPrefs ? draft.prefs : null,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push(`/trips/${result.slug}`)
    })
  }

  if (page === "note") {
    return (
      <NotePage
        draft={draft}
        symbol={symbol}
        noteHasPlace={readNote(draft.note, currency, symbol).place !== ""}
        onNote={changeNote}
        onEdit={edit}
        onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onContinue={() => setPage("prefs")}
      />
    )
  }
  return (
    <PrefsPage
      draft={draft}
      isPending={isPending}
      error={error}
      onEdit={edit}
      onBack={() => setPage("note")}
      onCreate={create}
    />
  )
}
