"use client"

import * as React from "react"

import { getImportableTrips, type ImportableTrip } from "@/lib/trips/actions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ImportFromTripControl({
  tripId,
  label,
  onCopy,
}: {
  tripId: string
  label: string
  onCopy: (sourceTripId: string) => Promise<{ error?: string }>
}) {
  const [open, setOpen] = React.useState(false)
  const [trips, setTrips] = React.useState<ImportableTrip[]>([])
  const [selected, setSelected] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function openPicker() {
    setError(null)
    setOpen(true)
    startTransition(async () => {
      const list = await getImportableTrips(tripId)
      setTrips(list)
      setSelected(list[0]?.id ?? "")
    })
  }

  function copy() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const result = await onCopy(selected)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPicker}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-clay p-3">
      {trips.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          {isPending ? "Loading…" : "No other trips to copy from."}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            value={selected}
            onValueChange={(value) => setSelected(value ?? "")}
            disabled={isPending}
          >
            <SelectTrigger className="mt-0 w-auto flex-1 text-[13px]">
              <SelectValue>
                {(value: string | null) =>
                  trips.find((t) => t.id === value)?.name ?? ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {trips.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={copy}
            disabled={isPending || !selected}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-clay hover:text-foreground disabled:opacity-50"
          >
            {isPending ? "…" : "copy"}
          </button>
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
      </div>
      {error ? (
        <p className="font-mono text-[10px] text-clay">{error}</p>
      ) : null}
    </div>
  )
}
