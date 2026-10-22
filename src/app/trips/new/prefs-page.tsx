"use client"

import { PREF_TOPICS, tripHeadline } from "@/lib/trips/trip-note-parse"
import type { DraftField, TripDraft } from "./new-trip-form"

/** Page 2: the optional, softer preferences, pre-filled from the note. */
export function PrefsPage({
  draft,
  isPending,
  error,
  onEdit,
  onBack,
  onCreate,
}: {
  draft: TripDraft
  isPending: boolean
  error: string | null
  onEdit: (field: DraftField, value: string) => void
  onBack: () => void
  onCreate: (withPrefs: boolean) => void
}) {
  const place = draft.unsure ? "" : draft.place
  return (
    <div className="mt-4 flex flex-col gap-7">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="h-11 border-0 bg-transparent p-0 text-[14px] text-sea"
        >
          ← Back
        </button>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Optional
        </span>
      </div>
      <div>
        <h1 className="font-serif text-[34px] leading-[1.05] text-foreground">
          {tripHeadline(draft.what, place)}
        </h1>
        <p className="mt-2 text-[14px] leading-snug text-muted-foreground">
          The less fixed things, in your own words. Names and details welcome.
          Anything from your note is already filled in.
        </p>
      </div>
      {PREF_TOPICS.map((t) => (
        <label key={t.key} className="block">
          <span className="block text-[17px] text-foreground">{t.title}</span>
          <textarea
            value={draft.prefs[t.key]}
            onChange={(e) => onEdit(t.key, e.target.value)}
            rows={2}
            placeholder={t.hint}
            disabled={isPending}
            className="mt-2 block w-full resize-none rounded-[10px] border border-border bg-card px-3 py-2.5 text-[15px] leading-snug text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
        </label>
      ))}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => onCreate(false)}
          disabled={isPending}
          className="h-[52px] flex-1 rounded-[10px] border border-rule bg-transparent text-[16px] text-foreground disabled:opacity-40"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => onCreate(true)}
          disabled={isPending}
          className="h-[52px] flex-[2] rounded-[10px] border-0 bg-primary text-[16px] font-medium text-primary-foreground disabled:opacity-40"
        >
          {isPending ? "…" : "Create trip"}
        </button>
      </div>
      {error ? <p className="font-mono text-[11px] text-clay">{error}</p> : null}
    </div>
  )
}
