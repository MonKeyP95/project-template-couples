"use client"

import type { DraftField, TripDraft } from "./new-trip-form"

const eyebrow =
  "font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
const lineInput =
  "border-0 border-b border-rule bg-transparent py-2 text-[20px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
const chip =
  "min-h-10 rounded-full border px-3.5 text-[14px] transition-colors"

function endLabel(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00`)
  d.setDate(d.getDate() + days - 1)
  return `to ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`
}

/** Page 1: the note, how long (+ dates), budget, and where if the note has no place. */
export function NotePage({
  draft,
  symbol,
  noteHasPlace,
  onNote,
  onEdit,
  onDraft,
  onContinue,
}: {
  draft: TripDraft
  symbol: string
  noteHasPlace: boolean
  onNote: (note: string) => void
  onEdit: (field: DraftField, value: string) => void
  onDraft: (patch: Partial<TripDraft>) => void
  onContinue: () => void
}) {
  const days = parseInt(draft.days, 10) || 0
  return (
    <div className="mt-6 flex flex-col gap-7">
      <div>
        <h1 className="font-serif text-[40px] leading-[1.05] text-foreground">
          Tell me about the trip.
        </h1>
        <p className="mt-2.5 text-[15px] leading-snug text-muted-foreground">
          However you&apos;d say it. How long, where or what, roughly what it costs.
        </p>
        <textarea
          value={draft.note}
          onChange={(e) => onNote(e.target.value)}
          rows={5}
          placeholder="2 weeks surfing"
          aria-label="Tell me about the trip"
          className="mt-6 block w-full resize-none rounded-xl border border-border bg-card p-3.5 text-[18px] leading-snug text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
        />
      </div>

      <div>
        <label className="block">
          <span className="block text-[17px] text-foreground">How long is the trip?</span>
          <span className="mt-1.5 flex items-baseline gap-2 border-b border-rule">
            <input
              type="text"
              inputMode="numeric"
              value={draft.days}
              onChange={(e) => onEdit("days", e.target.value.replace(/\D/g, ""))}
              placeholder="10"
              className={`${lineInput} w-16 border-b-0`}
            />
            <span className="text-[16px] text-muted-foreground">days</span>
          </span>
        </label>
        {draft.showDates ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[14px] text-muted-foreground">
              From
              <input
                type="date"
                value={draft.start}
                onChange={(e) => onDraft({ start: e.target.value })}
                className="t-num border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground focus:border-clay focus:outline-none"
              />
            </label>
            {draft.start && days > 0 ? (
              <span className="text-[14px] text-muted-foreground">
                {endLabel(draft.start, days)}
              </span>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onDraft({ showDates: true })}
            className="mt-1 h-11 border-0 bg-transparent p-0 text-[14px] text-sea underline underline-offset-4"
          >
            + Add dates
          </button>
        )}
      </div>

      <label className="block">
        <span className="block text-[17px] text-foreground">Roughly what&apos;s the budget?</span>
        <span className="mt-1.5 flex items-baseline gap-2 border-b border-rule">
          <span className="text-[20px] text-muted-foreground">{symbol}</span>
          <input
            type="text"
            inputMode="numeric"
            value={draft.budget}
            onChange={(e) => onEdit("budget", e.target.value.replace(/\D/g, ""))}
            placeholder="2000"
            className={`${lineInput} min-w-0 flex-1 border-b-0`}
          />
          <span className="text-[13px] text-muted-foreground">whole trip</span>
        </span>
      </label>

      {noteHasPlace ? (
        <label className="flex items-baseline gap-3 border-b border-rule">
          <span className={eyebrow}>Where:</span>
          <input
            type="text"
            value={draft.place}
            onChange={(e) => onEdit("place", e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[18px] text-foreground focus:outline-none"
          />
        </label>
      ) : (
        <div>
          <label className="block">
            <span className="block text-[17px] text-foreground">Where?</span>
            <input
              type="text"
              value={draft.place}
              onChange={(e) => onEdit("place", e.target.value)}
              disabled={draft.unsure}
              placeholder="Portugal, Bali, the coast..."
              className={`${lineInput} mt-1.5 block w-full disabled:opacity-40`}
            />
          </label>
          <button
            type="button"
            aria-pressed={draft.unsure}
            onClick={() => onDraft({ unsure: !draft.unsure, place: "" })}
            className={`${chip} mt-2.5 ${
              draft.unsure
                ? "border-primary bg-primary text-primary-foreground"
                : "border-rule bg-transparent text-foreground hover:border-foreground"
            }`}
          >
            Not sure yet
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        disabled={days < 1}
        className="mt-3 h-[52px] rounded-[10px] border-0 bg-primary text-[16px] font-medium text-primary-foreground disabled:opacity-40"
      >
        Continue
      </button>
    </div>
  )
}
