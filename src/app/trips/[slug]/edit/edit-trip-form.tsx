"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { deleteTrip, updateTrip } from "@/lib/trips/actions"
import { currencyOptions } from "@/lib/fx/currency-list"
import { type LocalCategory } from "../../profile-fields"
import { ProfileWalkthrough } from "../../profile-walkthrough"
import { type TripProfile } from "@/lib/trips/trip-profile-types"
import { PREF_TOPICS } from "@/lib/trips/trip-note-parse"

const SLUG_RE = /^[a-z0-9-]+$/

const PREVIEW_FMT = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function fmtPreview(yyyyMmDd: string): string {
  return PREVIEW_FMT.format(new Date(`${yyyyMmDd}T00:00:00Z`))
}

function derivedEnd(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days - 1)
  return d.toISOString().slice(0, 10)
}

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export interface EditTripInitial {
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  dayCount: number | null
  country: string | null
  lat: number | null
  lng: number | null
  currency: string
  /** Where the money comes from; what every total is reported in. */
  homeCurrency: string
}

export function EditTripForm({
  tripId,
  dreamDayCount,
  promoteDays,
  initial,
  initialProfile,
  initialCategories,
}: {
  tripId: string
  dreamDayCount: number
  /** The dated trip's length after promotion. */
  promoteDays: number
  initial: EditTripInitial
  initialProfile: TripProfile
  initialCategories: LocalCategory[]
}) {
  const router = useRouter()
  const [name, setName] = React.useState(initial.name)
  const [slug, setSlug] = React.useState(initial.slug)
  const [isDream, setIsDream] = React.useState(initial.isDream)
  const [startDate, setStartDate] = React.useState(initial.startDate ?? "")
  const [endDate, setEndDate] = React.useState(initial.endDate ?? "")
  const [fuzzyWhen, setFuzzyWhen] = React.useState(initial.fuzzyWhen ?? "")
  const [country, setCountry] = React.useState(initial.country ?? "")
  const [currency, setCurrency] = React.useState(initial.currency)
  const [homeCurrency, setHomeCurrency] = React.useState(initial.homeCurrency)
  const [advancedOpen, setAdvancedOpen] = React.useState(
    initial.lat !== null || initial.lng !== null,
  )
  const [lat, setLat] = React.useState(
    initial.lat === null ? "" : String(initial.lat),
  )
  const [lng, setLng] = React.useState(
    initial.lng === null ? "" : String(initial.lng),
  )
  const [idea, setIdea] = React.useState(initialProfile.idea)
  const [vibe, setVibe] = React.useState<string[]>(initialProfile.vibe)
  const [vibeNote, setVibeNote] = React.useState(initialProfile.vibeNote)
  const [avoid, setAvoid] = React.useState(initialProfile.avoid)
  const [transport, setTransport] = React.useState<string[]>(
    initialProfile.transport,
  )
  const [categories, setCategories] =
    React.useState<LocalCategory[]>(initialCategories)
  const [prefs, setPrefs] = React.useState({
    stay: initialProfile.stay,
    move: initialProfile.move,
    acts: initialProfile.acts,
    food: initialProfile.food,
  })
  const [days, setDays] = React.useState(
    initial.dayCount === null ? "" : String(initial.dayCount),
  )

  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit =
    name.trim().length > 0 && SLUG_RE.test(slug.trim()) && !isPending

  const promotingDreamWithDays =
    initial.isDream && !isDream && dreamDayCount > 0

  // The "days fall outside" question, tied to the dates it was asked about so
  // it disappears as soon as they change.
  const datesKey = `${isDream}|${startDate}|${endDate}|${days}`
  const [outsideAsk, setOutsideAsk] = React.useState<{ count: number; key: string } | null>(null)
  const askOutside = outsideAsk?.key === datesKey ? outsideAsk.count : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    save()
  }

  function save(outside?: "delete" | "unplace") {
    if (!canSubmit) return
    setError(null)
    setOutsideAsk(null)
    startTransition(async () => {
      const result = await updateTrip({
        tripId,
        currentSlug: initial.slug,
        name,
        slug: slug.trim(),
        isDream,
        wasDream: initial.isDream,
        startDate: isDream ? null : startDate || null,
        endDate: isDream ? null : endDate || null,
        fuzzyWhen: isDream ? fuzzyWhen.trim() || null : null,
        country: country.trim() || null,
        currency,
        homeCurrency,
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
        dayCount: isDream ? Number(days) || null : null,
        profile: {
          ...initialProfile,
          ...prefs,
          idea,
          transport,
          vibe,
          vibeNote,
          avoid,
        },
        categories,
        outside,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.outsidePlanned) {
        setOutsideAsk({ count: result.outsidePlanned, key: datesKey })
        return
      }
      router.push(`/trips/${result.slug}`)
    })
  }

  return (
    <>
      <form onSubmit={submit} className="mt-6">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={isDream}
            onChange={(e) => setIsDream(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4 accent-foreground disabled:opacity-50"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            This is a dream (no dates yet)
          </span>
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Where to?"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Slug
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="iceland-ring-road"
            disabled={isPending}
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            URL: /trips/{slug || "—"}
          </span>
        </label>

        {isDream ? (
          <>
            <label className="mt-5 block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                How long (days)
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
                placeholder="10"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="mt-5 block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                When?
              </span>
              <input
                type="text"
                value={fuzzyWhen}
                onChange={(e) => setFuzzyWhen(e.target.value)}
                placeholder="summer 2030, someday, ..."
                maxLength={64}
                disabled={isPending}
                className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </>
        ) : promotingDreamWithDays ? (
          <div className="mt-5">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Start
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            {startDate ? (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {promoteDays} planned days → {fmtPreview(startDate)}–
                {fmtPreview(derivedEnd(startDate, promoteDays))}
                <br />
                (end date set by your itinerary)
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Start
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                End
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        )}

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Country
          </span>
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Optional"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            You spend here in
          </span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={isPending}
            className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm disabled:opacity-50"
          >
            {currencyOptions().map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            Pre-fills the expense form. Totals stay in {homeCurrency}, where your
            bank account is; every expense converts into it.
          </span>
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Totals are in
          </span>
          <select
            value={homeCurrency}
            onChange={(e) => setHomeCurrency(e.target.value)}
            disabled={isPending}
            className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm disabled:opacity-50"
          >
            {currencyOptions().map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            Where your bank account is. Changing it relabels this trip&apos;s
            figures, never converts them — so it is refused once an expense has
            actually been converted into {initial.homeCurrency}.
          </span>
        </label>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          disabled={isPending}
          className="mt-5 inline-flex items-center gap-1 border-0 bg-transparent font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          aria-expanded={advancedOpen}
        >
          <span>{advancedOpen ? "▾" : "›"}</span>
          <span>advanced (lat / lng)</span>
        </button>

        {advancedOpen ? (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Latitude
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-8.6500"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Longitude
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="116.3200"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        ) : null}

        <div className="mt-8 border-t border-rule pt-6">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Preferences
          </span>
          {PREF_TOPICS.filter(
            (t): t is typeof t & { key: keyof typeof prefs } => t.key !== "avoid",
          ).map((t) => (
            <label key={t.key} className="mt-4 block">
              <span className="block text-[14px] text-foreground">{t.title}</span>
              <textarea
                value={prefs[t.key]}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, [t.key]: e.target.value }))
                }
                rows={2}
                placeholder={t.hint}
                disabled={isPending}
                className="mt-1.5 block w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-[14px] leading-snug text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          ))}
        </div>

        <div className="mt-8 border-t border-rule pt-6">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Profile
          </span>
          <div className="mt-4">
            <ProfileWalkthrough
              value={{ idea, vibe, vibeNote, transport, categories, avoid }}
              onChange={(patch) => {
                if (patch.idea !== undefined) setIdea(patch.idea)
                if (patch.vibe !== undefined) setVibe(patch.vibe)
                if (patch.vibeNote !== undefined) setVibeNote(patch.vibeNote)
                if (patch.transport !== undefined) setTransport(patch.transport)
                if (patch.categories !== undefined)
                  setCategories(patch.categories)
                if (patch.avoid !== undefined) setAvoid(patch.avoid)
              }}
              disabled={isPending}
              footerAside={
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-full border border-rule px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {isPending ? "…" : "save"}
                </button>
              }
            />
          </div>
        </div>

        {error ? (
          <div className="mt-5 font-mono text-[10px] text-clay">{error}</div>
        ) : null}

        {askOutside !== null ? (
          <div className="mt-5 rounded-lg border border-clay/40 px-3.5 py-3">
            <p className="text-[13px] text-foreground">
              {askOutside === 1
                ? "1 planned day falls outside the new dates."
                : `${askOutside} planned days fall outside the new dates.`}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => save("unplace")}
                disabled={isPending}
                className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
              >
                keep as unplaced
              </button>
              <button
                type="button"
                onClick={() => save("delete")}
                disabled={isPending}
                className="rounded-full border border-rule px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-clay disabled:opacity-40"
              >
                delete them
              </button>
              <button
                type="button"
                onClick={() => setOutsideAsk(null)}
                disabled={isPending}
                className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
              >
                cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-7 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={isPending}
            className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "save changes"}
          </button>
        </div>
      </form>

      <hr className="mt-10 border-rule" />
      <form
        action={deleteTrip.bind(null, tripId, initial.slug)}
        onSubmit={(e) => {
          if (
            !window.confirm(
              "Delete this trip? Packing list, expenses, and itinerary will be removed.",
            )
          ) {
            e.preventDefault()
          }
        }}
        className="mt-4 flex items-center justify-between"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          / danger
        </span>
        <button
          type="submit"
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-clay hover:text-foreground disabled:opacity-40"
        >
          {"// delete trip"}
        </button>
      </form>
    </>
  )
}
