"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCurrency } from "@/components/currency-context"
import { moneyRounded } from "@/lib/money"
import type { SuggestionOption, TripSuggestion } from "@/lib/trips/suggestion-types"

/** A big suggestion's options side by side (stacked on a phone); picking one
 * moves on to the day's event form. */
export function OptionsDialog({
  suggestion,
  options,
  onPick,
  onCancel,
}: {
  suggestion: TripSuggestion
  options: SuggestionOption[]
  onPick: (o: SuggestionOption) => void
  onCancel: () => void
}) {
  const { currency } = useCurrency()
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{suggestion.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map((o) => (
            <div key={o.name} className="flex flex-col gap-1 rounded-lg border border-rule p-3">
              <div className="text-[14px] text-foreground">{o.name}</div>
              {o.location ? (
                <div className="text-[12px] text-muted-foreground">{o.location}</div>
              ) : null}
              <div className="t-num text-[13px] text-foreground">
                {o.priceCents === null
                  ? "No price"
                  : `${moneyRounded(o.priceCents, currency)}${o.priceUnit === "per_person" ? " / person" : ""}`}
              </div>
              {o.reviews ? <div className="text-[12px] text-muted-foreground">{o.reviews}</div> : null}
              {o.url ? (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-sea underline-offset-2 hover:underline"
                >
                  Link
                </a>
              ) : null}
              <Button size="sm" className="mt-auto" onClick={() => onPick(o)}>
                Choose
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Sample data
          </span>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Asked once after a priced suggestion is saved. Only the two answers close it. */
export function PaidDialog({
  isPending,
  onAnswer,
}: {
  isPending: boolean
  onAnswer: (paid: boolean) => void
}) {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Did you pay for this already?</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={isPending} onClick={() => onAnswer(false)}>
            Not yet
          </Button>
          <Button disabled={isPending} onClick={() => onAnswer(true)}>
            Yes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
