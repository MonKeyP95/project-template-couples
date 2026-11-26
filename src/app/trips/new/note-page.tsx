"use client"

import { BudgetPeriodPicker } from "@/components/budget-period-picker"
import { PinChoices } from "@/components/pin-choices"
import type { PlaceMatch } from "@/lib/weather/geocode"
import { currencyOptions } from "@/lib/fx/currency-list"
import type { DraftField, TripDraft } from "./new-trip-form"

const eyebrow =
  "font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
const lineInput =
  "border-0 border-b border-rule bg-transparent py-2 text-[20px] text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none"
const chip =
  "min-h-10 rounded-full border px-3.5 text-[14px] transition-colors"

/** Page 1: the note, when, budget, where if the note has no place, and an
 * accepted idea's route. */
export function NotePage({
  draft,
  symbol,
  noteHasPlace,
  pinMatches,
  pin,
  searching,
  onPin,
  onNote,
  onEdit,
  onDraft,
  onContinue,
  route,
  onDropRoute,
}: {
  draft: TripDraft
  symbol: string
  noteHasPlace: boolean
  /** Geocoder matches for the current "Where"; null until searched. */
  pinMatches: PlaceMatch[] | null
  pin: PlaceMatch | null
  searching: boolean
  onPin: (pin: PlaceMatch | null) => void
  onNote: (note: string) => void
  onEdit: (field: DraftField, value: string) => void
  onDraft: (patch: Partial<TripDraft>) => void
  onContinue: () => void
  /** The accepted idea's route as one line; null = no route. */
  route: string | null
  onDropRoute: () => void
}) {
  const halfDated = !draft.start !== !draft.end
  return (
    <div className="mt-6 flex flex-col gap-7">
      <div>
        <h1 className="font-serif text-[40px] leading-[1.05] text-foreground">
          Tell me about the trip.
        </h1>
        <p className="mt-2.5 text-[15px] leading-snug text-muted-foreground">
          However you&apos;d say it. How long, where or what, what it costs.
        </p>
        <textarea
          value={draft.note}
          onChange={(e) => onNote(e.target.value)}
          rows={5}
          placeholder="e.g. 2 weeks surfing"
          aria-label="Tell me about the trip"
          className="mt-6 block w-full resize-none rounded-xl border border-border bg-card p-3.5 text-[18px] leading-snug text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none"
        />
      </div>

      <div>
        <div className="grid grid-cols-2 gap-4">
          {(["start", "end"] as const).map((f) => (
            <label key={f} className="block">
              <span className={eyebrow}>{f === "start" ? "From" : "To"}</span>
              <input
                type="date"
                value={draft[f]}
                min={f === "end" ? draft.start || undefined : undefined}
                onChange={(e) => onEdit(f, e.target.value)}
                className="t-num mt-1 block w-full border-0 border-b border-rule bg-transparent py-2 text-[16px] text-foreground focus:border-clay focus:outline-none"
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {halfDated
            ? "Pick both dates, or neither."
            : draft.start
              ? null
              : "No dates yet? It's saved as a dream."}
        </p>
      </div>

      <div>
      <label className="block">
        <span className="block text-[17px] text-foreground">Budget</span>
        <span className="mt-1.5 flex items-baseline gap-2 border-b border-rule">
          <span className="text-[20px] text-muted-foreground">{symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.budget}
            onChange={(e) => onEdit("budget", e.target.value.replace(/\D/g, ""))}
            placeholder="2000"
            className={`${lineInput} min-w-0 flex-1 border-b-0`}
          />
          <span className="text-[13px] text-muted-foreground">whole trip</span>
        </span>
      </label>
      <BudgetPeriodPicker
        value={draft.budgetPeriod}
        onChange={(budgetPeriod) => onDraft({ budgetPeriod })}
        className="mt-3"
      />
      </div>

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
              placeholder="e.g. Portugal, Bali, the coast"
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
      {pinMatches ? (
        <div className="-mt-4">
          <span className={eyebrow}>Which one?</span>
          <PinChoices matches={pinMatches} value={pin} onPick={onPin} />
        </div>
      ) : null}
      {route ? (
        <div className="-mt-4 flex items-baseline gap-2">
          <span className={eyebrow}>Route:</span>
          <span className="min-w-0 flex-1 text-[14px] text-foreground">{route}</span>
          <button
            type="button"
            onClick={onDropRoute}
            aria-label="Drop route"
            className="px-1 text-[16px] leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      ) : null}

      <label className="block">
        <span className="block text-[17px] text-foreground">
          Which currency will you pay in there?
        </span>
        <select
          value={draft.currency}
          onChange={(e) => onDraft({ currency: e.target.value })}
          className={`${lineInput} mt-1.5 block w-full text-[16px]`}
        >
          {currencyOptions().map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onContinue}
        disabled={!draft.note.trim() || halfDated || searching}
        className="mt-3 h-[52px] rounded-[10px] border-0 bg-primary text-[16px] font-medium text-primary-foreground disabled:opacity-40"
      >
        Continue
      </button>
    </div>
  )
}
