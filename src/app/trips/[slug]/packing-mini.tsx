"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { togglePackingItem } from "@/lib/trips/actions"
import type { PackingItem } from "@/lib/trips/packing-types"

import { MiniRow } from "./trip-side-cards"

const AVATAR_TONE = { sea: "bg-sea", clay: "bg-clay" } as const

/** Right-rail packing card: the count and the first four unpacked items, tickable. */
export function PackingMini({
  items,
  owners,
}: {
  items: PackingItem[]
  owners: Record<string, { initial: string; tone: "sea" | "clay" }>
}) {
  const [done, setDone] = React.useState(
    () => new Set(items.filter((i) => i.done).map((i) => i.id)),
  )

  async function pack(id: string) {
    setDone((prev) => new Set(prev).add(id))
    const result = await togglePackingItem(id, true)
    if (result.error) {
      setDone((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const open = items.filter((i) => !done.has(i.id))
  const pct = items.length === 0 ? 0 : Math.round((done.size / items.length) * 100)
  return (
    <>
      <MiniRow label="Packed" value={`${done.size} / ${items.length}`} />
      <Bar pct={pct} tone="clay" />
      <Label className="mt-0.5">Still to pack</Label>
      {open.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">All packed.</p>
      ) : (
        open.slice(0, 4).map((item) => {
          const owner = item.ownerId ? owners[item.ownerId] : undefined
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => pack(item.id)}
              className="flex w-full items-center gap-2.5 text-left text-[13px] text-foreground"
            >
              <span className="size-4 shrink-0 rounded-[5px] border-[1.5px] border-clay" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {owner ? (
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-full font-mono text-[10px] text-background ${AVATAR_TONE[owner.tone]}`}
                >
                  {owner.initial}
                </span>
              ) : null}
            </button>
          )
        })
      )}
    </>
  )
}
