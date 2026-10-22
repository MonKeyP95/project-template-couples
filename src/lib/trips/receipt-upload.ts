import { createClient } from "@/lib/supabase/client"
import { addReceipt, readReceipt } from "@/lib/trips/receipt-actions"
import { checkReceiptFile } from "@/lib/trips/receipt-types"

const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.82

/** Re-encode a photo as JPEG with its longest edge at most 1600 px, upright. */
export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  )
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY })
}

export interface UploadReceiptInput {
  tripId: string
  tripSlug: string
  file: File
  expenseId: string | null
}

/**
 * Upload straight from the browser to Storage, then record it on the server.
 * Nothing is recorded when the upload fails. Reading is the caller's next
 * step (`readReceipt` with the returned id), so the card shows "reading…".
 */
export async function uploadReceipt(
  input: UploadReceiptInput,
): Promise<{ error?: string; receiptId?: string }> {
  const invalid = checkReceiptFile(input.file)
  if (invalid) return { error: invalid }

  // A dropped connection rejects the server-action call instead of returning
  // { error }, and an undecodable photo rejects in shrinkImage.
  try {
    const isPdf = input.file.type === "application/pdf"
    const body = isPdf ? input.file : await shrinkImage(input.file)
    const mimeType = isPdf ? "application/pdf" : "image/jpeg"
    const receiptId = crypto.randomUUID()
    const storagePath = `${input.tripId}/${receiptId}.${isPdf ? "pdf" : "jpg"}`

    const { error } = await createClient()
      .storage.from("receipts")
      .upload(storagePath, body, { contentType: mimeType })
    if (error) return { error: "Upload failed, receipt not saved." }

    const result = await addReceipt({
      tripId: input.tripId,
      tripSlug: input.tripSlug,
      receiptId,
      storagePath,
      mimeType,
      expenseId: input.expenseId,
    })
    return result.error ? result : { receiptId }
  } catch {
    return { error: "Upload failed, receipt not saved." }
  }
}

/**
 * Upload a receipt, then read it in the background. `onChange` runs once the
 * upload is recorded and again when the read ends (either outcome is on the row).
 */
export async function uploadAndRead(
  input: UploadReceiptInput,
  onChange: () => void,
): Promise<{ error?: string }> {
  const { error, receiptId } = await uploadReceipt(input)
  if (receiptId) {
    onChange()
    readReceipt(receiptId, input.tripSlug).then(onChange, onChange)
  }
  return { error }
}
