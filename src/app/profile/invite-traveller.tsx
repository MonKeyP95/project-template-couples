"use client"

import { useState, useTransition } from "react"

import { generateInvite } from "@/lib/workspace/actions"
import { Button } from "@/components/ui/button"

export interface InvitableTraveller {
  id: string
  display_name: string
}

/**
 * Turns a traveller who has no account into one who does. The link is targeted
 * at her person row, so accepting adopts it -- her expenses and savings stay
 * hers instead of landing on a second entry for the same human.
 */
export function InviteTraveller({ people }: { people: InvitableTraveller[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (people.length === 0) return null

  function onGenerate(personId: string) {
    setError(null)
    setPendingId(personId)
    startTransition(async () => {
      const result = await generateInvite(personId)
      if (result.error) {
        setError(result.error)
        setPendingId(null)
        return
      }
      setUrls((prev) => ({ ...prev, [personId]: result.url ?? "" }))
      setPendingId(null)
    })
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <p className="text-sm text-muted-foreground">
        Travellers without a login
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Send one of these a link and they get their own account, keeping
        everything already recorded in their name.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {people.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-border px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-serif text-[15px] italic text-foreground">
                {p.display_name}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => onGenerate(p.id)}
                disabled={isPending}
              >
                {isPending && pendingId === p.id ? "…" : "Invite"}
              </Button>
            </div>
            {urls[p.id] ? (
              <code className="mt-2 block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                {urls[p.id]}
              </code>
            ) : null}
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
