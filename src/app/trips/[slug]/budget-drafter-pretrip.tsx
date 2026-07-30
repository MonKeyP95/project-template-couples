"use client"

import { currencySymbol } from "@/lib/money"
import { useCurrency } from "@/components/currency-context"

export const PRE_TRIP_CATEGORY = "Pre-trip"

export interface PreTripStep {
  key: string
  label: string
  addNoun: string
  /** Fixed slots lock the subject to the label; the extras step lets the couple name rows. */
  fixedSubject: string | null
}

export const PRE_TRIP_STEPS: PreTripStep[] = [
  {
    key: "pretrip:flights",
    label: "Flights / getting there",
    addNoun: "flight",
    fixedSubject: "Flights / getting there",
  },
  {
    key: "pretrip:insurance",
    label: "Travel insurance",
    addNoun: "policy",
    fixedSubject: "Travel insurance",
  },
  {
    key: "pretrip:docs",
    label: "Docs & fees",
    addNoun: "doc",
    fixedSubject: "Docs & fees",
  },
  {
    key: "pretrip:medicine",
    label: "Medicine / vaccinations",
    addNoun: "item",
    fixedSubject: "Medicine / vaccinations",
  },
  {
    key: "pretrip:gear",
    label: "Gear & equipment",
    addNoun: "item",
    fixedSubject: "Gear & equipment",
  },
  {
    key: "pretrip:extras",
    label: "Anything else?",
    addNoun: "item",
    fixedSubject: null,
  },
]

export function isPreTripKey(key: string): boolean {
  return key.startsWith("pretrip:")
}

/** The bucket a saved Pre-trip item belongs to, matched on its locked subject;
 * anything else the couple named lands in the extras bucket. */
export function preTripBucketFor(subject: string): string {
  const hit = PRE_TRIP_STEPS.find((s) => s.fixedSubject === subject.trim())
  return hit ? hit.key : "pretrip:extras"
}

/** A drafter row, narrowed to the fields a pre-trip screen touches. */
export interface PreTripRowLike {
  id: string
  subject: string
  when: string
  value: string
}

export function PreTripStepBody({
  step,
  rows,
  disabled,
  onPatch,
  onAdd,
  onRemove,
}: {
  step: PreTripStep
  rows: PreTripRowLike[]
  disabled: boolean
  onPatch: (id: string, patch: { subject?: string; when?: string; value?: string }) => void
  onAdd: () => void
  onRemove: (id: string) => void
}) {
  const { currency } = useCurrency()
  return (
    <>
      <div className="mt-2 font-serif text-[15px] italic text-foreground">{step.label}</div>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
            {step.fixedSubject === null ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.subject}
                  placeholder="What"
                  onChange={(e) => onPatch(row.id, { subject: e.target.value })}
                  disabled={disabled}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  disabled={disabled}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
            ) : null}
            <div
              className={`flex items-center gap-1.5 ${step.fixedSubject === null ? "mt-1.5" : ""}`}
            >
              <input
                type="text"
                value={row.when}
                placeholder="Note (optional)"
                onChange={(e) => onPatch(row.id, { when: e.target.value })}
                disabled={disabled}
                className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
              />
              <span className="inline-flex items-baseline gap-1">
                <span className="font-mono text-[12px] text-muted-foreground">
                  {currencySymbol(currency)}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={row.value}
                  onChange={(e) => onPatch(row.id, { value: e.target.value })}
                  disabled={disabled}
                  className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
                />
              </span>
              {step.fixedSubject !== null ? (
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  disabled={disabled}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add {step.addNoun}
        </button>
      </div>
    </>
  )
}
