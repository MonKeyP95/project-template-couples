"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  addExpenseCategory,
  deleteExpenseCategory,
  saveTripProfile,
  setCategoryDetails,
} from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import {
  TRIP_TRANSPORT,
  TRIP_VIBES,
  type TripProfile,
} from "@/lib/trips/trip-profile-types"
import { CategoryCard, OptionRow, StepShell } from "../profile-fields"

const STEP_COUNT = 4

/** Guided 4-step trip profile: idea, categories (the backbone), getting around,
 * vibe. One question per screen with big option rows. Categories write live (as
 * in Budget); idea/transport/vibe save once on the final step. Reopening starts
 * at step 1 pre-filled with the saved answers and current category set. */
export function ProfileWizard({
  tripId,
  tripSlug,
  profile,
  categories,
  onDone,
}: {
  tripId: string
  tripSlug: string
  profile: TripProfile
  categories: ExpenseCategoryRow[]
  onDone?: () => void
}) {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [idea, setIdea] = React.useState(profile.idea)
  const [transport, setTransport] = React.useState<string[]>(profile.transport)
  const [vibe, setVibe] = React.useState<string[]>(profile.vibe)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])

  function save() {
    setSaving(true)
    saveTripProfile({
      tripId,
      tripSlug,
      profile: { idea, transport, vibe },
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
      onDone?.()
    })
  }

  const isLast = step === STEP_COUNT - 1

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {step + 1} of {STEP_COUNT}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`h-1 w-6 rounded-full ${
                i <= step ? "bg-foreground" : "bg-rule"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 min-h-[240px]">
        {step === 0 ? (
          <StepShell title="Sum up this trip in a line">
            <textarea
              value={idea}
              autoFocus
              onChange={(e) => {
                setIdea(e.target.value)
                setSaved(false)
              }}
              placeholder="e.g. 2 weeks surfing in Portugal"
              rows={3}
              className="w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
            />
          </StepShell>
        ) : null}

        {step === 1 ? (
          <StepShell
            title="What's this trip made of?"
            hint="Your categories — they shape the budget too"
          >
            <CategoryStep
              tripId={tripId}
              tripSlug={tripSlug}
              categories={categories}
            />
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell title="How will you get around?" hint="Pick any that apply">
            {TRIP_TRANSPORT.map((t) => (
              <OptionRow
                key={t}
                label={t}
                selected={transport.includes(t)}
                onClick={() => {
                  setSaved(false)
                  toggle(transport, setTransport, t)
                }}
              />
            ))}
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell title="What's the vibe?" hint="Pick any that apply">
            {TRIP_VIBES.map((v) => (
              <OptionRow
                key={v}
                label={v}
                selected={vibe.includes(v)}
                onClick={() => {
                  setSaved(false)
                  toggle(vibe, setVibe, v)
                }}
              />
            ))}
          </StepShell>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (step === 0) {
              onDone?.()
              return
            }
            setStep((s) => Math.max(0, s - 1))
          }}
          disabled={step === 0 && !onDone}
          className="rounded-full border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          {step === 0 && onDone ? "cancel" : "back"}
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {saving ? "saving…" : saved ? "saved" : "save profile"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background"
          >
            next
          </button>
        )}
      </div>
    </section>
  )
}

/** The backbone step: the trip's expense_categories as expandable rows. Each
 * row can be opened to elaborate the category with describe-only detail tags
 * (Food -> burgers, sushi). Add/remove category and details all write live
 * (same actions/behavior as the Budget categories editor). */
function CategoryStep({
  tripId,
  tripSlug,
  categories,
}: {
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function addCategory() {
    const t = name.trim()
    if (!t || pending) return
    startTransition(async () => {
      const r = await addExpenseCategory(tripId, tripSlug, t)
      if (r.error) {
        setError(r.error)
        return
      }
      setName("")
      setError(null)
      router.refresh()
    })
  }

  function removeCategory(c: ExpenseCategoryRow) {
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

  function saveDetails(c: ExpenseCategoryRow, details: string[]) {
    startTransition(async () => {
      const r = await setCategoryDetails(c.id, tripSlug, details)
      if (r.error) {
        setError(r.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  return (
    <>
      {categories.map((c) => (
        <CategoryCard
          key={c.id}
          name={c.name}
          details={c.details}
          expanded={expandedId === c.id}
          pending={pending}
          onToggle={() =>
            setExpandedId((id) => (id === c.id ? null : c.id))
          }
          onRemove={() => removeCategory(c)}
          onAddDetail={(item) => saveDetails(c, [...c.details, item])}
          onRemoveDetail={(item) =>
            saveDetails(
              c,
              c.details.filter((d) => d !== item),
            )
          }
        />
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCategory()
            }
          }}
          placeholder="Add a category…"
          disabled={pending}
          className="flex-1 rounded-xl border border-dashed border-rule bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addCategory}
          disabled={pending || !name.trim()}
          className="rounded-xl border-0 bg-foreground px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          add
        </button>
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </>
  )
}
