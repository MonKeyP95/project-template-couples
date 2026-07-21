"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createTrip } from "@/lib/trips/actions"
import { slugify } from "@/lib/trips/slugify"
import {
  LocalCategoryEditor,
  OptionRow,
  type LocalCategory,
} from "../profile-fields"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
import { TRIP_TRANSPORT, TRIP_VIBES } from "@/lib/trips/trip-profile-types"

const SLUG_RE = /^[a-z0-9-]+$/

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function NewTripForm() {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [isDream, setIsDream] = React.useState(false)
  const [startDate, setStartDate] = React.useState("")
  const [endDate, setEndDate] = React.useState("")
  const [fuzzyWhen, setFuzzyWhen] = React.useState("")
  const [country, setCountry] = React.useState("")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [lat, setLat] = React.useState("")
  const [lng, setLng] = React.useState("")
  const [idea, setIdea] = React.useState("")
  const [categories, setCategories] = React.useState<LocalCategory[]>(
    EXPENSE_CATEGORIES.map((name) => ({ name, details: [] })),
  )
  const [transport, setTransport] = React.useState<string[]>([])
  const [vibe, setVibe] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const nameRef = React.useRef<HTMLInputElement>(null)

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])

  React.useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const derivedSlug = React.useMemo(() => slugify(name), [name])
  const displayedSlug = slugDirty ? slug : derivedSlug

  const canSubmit =
    name.trim().length > 0 &&
    SLUG_RE.test(displayedSlug) &&
    !isPending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await createTrip({
        name,
        slug: displayedSlug,
        isDream,
        startDate: isDream ? null : startDate || null,
        endDate: isDream ? null : endDate || null,
        fuzzyWhen: isDream ? fuzzyWhen.trim() || null : null,
        country: country.trim() || null,
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
        profile: { idea, transport, vibe },
        categories,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push(`/trips/${result.slug}?tab=itinerary`)
    })
  }

  return (
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
          ref={nameRef}
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
          value={displayedSlug}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugDirty(true)
          }}
          placeholder="iceland-ring-road"
          disabled={isPending}
          className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
          URL: /trips/{displayedSlug || "—"}
        </span>
      </label>

      {isDream ? (
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

      <div className="mt-8 border-t border-rule pt-6">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Profile · optional
        </span>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Sum up this trip
          </span>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. 2 weeks surfing in Portugal"
            rows={3}
            disabled={isPending}
            className="mt-1 w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <div className="mt-5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Categories
          </span>
          <div className="mt-2">
            <LocalCategoryEditor
              categories={categories}
              onChange={setCategories}
              disabled={isPending}
            />
          </div>
        </div>

        <div className="mt-5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Getting around
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {TRIP_TRANSPORT.map((t) => (
              <OptionRow
                key={t}
                label={t}
                selected={transport.includes(t)}
                onClick={() => toggle(transport, setTransport, t)}
              />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Vibe
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {TRIP_VIBES.map((v) => (
              <OptionRow
                key={v}
                label={v}
                selected={vibe.includes(v)}
                onClick={() => toggle(vibe, setVibe, v)}
              />
            ))}
          </div>
        </div>
      </div>

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

      {error ? (
        <div className="mt-5 font-mono text-[10px] text-clay">{error}</div>
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
          {isPending ? "…" : isDream ? "save dream" : "create trip"}
        </button>
      </div>
    </form>
  )
}
