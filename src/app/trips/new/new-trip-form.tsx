"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createTrip } from "@/lib/trips/actions"
import { searchPinCandidates } from "@/lib/places/pin-actions"
import type { PlaceMatch } from "@/lib/weather/geocode"
import { currencySymbol } from "@/lib/money"
import {
  prefillPrefs,
  readNote,
  type PrefKey,
} from "@/lib/trips/trip-note-parse"
import type { BudgetPeriod } from "@/lib/trips/budget-period"
import { NotePage } from "./note-page"
import { PrefsPage } from "./prefs-page"

export interface TripDraft {
  note: string
  /** Length read from the note; fills To, and is a dream's planned length. */
  days: number
  start: string
  end: string
  budget: string
  budgetPeriod: BudgetPeriod
  place: string
  unsure: boolean
  what: string
  prefs: Record<PrefKey, string>
  /** What you pay in there; starts as the home currency. */
  currency: string
}

export type DraftField = "start" | "end" | "budget" | "place" | PrefKey

const EMPTY_DRAFT: Omit<TripDraft, "currency"> = {
  note: "",
  days: 0,
  start: "",
  end: "",
  budget: "",
  budgetPeriod: "trip",
  place: "",
  unsure: false,
  what: "",
  prefs: { stay: "", move: "", acts: "", food: "", avoid: "" },
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** To follows From + the note's length until the user picks To themselves. */
function autoEnd(d: TripDraft, endTouched: boolean): string {
  if (endTouched || !d.start || d.days < 1) return d.end
  return addDays(d.start, d.days - 1)
}

/** The note-first new trip flow: basic profile, then optional preferences. */
export function NewTripForm({ currency }: { currency: string }) {
  const router = useRouter()
  const symbol = currencySymbol(currency)
  const [draft, setDraft] = React.useState<TripDraft>({
    ...EMPTY_DRAFT,
    currency,
  })
  const [touched, setTouched] = React.useState<Set<DraftField>>(new Set())
  const [page, setPage] = React.useState<"note" | "prefs">("note")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [found, setFound] = React.useState<{ query: string; matches: PlaceMatch[] } | null>(
    null,
  )
  const [pin, setPin] = React.useState<PlaceMatch | null>(null)
  const [isSearching, startSearch] = React.useTransition()

  const where = draft.unsure ? "" : draft.place.trim()
  const pinMatches = where && found?.query === where ? found.matches : null

  /** The first Continue looks "Where" up and stays to show the matches; the
   * next one moves on. A changed "Where" is looked up again. */
  function continueFromNote() {
    if (!where || found?.query === where) {
      setPage("prefs")
      return
    }
    startSearch(async () => {
      const matches = await searchPinCandidates(where, null)
      setFound({ query: where, matches })
      setPin(matches.length === 1 ? matches[0] : null)
    })
  }

  function changeNote(note: string) {
    const r = readNote(note, currency, symbol)
    const guessed = prefillPrefs(note)
    const keep = (f: DraftField) => touched.has(f)
    setDraft((d) => {
      const next = { ...d, days: r.days }
      return {
        ...next,
        end: autoEnd(next, keep("end")),
        note,
        what: r.what,
        budget: keep("budget") ? d.budget : r.budget ? String(r.budget) : "",
        place: keep("place") ? d.place : r.place,
        unsure: r.place ? false : d.unsure,
        prefs: Object.fromEntries(
          Object.entries(guessed).map(([k, v]) => [
            k,
            keep(k as PrefKey) ? d.prefs[k as PrefKey] : v,
          ]),
        ) as Record<PrefKey, string>,
      }
    })
  }

  function edit(field: DraftField, value: string) {
    if (field !== "start") setTouched((t) => new Set(t).add(field))
    setDraft((d) => {
      if (field === "start") {
        const next = { ...d, start: value }
        return { ...next, end: autoEnd(next, touched.has("end")) }
      }
      return field === "end" || field === "budget" || field === "place"
        ? { ...d, [field]: value }
        : { ...d, prefs: { ...d.prefs, [field]: value } }
    })
  }

  function create(withPrefs: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await createTrip({
        note: draft.note,
        startDate: draft.start || null,
        endDate: draft.end || null,
        days: draft.days || null,
        budget: Number(draft.budget) || 0,
        budgetPeriod: draft.budgetPeriod,
        place: draft.unsure ? null : draft.place,
        pin: pinMatches ? pin : null,
        what: draft.what,
        prefs: withPrefs ? draft.prefs : null,
        currency: draft.currency,
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
        pinMatches={pinMatches}
        pin={pin}
        searching={isSearching}
        onPin={setPin}
        onNote={changeNote}
        onEdit={edit}
        onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onContinue={continueFromNote}
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
