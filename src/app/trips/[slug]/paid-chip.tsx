"use client"

/** The place editor's paid pill: "paid ✓" in moss, "to pay" in clay. */
export function PaidChip({
  paid,
  disabled,
  onToggle,
}: {
  paid: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={paid}
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] disabled:opacity-50 ${
        paid ? "border-moss text-moss" : "border-clay text-clay"
      }`}
    >
      {paid ? "paid ✓" : "to pay"}
    </button>
  )
}
