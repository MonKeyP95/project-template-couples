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
import {
  fitRoute,
  routeLine,
  routeNights,
  type IdeaPlan,
  type RouteStop,
} from "@/lib/trips/idea-route"
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

export type DraftField = "start" | "end" | "budget" | "place" | "days" | "what" | PrefKey

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

/** The draft after the note changes: length, budget, place and preferences are
 * read from it, except fields the user already set by hand. */
function withNote(
  d: TripDraft,
  note: string,
  touched: Set<DraftField>,
  currency: string,
  symbol: string,
): TripDraft {
  const r = readNote(note, currency, symbol)
  const guessed = prefillPrefs(note)
  const keep = (f: DraftField) => touched.has(f)
  const next = { ...d, days: keep("days") ? d.days : r.days }
  return {
    ...next,
    end: autoEnd(next, keep("end")),
    note,
    what: keep("what") ? d.what : r.what,
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
}

/** The opening draft: the note read as usual, then an accepted idea's plan on
 * top. Plan-filled fields count as set by hand, so typing in the note never
 * overwrites them. */
function initialState(
  currency: string,
  symbol: string,
  note: string,
  plan: IdeaPlan | null,
): { draft: TripDraft; touched: Set<DraftField>; noteDays: number } {
  const draft = withNote({ ...EMPTY_DRAFT, currency }, note, new Set(), currency, symbol)
  if (!plan) return { draft, touched: new Set(), noteDays: draft.days }
  const days = routeNights(plan.stops) || plan.days
  const filled: DraftField[] = []
  if (plan.place) filled.push("place")
  if (plan.what) filled.push("what")
  if (days > 0) filled.push("days")
  const prefs = { ...draft.prefs }
  for (const [k, v] of Object.entries(plan.prefs)) {
    if (!v) continue
    prefs[k as PrefKey] = v
    filled.push(k as PrefKey)
  }
  return {
    draft: {
      ...draft,
      place: plan.place || draft.place,
      unsure: plan.place ? false : draft.unsure,
      what: plan.what || draft.what,
      days: days || draft.days,
      prefs,
    },
    touched: new Set(filled),
    noteDays: draft.days,
  }
}

/** Inclusive day count between two yyyy-mm-dd dates. */
function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
}

/** The note-first new trip flow: basic profile, then optional preferences.
 * `initialNote` is what was typed in the home page's New adventure box. */
export function NewTripForm({
  currency,
  initialNote,
  initialPlan,
  ideaId,
}: {
  currency: string
  initialNote: string
  /** An accepted home idea's answers and route; null otherwise. */
  initialPlan: IdeaPlan | null
  /** The accepted home idea's row, marked when the trip is created. */
  ideaId: string | null
}) {
  const router = useRouter()
  const symbol = currencySymbol(currency)
  const [initial] = React.useState(() =>
    initialState(currency, symbol, initialNote, initialPlan),
  )
  const [draft, setDraft] = React.useState<TripDraft>(initial.draft)
  const [touched, setTouched] = React.useState<Set<DraftField>>(initial.touched)
  const [route, setRoute] = React.useState<RouteStop[] | null>(
    initialPlan?.stops.length ? initialPlan.stops : null,
  )
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
  const length = draft.start && draft.end ? daysBetween(draft.start, draft.end) : draft.days
  const fitted = route ? fitRoute(route, length) : []

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

  /** A plan-filled length holds until the note names a different one; a
   * dream has no other place to change it. */
  function changeNote(note: string) {
    let t = touched
    if (t.has("days") && readNote(note, currency, symbol).days !== initial.noteDays) {
      t = new Set(t)
      t.delete("days")
      setTouched(t)
    }
    setDraft((d) => withNote(d, note, t, currency, symbol))
  }

  function edit(field: DraftField, value: string) {
    if (field !== "start") setTouched((t) => new Set(t).add(field))
    // The route belonged to the old destination.
    if (field === "place") setRoute(null)
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
        route: fitted.length ? fitted : null,
        ideaId,
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
        onDraft={(patch) => {
          if ("place" in patch) setRoute(null)
          setDraft((d) => ({ ...d, ...patch }))
        }}
        onContinue={continueFromNote}
        route={fitted.length ? routeLine(fitted) : null}
        onDropRoute={() => setRoute(null)}
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
