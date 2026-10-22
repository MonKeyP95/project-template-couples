"use client"

import * as React from "react"
import { Camera } from "lucide-react"

import { checkReceiptFile } from "@/lib/trips/receipt-types"

export interface ReceiptCameraButtonProps {
  /** The receipt held for the expense being added; attached after it saves. */
  file: File | null
  onFileChange: (file: File | null) => void
  /** Called with the reason a picked file was refused, or null. */
  onError: (error: string | null) => void
  disabled?: boolean
}

/** Camera icon that holds one receipt for an expense form. Tap again to drop it. */
export function ReceiptCameraButton({
  file,
  onFileChange,
  onError,
  disabled,
}: ReceiptCameraButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  function pick(picked: File | undefined) {
    if (!picked) return
    const invalid = checkReceiptFile(picked)
    onError(invalid)
    onFileChange(invalid ? null : picked)
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
          pick(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => (file ? onFileChange(null) : inputRef.current?.click())}
        aria-label={file ? "Remove receipt" : "Add a receipt"}
        aria-pressed={file !== null}
        className={`flex size-9 shrink-0 items-center justify-center rounded-full border disabled:opacity-40 ${
          file ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
        }`}
      >
        <Camera className="size-4" aria-hidden />
      </button>
    </>
  )
}
