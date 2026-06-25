"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { copySharedTrip } from "@/lib/trips/share-actions"

export function CopyCta({
  token,
  isAuthed,
}: {
  token: string
  isAuthed: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function copy() {
    setPending(true)
    setError(null)
    const res = await copySharedTrip(token, startDate)
    if (res.error) {
      setError(res.error)
      setPending(false)
      return
    }
    setDone(true)
    router.push(`/trips/${res.slug}`)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[440px] px-5 py-4 lg:max-w-[760px]">
        {!isAuthed ? (
          <Link
            href={`/signin?next=/t/${token}`}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            Plan my own trip from this
          </Link>
        ) : !open ? (
          <Button size="lg" className="w-full" onClick={() => setOpen(true)}>
            Plan my own trip from this
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Your start date
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <Button onClick={copy} disabled={pending || done || !startDate}>
                {done ? "Opening..." : pending ? "Copying..." : "Copy"}
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </div>
    </div>
  )
}
