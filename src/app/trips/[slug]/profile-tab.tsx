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
import { TRIP_VIBES, type TripProfile } from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: interim single-page form above the reused Categories
 * and Notes features. The guided wizard replaces this top section next. */
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
  const [idea, setIdea] = React.useState(profile.idea)
  const [vibe, setVibe] = React.useState<string[]>(profile.vibe)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  function toggleVibe(tag: string) {
    setSaved(false)
    setVibe((list) =>
      list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag],
    )
  }

  function save() {
    setSaving(true)
    saveTripProfile({
      tripId,
      tripSlug,
      profile: { idea, vibe, transport: profile.transport },
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
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          The idea
        </span>
        <textarea
          value={idea}
          onChange={(e) => {
            setIdea(e.target.value)
            setSaved(false)
          }}
          placeholder="Sum up this trip in a line — e.g. 2 weeks surfing in Portugal"
          rows={3}
          className="mt-1.5 w-full resize-y rounded-lg border border-rule bg-transparent p-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
        />

        <div className="mt-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Vibe
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TRIP_VIBES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVibe(v)}
                aria-pressed={vibe.includes(v)}
                className={`rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.06em] ${
                  vibe.includes(v)
                    ? "border-foreground bg-foreground text-background"
                    : "border-rule text-muted-foreground hover:text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {saving ? "saving…" : saved ? "saved" : "save profile"}
        </button>

        <TripCategories
          tripId={tripId}
          tripSlug={tripSlug}
          categories={expenseCategories}
        />
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
