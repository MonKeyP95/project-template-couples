"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { shareTrip, unshareTrip } from "@/lib/trips/share-actions"

export function ShareTripDialog({
  tripId,
  tripSlug,
  initialPublic,
  initialToken,
}: {
  tripId: string
  tripSlug: string
  initialPublic: boolean
  initialToken: string | null
}) {
  const [isPublic, setIsPublic] = useState(initialPublic)
  const [token, setToken] = useState(initialToken)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const link =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/t/${token}`
      : ""

  async function toggle() {
    setPending(true)
    setError(null)
    if (isPublic) {
      const res = await unshareTrip(tripId, tripSlug)
      if (res.error) setError(res.error)
      else setIsPublic(false)
    } else {
      const res = await shareTrip(tripId, tripSlug)
      if (res.error) setError(res.error)
      else {
        setToken(res.token ?? null)
        setIsPublic(true)
      }
    }
    setPending(false)
  }

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          />
        }
      >
        {"// share"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this trip</DialogTitle>
          <DialogDescription>
            Your budget, expenses, members, and exact dates are never shared —
            only the itinerary.
          </DialogDescription>
        </DialogHeader>

        <Button onClick={toggle} disabled={pending} variant={isPublic ? "outline" : "default"}>
          {isPublic ? "Stop sharing" : "Share publicly"}
        </Button>

        {isPublic && link ? (
          <div className="flex items-center gap-2 rounded-md border border-border p-2">
            <span className="truncate font-mono text-[11px] text-muted-foreground">{link}</span>
            <Button size="sm" variant="ghost" onClick={copyLink}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
      </DialogContent>
    </Dialog>
  )
}
