"use client"

import * as React from "react"

import {
  Bar,
  CheckRow,
  Chevron,
  Coord,
  Label,
  TopoBg,
} from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import { togglePackingItem } from "@/lib/trips/actions"
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
            category={g.category}
            items={g.items}
            members={members}
            onToggle={toggle}
          />
        ))}

        <div className="px-5 pt-4 pb-6">
          <div className="rounded-lg border border-border bg-card border-l-[3px] border-l-moss px-3.5 py-3">
            <div className="flex items-center justify-between">
              <Label className="text-moss">/ suggested for Rinjani</Label>
              <Chevron dir="down" />
            </div>
            <div className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">
              Nights drop to 4°C at the crater.{" "}
              <span className="font-serif italic text-foreground">
                Consider a packable down layer + thermal liner.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CategoryGroup({
  category,
  items,
  members,
  onToggle,
}: {
  category: string
  items: PackingItem[]
  members: Record<string, MemberToneEntry>
  onToggle: (id: string) => void
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
      {items.map((item) => {
        const member = members[item.addedBy]
        return (
          <CheckRow
            key={item.id}
            done={item.done}
            label={item.label}
            who={member?.initial}
            whoTone={member?.tone ?? "sea"}
            tone="clay"
            onToggle={() => onToggle(item.id)}
          />
        )
      })}
      <button
        type="button"
        className="border-0 bg-transparent py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
      >
        + add item
      </button>
    </div>
  )
}
