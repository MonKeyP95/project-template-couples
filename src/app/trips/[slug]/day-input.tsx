"use client"

import { dateOfIndex, toDayIndex } from "@/lib/trips/itinerary-types"

/** A date input that reads and writes a 1-based day number of the trip. */
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
  startDate: string
  min?: number | null
  ariaLabel?: string
  className?: string
  disabled?: boolean
  required?: boolean
}) {
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
