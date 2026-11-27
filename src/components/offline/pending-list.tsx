"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  markFailed,
  removeItem,
  useOutbox,
  type OutboxItemOf,
  type OutboxKind,
} from "@/lib/offline/outbox"
import { sendItem } from "@/lib/offline/send"

/** "waiting to send" list for one kind of on-the-road add; nothing when empty. */
export function PendingList<K extends OutboxKind>({
  kind,
  label,
}: {
  kind: K
  label: (item: OutboxItemOf<K>) => string
}) {
  const items = useOutbox(kind)
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  if (items.length === 0) return null

  function retry(item: OutboxItemOf<K>) {
    startTransition(async () => {
      try {
        const result = await sendItem(item)
        if (result.error) return markFailed(item.id, result.error)
        removeItem(item.id)
        router.refresh()
      } catch {
        markFailed(item.id, "send failed")
      }
    })
  }

  return (
    <div className="mt-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        waiting to send · {items.length}
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{label(item)}</span>
            {item.failed ? (
              <>
                <span className="font-mono text-[10px] text-clay">{item.failed}</span>
                <button
                  type="button"
                  onClick={() => retry(item)}
                  disabled={isPending}
                  className="font-mono text-[10px] uppercase tracking-[0.16em] hover:text-foreground disabled:opacity-40"
                >
                  retry
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              disabled={isPending}
              className="font-mono text-[10px] uppercase tracking-[0.16em] hover:text-foreground disabled:opacity-40"
            >
              remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
