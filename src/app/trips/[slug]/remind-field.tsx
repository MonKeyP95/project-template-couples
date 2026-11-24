"use client"

/** Optional "remind me" moment for a note; `value` is a datetime-local string, "" for none. */
export function RemindField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="mt-2 block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Remind me
      </span>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] text-foreground disabled:opacity-50"
      />
    </label>
  )
}
