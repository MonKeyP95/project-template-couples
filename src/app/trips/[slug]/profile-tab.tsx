"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { NotesTab } from "./notes-tab"
import {
  addExpenseCategory,
  deleteExpenseCategory,
  saveTripProfile,
} from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import {
  TRIP_VIBES,
  TRIP_WHO,
  type TripProfile,
} from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: headline + About + the trip's shared categories +
 * vibe/who chips, above the existing notes feature (reused unchanged).
 * Categories are the same expense_categories edited in Budget — this is just a
 * second access point. Manual — no AI. */
export function ProfileTab({
  profile,
  expenseCategories,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & {
  profile: TripProfile
  expenseCategories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const { tripId, tripSlug } = notesProps
  const [headline, setHeadline] = React.useState(profile.headline)
  const [brief, setBrief] = React.useState(profile.brief)
  const [vibe, setVibe] = React.useState<string[]>(profile.vibe)
  const [who, setWho] = React.useState(profile.who)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  function toggle(list: string[], setList: (v: string[]) => void, tag: string) {
    setSaved(false)
    setList(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])
  }

  function save() {
    setSaving(true)
    saveTripProfile({
      tripId,
      tripSlug,
      profile: { headline, vibe, who, brief },
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <>
      <section className="px-5 pt-5 lg:px-10 lg:pt-6">
        <input
          type="text"
          value={headline}
          onChange={(e) => {
            setHeadline(e.target.value)
            setSaved(false)
          }}
          placeholder="Trip headline — e.g. Surfing trip · 2 weeks"
          className="t-display w-full border-0 bg-transparent text-[22px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        <div className="mt-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            About this trip
          </span>
          <textarea
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value)
              setSaved(false)
            }}
            placeholder="What's this trip about?"
            rows={3}
            className="mt-1.5 w-full resize-y rounded-lg border border-rule bg-transparent p-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
        </div>

        <TripCategories
          tripId={tripId}
          tripSlug={tripSlug}
          categories={expenseCategories}
        />

        <ChipGroup label="Vibe">
          {TRIP_VIBES.map((v) => (
            <Chip key={v} on={vibe.includes(v)} onClick={() => toggle(vibe, setVibe, v)}>
              {v}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="Who's coming">
          {TRIP_WHO.map((w) => (
            <Chip
              key={w}
              on={who === w}
              onClick={() => {
                setSaved(false)
                setWho(who === w ? "" : w)
              }}
            >
              {w}
            </Chip>
          ))}
        </ChipGroup>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {saving ? "saving…" : saved ? "saved" : "save profile"}
        </button>
      </section>

      <NotesTab {...notesProps} />
    </>
  )
}

/** The trip's categories — the same expense_categories used in Budget. Add/remove
 * here writes the shared list (deleting moves that category's expenses to
 * "Other", as in Budget). */
function TripCategories({
  tripId,
  tripSlug,
  categories,
}: {
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function add() {
    const t = name.trim()
    if (!t || pending) return
    startTransition(async () => {
      const r = await addExpenseCategory(tripId, tripSlug, t)
      if (r.error) {
        setError(r.error)
        return
      }
      setName("")
      setAdding(false)
      setError(null)
      router.refresh()
    })
  }

  function remove(c: ExpenseCategoryRow) {
    if (pending) return
    if (
      !confirm(
        `Delete "${c.name}"? Its expenses move to "Other" and its planned budget items are removed.`,
      )
    )
      return
    startTransition(async () => {
      const r = await deleteExpenseCategory(c.id, tripSlug)
      if (r.error) {
        setError(r.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  return (
    <div className="mt-4">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Categories
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground"
          >
            {c.name}
            <button
              type="button"
              onClick={() => remove(c)}
              disabled={pending}
              aria-label={`Delete ${c.name}`}
              className="text-muted-foreground hover:text-clay disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
              if (e.key === "Escape") {
                setAdding(false)
                setName("")
              }
            }}
            placeholder="New category…"
            disabled={pending}
            className="w-32 rounded-full border border-dashed border-rule bg-transparent px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-rule px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            + add category
          </button>
        )}
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}

function ChipGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-4">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.06em] ${
        on
          ? "border-foreground bg-foreground text-background"
          : "border-rule text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}
