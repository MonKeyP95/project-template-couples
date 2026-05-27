import * as React from "react"
import { cn } from "@/lib/utils"
import { Avatar, type AvatarTone } from "./avatar"

export type CheckRowTone = "sea" | "clay" | "moss"

const checkboxFill: Record<CheckRowTone, string> = {
  sea: "border-sea bg-sea",
  clay: "border-clay bg-clay",
  moss: "border-moss bg-moss",
}

export interface CheckRowProps {
  done: boolean
  label: string
  /** Display name of the person who added the item; only the first char is shown. */
  who?: string
  whoTone?: AvatarTone
  onToggle?: () => void
  /** Fill color when checked. */
  tone?: CheckRowTone
  className?: string
}

export function CheckRow({
  done,
  label,
  who,
  whoTone = "sea",
  onToggle,
  tone = "clay",
  className,
}: CheckRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      className={cn(
        "flex w-full items-center gap-3 border-0 bg-transparent py-2.5 text-left",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
          done ? checkboxFill[tone] : "border-rule bg-transparent",
        )}
      >
        {done ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="pop"
            aria-hidden
          >
            <path
              d="M1.5 5.2 L4 7.5 L8.5 2.5"
              fill="none"
              stroke="var(--card)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <span
        className={cn(
          "flex-1 text-[14px] tracking-[-0.005em]",
          done ? "text-muted-foreground checked-line" : "text-foreground",
        )}
      >
        {label}
      </span>
      {who ? <Avatar name={who} size={18} tone={whoTone} /> : null}
    </button>
  )
}
