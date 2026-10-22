"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { uploadAndRead } from "@/lib/trips/receipt-upload"

export interface AddReceiptsButtonProps {
  tripId: string
  tripSlug: string
  /** Attach straight to this expense; omit to drop into the pile. */
  expenseId?: string | null
  label?: string
}

/** Pick one or more photos/PDFs and upload them one by one. */
export function AddReceiptsButton({
  tripId,
  tripSlug,
  expenseId = null,
  label = "add receipts",
}: AddReceiptsButtonProps) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [progress, setProgress] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<string[]>([])

  async function upload(files: File[]) {
    const failed: string[] = []
    setErrors([])
    for (const [i, file] of files.entries()) {
      setProgress(`adding ${i + 1}/${files.length}…`)
      const { error } = await uploadAndRead(
        { tripId, tripSlug, file, expenseId },
        () => router.refresh(),
      )
      if (error) failed.push(`${file.name}: ${error}`)
    }
    setProgress(null)
    setErrors(failed)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (files.length) upload(files)
        }}
      />
      <button
        type="button"
        disabled={progress !== null}
        onClick={() => inputRef.current?.click()}
        className="self-start rounded-full border border-border bg-background px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground disabled:opacity-40"
      >
        {progress ?? label}
      </button>
      {errors.map((e) => (
        <div key={e} className="font-mono text-[10px] text-clay">
          {e}
        </div>
      ))}
    </div>
  )
}
