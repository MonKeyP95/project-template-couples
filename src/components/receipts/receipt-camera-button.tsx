"use client"

import * as React from "react"
import { Camera } from "lucide-react"

import { deleteReceipt, readReceipt } from "@/lib/trips/receipt-actions"
import type { ReceiptReading } from "@/lib/trips/receipt-types"
import { uploadReceipt } from "@/lib/trips/receipt-upload"

export interface ReceiptCameraButtonProps {
  tripId: string
  tripSlug: string
  /** The receipt taken for the expense being added; the form attaches it on save. */
  receiptId: string | null
  onReceiptIdChange: (id: string | null) => void
  /** The receipt's contents, for filling the form. */
  onReading: (reading: ReceiptReading) => void
  /** True from taking the photo until it has been read. */
  onBusyChange: (busy: boolean) => void
  onError: (error: string | null) => void
  disabled?: boolean
}

/**
 * Camera icon for an expense form. Taking a photo uploads and reads it straight
 * away (it sits in the pile until the expense saves); tapping again drops it.
 */
export function ReceiptCameraButton({
  tripId,
  tripSlug,
  receiptId,
  onReceiptIdChange,
  onReading,
  onBusyChange,
  onError,
  disabled,
}: ReceiptCameraButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  // The read lands seconds later; call the form's latest onReading so it
  // sees what was typed meanwhile, not the values from when the photo was taken.
  const onReadingRef = React.useRef(onReading)
  React.useEffect(() => {
    onReadingRef.current = onReading
  })

  function setBusyBoth(value: boolean) {
    setBusy(value)
    onBusyChange(value)
  }

  async function take(file: File | undefined) {
    if (!file) return
    onError(null)
    setBusyBoth(true)
    const upload = await uploadReceipt({ tripId, tripSlug, file, expenseId: null })
    if (upload.error || !upload.receiptId) {
      onError(upload.error ?? "Upload failed, receipt not saved.")
      setBusyBoth(false)
      return
    }
    onReceiptIdChange(upload.receiptId)
    // A failed read still leaves the receipt held; the form is just not filled.
    const read = await readReceipt(upload.receiptId, tripSlug).catch(() => ({ reading: undefined }))
    if (read.reading) onReadingRef.current(read.reading)
    else onError("Couldn't read the receipt; fill the expense in by hand.")
    setBusyBoth(false)
  }

  function drop() {
    // If this delete fails the receipt just stays in the pile, where it can be deleted.
    if (receiptId) deleteReceipt(receiptId, tripSlug).catch(() => {})
    onReceiptIdChange(null)
    onError(null)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => (receiptId ? drop() : inputRef.current?.click())}
        aria-label={busy ? "Reading receipt" : receiptId ? "Remove receipt" : "Add a receipt"}
        aria-pressed={receiptId !== null}
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${
          receiptId || busy
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground"
        } ${busy ? "animate-pulse" : ""} disabled:opacity-60`}
      >
        <Camera className="size-4" aria-hidden />
      </button>
    </>
  )
}
