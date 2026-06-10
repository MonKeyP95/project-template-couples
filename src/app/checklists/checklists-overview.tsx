"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Chevron } from "@/components/together"
import { createChecklist, deleteChecklist } from "@/lib/checklists/actions"
import type { ChecklistSummary } from "@/lib/checklists/types"

export function ChecklistsOverview({
  initial,
}: {
  initial: ChecklistSummary[]
}) {
  const router = useRouter()
  const [lists, setLists] = React.useState(initial)
  const [lastInitial, setLastInitial] = React.useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    setLists(initial)
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete '${name}' and everything in it?`)) return
    const snapshot = lists
    setLists((prev) => prev.filter((l) => l.id !== id))
    const result = await deleteChecklist(id)
    if (result.error) setLists(snapshot)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {lists.map((l) => (
        <div key={l.id} className="flex items-center gap-2">
          <Link
            href={`/checklists/${l.slug}`}
            className="flex flex-1 items-center justify-between rounded-[12px] border border-border bg-card px-4 py-3.5 shadow-sm transition-shadow md:hover:shadow-md"
          >
            <span className="t-display text-[20px] text-foreground">
              <em>{l.name}</em>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
                {l.done} / {l.total}
              </span>
              <Chevron />
            </span>
          </Link>
          <button
            type="button"
            onClick={() => remove(l.id, l.name)}
            aria-label="Delete checklist"
            className="border-0 bg-transparent px-1.5 font-mono text-[14px] text-muted-foreground hover:text-clay"
          >
            ×
          </button>
        </div>
      ))}
      {lists.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-rule px-4 py-6 text-center text-[13px] text-muted-foreground">
          No checklists yet — add your first one.
        </div>
      ) : null}
      <AddChecklistRow
        onCreate={async (name) => {
          const result = await createChecklist(name)
          if (result.slug) router.push(`/checklists/${result.slug}`)
          return result
        }}
      />
    </div>
  )
}

function AddChecklistRow({
  onCreate,
}: {
  onCreate: (name: string) => Promise<{ error?: string; slug?: string }>
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  function reset() {
    setExpanded(false)
    setValue("")
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = value.trim()
    if (!name || pending) return
    setPending(true)
    setError(null)
    const result = await onCreate(name)
    setPending(false)
    if (result.error) setError(result.error)
    // On success, onCreate navigates away.
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-[12px] border border-dashed border-rule py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add checklist
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[12px] border border-border bg-card px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder="New checklist, e.g. Camping"
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-sea focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          add
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
