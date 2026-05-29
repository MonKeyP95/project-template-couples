"use client"

import * as React from "react"

import {
  Bar,
  CheckRow,
  Coord,
  Label,
  SuggestionCard,
  TopoBg,
} from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addPackingItem,
  deletePackingItem,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
import {
  groupPackingItems,
  type PackingItem,
} from "@/lib/trips/packing-types"

export interface MemberToneEntry {
  initial: string
  displayName: string
  tone: "sea" | "clay"
}

export interface PackingTabProps {
  tripId: string
  initialItems: PackingItem[]
  members: Record<string, MemberToneEntry>
  daysOut: number | null
}

interface RealtimeRow {
  id: string
  trip_id: string
  category: string
  label: string
  done: boolean
  added_by: string
  created_at: string
}

function fromRow(row: RealtimeRow): PackingItem {
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }
}

export function PackingTab({
  tripId,
  initialItems,
  members,
  daysOut,
}: PackingTabProps) {
  const [items, setItems] = React.useState<PackingItem[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  // Sync local state when the server re-fetches (e.g. RefreshOnVisible after
  // the tab returns from background, where Realtime may have missed events).
  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setItems(initialItems)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`packing-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "packing_items",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          console.log("[packing realtime]", payload.eventType, payload)
          if (payload.eventType === "UPDATE") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) =>
              prev.map((i) => (i.id === next.id ? next : i)),
            )
          } else if (payload.eventType === "INSERT") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) =>
              prev.some((i) => i.id === next.id) ? prev : [...prev, next],
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setItems((prev) => prev.filter((i) => i.id !== old.id))
            }
          }
        },
      )
      .subscribe((status, err) => {
        console.log("[packing realtime] channel status:", status, err ?? "")
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])

  async function toggle(id: string) {
    const current = items.find((i) => i.id === id)
    if (!current) return
    const next = !current.done

    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, done: next } : i)),
    )

    const result = await togglePackingItem(id, next)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, done: current.done } : i)),
      )
    }
  }

  async function update(id: string, label: string): Promise<{ error?: string }> {
    const current = items.find((i) => i.id === id)
    if (!current) return {}
    const trimmed = label.trim()

    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, label: trimmed } : i)),
    )

    const result = await updatePackingItem(id, trimmed)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, label: current.label } : i)),
      )
    }
    return result
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this item?")) return
    const snapshot = items
    setItems((prev) => prev.filter((i) => i.id !== id))

    const result = await deletePackingItem(id)
    if (result.error) setItems(snapshot)
  }

  const groups = groupPackingItems(items)
  const total = items.length
  const done = items.filter((i) => i.done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const daysOutLabel = daysOut == null ? null : `${Math.max(0, daysOut)} days out`

  return (
    <section>
      <div className="relative overflow-hidden bg-clay-tint px-5 pt-6 pb-4">
        <TopoBg tone="clay" opacity={0.1} />
        <div className="relative flex items-start justify-between">
          <div>
            <Label>Packing</Label>
            <div className="t-display mt-1 text-[36px] text-foreground">
              <span className="t-num">{done}</span>
              <span className="text-muted-foreground">/{total}</span>
            </div>
          </div>
          <div className="text-right">
            {daysOutLabel ? <Coord>{daysOutLabel}</Coord> : null}
            <div className="mt-1 font-mono text-[11px] tracking-[0.06em] text-clay">
              {pct}% ready
            </div>
          </div>
        </div>
        <div className="relative mt-3.5">
          <Bar pct={pct} tone="clay" />
        </div>
      </div>

      <div className="border-t border-border bg-background">
        {groups.map((g) => (
          <CategoryGroup
            key={g.category}
            tripId={tripId}
            category={g.category}
            items={g.items}
            members={members}
            editingId={editingId}
            onToggle={toggle}
            onStartEdit={setEditingId}
            onStopEdit={() => setEditingId(null)}
            onUpdate={update}
            onDelete={remove}
          />
        ))}

        <div className="px-5 pt-4 pb-6">
          <SuggestionCard label="/ suggested for Rinjani" expandable>
            Nights drop to 4°C at the crater.{" "}
            <span className="font-serif italic text-foreground">
              Consider a packable down layer + thermal liner.
            </span>
          </SuggestionCard>
        </div>
      </div>
    </section>
  )
}

function CategoryGroup({
  tripId,
  category,
  items,
  members,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
}: {
  tripId: string
  category: string
  items: PackingItem[]
  members: Record<string, MemberToneEntry>
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
}) {
  const done = items.filter((i) => i.done).length
  return (
    <div className="border-b border-border px-5 pt-4 pb-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <Label>{category}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {done} / {items.length}
        </span>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          member={members[item.addedBy]}
          isEditing={editingId === item.id}
          onToggle={() => onToggle(item.id)}
          onStartEdit={() => onStartEdit(item.id)}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      <AddItemRow tripId={tripId} category={category} />
    </div>
  )
}

function ItemRow({
  item,
  member,
  isEditing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
}: {
  item: PackingItem
  member?: MemberToneEntry
  isEditing: boolean
  onToggle: () => void
  onStartEdit: () => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: () => void
}) {
  if (isEditing) {
    return <ItemEditor item={item} onUpdate={onUpdate} onDone={onStopEdit} />
  }
  return (
    <div className="flex items-center gap-1">
      <CheckRow
        className="flex-1"
        done={item.done}
        label={item.label}
        who={member?.initial}
        whoTone={member?.tone ?? "sea"}
        tone="clay"
        onToggle={onToggle}
      />
      <button
        type="button"
        onClick={onStartEdit}
        aria-label="Edit item"
        className="border-0 bg-transparent px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete item"
        className="border-0 bg-transparent px-1.5 py-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
      >
        ×
      </button>
    </div>
  )
}

function ItemEditor({
  item,
  onUpdate,
  onDone,
}: {
  item: PackingItem
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDone: () => void
}) {
  const [value, setValue] = React.useState(item.label)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const label = value.trim()
    if (!label || pending) return
    setPending(true)
    setError(null)
    const result = await onUpdate(item.id, label)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone()
          }}
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-clay px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          save
        </button>
        <button
          type="button"
          onClick={onDone}
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

function AddItemRow({
  tripId,
  category,
}: {
  tripId: string
  category: string
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
    const label = value.trim()
    if (!label || pending) return
    setPending(true)
    setError(null)
    const result = await addPackingItem(tripId, category, label)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setValue("")
    inputRef.current?.focus()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="border-0 bg-transparent py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
      >
        + add item
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder={`Add to ${category.toLowerCase()}…`}
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-clay px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
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
