"use client"

import { useState, useTransition } from "react"

import { generateInvite } from "@/lib/workspace/actions"
import { Button } from "@/components/ui/button"

export function InviteCard() {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  function onGenerate() {
    setError(null)
    startTransition(async () => {
      const result = await generateInvite()
      if (result.error) {
        setError(result.error)
        setUrl(null)
        return
      }
      setUrl(result.url ?? null)
      setCopied(false)
    })
  }

  async function onCopy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-serif text-2xl tracking-tight">Invite your partner</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Generate a one-time link. Send it however you want — they&apos;ll land directly in your workspace.
      </p>

      {url ? (
        <div className="mt-5 flex flex-col gap-2">
          <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {url}
          </code>
          <div className="flex items-center justify-between">
            <Button type="button" onClick={onCopy} variant="outline">
              {copied ? "Copied" : "Copy link"}
            </Button>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Expires in 14 days · single use
            </span>
          </div>
        </div>
      ) : (
        <Button type="button" onClick={onGenerate} disabled={isPending} className="mt-5">
          {isPending ? "Generating…" : "Generate invite link"}
        </Button>
      )}

      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  )
}
