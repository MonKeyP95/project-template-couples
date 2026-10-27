"use client"

import { dateOfIndex, toDayIndex } from "@/lib/trips/itinerary-types"

/** An input for a 1-based day number of the trip: a date picker on a dated
 * trip, a plain number ("Day N") on a dream. */
export function DayInput({
  value,
  onChange,
  startDate,
  min,
  ariaLabel,
  className,
  disabled,
  required,
}: {
  value: number | null
  onChange: (dayIndex: number | null) => void
  startDate: string | null
  min?: number | null
  ariaLabel?: string
  className?: string
  disabled?: boolean
  required?: boolean
}) {
  if (startDate === null) {
    return (
      <input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={value ?? ""}
        min={min ?? 1}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isFinite(n) ? n : null)
        }}
        className={className}
        disabled={disabled}
        required={required}
      />
    )
  }
  return (
    <input
      type="date"
      aria-label={ariaLabel}
      value={value === null ? "" : dateOfIndex(value, startDate)}
      min={min == null ? undefined : dateOfIndex(min, startDate)}
      onChange={(e) => onChange(toDayIndex(e.target.value, startDate))}
      className={className}
      disabled={disabled}
      required={required}
    />
  )
}
