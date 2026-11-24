"use client"

import type { PlaceMatch } from "@/lib/weather/geocode"

function samePlace(a: PlaceMatch | null, b: PlaceMatch | null): boolean {
  return a?.lat === b?.lat && a?.lng === b?.lng && a?.fullName === b?.fullName
}

/** The geocoder's matches for a place, one to tap, plus "Not a specific
 * place". No matches shows the shorter-name hint instead. */
export function PinChoices({
  matches,
  value,
  onPick,
}: {
  matches: PlaceMatch[]
  value: PlaceMatch | null
  onPick: (pin: PlaceMatch | null) => void
}) {
  if (matches.length === 0) {
    return (
      <p className="mt-2 text-[13px] text-muted-foreground">
        No match. Try a shorter name (the town, without &apos;Caleta de&apos;).
      </p>
    )
  }
  const rows: Array<{ key: string; label: string; pin: PlaceMatch | null }> = [
    ...matches.map((m) => ({ key: `${m.lat},${m.lng},${m.fullName}`, label: m.fullName, pin: m })),
    { key: "none", label: "Not a specific place", pin: null },
  ]
  return (
    <div role="radiogroup" aria-label="Which place?" className="mt-2 flex flex-col">
      {rows.map((row) => {
        const checked = samePlace(row.pin, value)
        return (
          <button
            key={row.key}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onPick(row.pin)}
            className="flex min-h-10 items-center gap-2.5 text-left text-[14px] text-foreground"
          >
            <span
              className={`size-3.5 flex-shrink-0 rounded-full border ${
                checked ? "border-primary bg-primary" : "border-rule"
              }`}
            />
            <span className={row.pin ? "" : "text-muted-foreground"}>{row.label}</span>
          </button>
        )
      })}
    </div>
  )
}
