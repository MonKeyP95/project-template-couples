"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Bar, CheckRow, Label, TopoBg } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addChecklistCategory,
  addChecklistItem,
  deleteChecklist,
  deleteChecklistCategory,
  deleteChecklistItem,
  renameChecklist,
  resetChecklist,
  toggleChecklistItem,
  updateChecklistItem,
} from "@/lib/checklists/actions"
import {
  groupChecklistItems,
  type ChecklistCategory,
  type ChecklistItem,
} from "@/lib/checklists/types"

interface RealtimeRow {
  id: string
  checklist_id: string
  category: string
  label: string
  done: boolean
  added_by: string
  created_at: string
}

function fromRow(row: RealtimeRow): ChecklistItem {
  return {
    id: row.id,
    checklistId: row.checklist_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }
}

export function ChecklistDetail({
  checklistId,
  slug,
  name,
  initialItems,
  initialCategories,
}: {
  checklistId: string
  slug: string
  name: string
  initialItems: ChecklistItem[]
  initialCategories: ChecklistCategory[]
}) {
  const router = useRouter()
  const [items, setItems] = React.useState(initialItems)
  const [lastItems, setLastItems] = React.useState(initialItems)
  const [categories, setCategories] = React.useState(initialCategories)
  const [lastCategories, setLastCategories] = React.useState(initialCategories)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastItems) {
    setLastItems(initialItems)
    setItems(initialItems)
  }
  if (initialCategories !== lastCategories) {
    setLastCategories(initialCategories)
    setCategories(initialCategories)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`checklist-${checklistId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "checklist_items",
          filter: `checklist_id=eq.${checklistId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)))
          } else if (payload.eventType === "INSERT") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) =>
              prev.some((i) => i.id === next.id) ? prev : [...prev, next],
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) setItems((prev) => prev.filter((i) => i.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [checklistId])

  async function toggle(id: string) {
    const current = items.find((i) => i.id === id)
    if (!current) return
    const next = !current.done
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: next } : i)))
    const result = await toggleChecklistItem(id, next)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, done: current.done } : i)),
      )
    }
  }

  async function update(
    id: string,
    label: string,
  ): Promise<{ error?: string }> {
    const current = items.find((i) => i.id === id)
    if (!current) return {}
    const trimmed = label.trim()
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, label: trimmed } : i)),
    )
    const result = await updateChecklistItem(id, trimmed)
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
    const result = await deleteChecklistItem(id)
    if (result.error) setItems(snapshot)
  }

  async function addCategory(catName: string): Promise<{ error?: string }> {
    const result = await addChecklistCategory(checklistId, slug, catName)
    if (result.error) return { error: result.error }
    if (result.category) {
      const created = result.category
      setCategories((prev) => [...prev, created])
    }
    return {}
  }

  async function removeCategory(
    categoryId: string,
    catName: string,
    count: number,
  ) {
    const msg =
      count > 0
        ? `Delete '${catName}' and its ${count} item${count === 1 ? "" : "s"}?`
        : `Delete '${catName}'?`
    if (!window.confirm(msg)) return
    const catSnapshot = categories
    const itemSnapshot = items
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    setItems((prev) => prev.filter((i) => i.category !== catName))
    const result = await deleteChecklistCategory(categoryId, slug)
    if (result.error) {
      setCategories(catSnapshot)
      setItems(itemSnapshot)
    }
  }

  async function reset() {
    if (!window.confirm("Uncheck everything in this checklist?")) return
    const snapshot = items
    setItems((prev) => prev.map((i) => ({ ...i, done: false })))
    const result = await resetChecklist(checklistId, slug)
    if (result.error) setItems(snapshot)
  }

  async function destroy() {
    if (!window.confirm(`Delete '${name}' and everything in it?`)) return
    const result = await deleteChecklist(checklistId)
    if (!result.error) router.push("/checklists")
  }

  const groups = groupChecklistItems(categories, items)
  const total = items.length
  const done = items.filter((i) => i.done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <section>
      <div className="relative overflow-hidden bg-sea-tint px-5 pt-6 pb-4">
        <TopoBg tone="sea" opacity={0.1} />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label>Checklist</Label>
            <ChecklistName name={name} slug={slug} checklistId={checklistId} />
            <div className="t-num mt-1 text-[14px] text-muted-foreground">
              {done} / {total} · {pct}%
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              reset
            </button>
            <button
              type="button"
              onClick={destroy}
              className="border-0 bg-transparent px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-clay"
            >
              delete
            </button>
          </div>
        </div>
        <div className="relative mt-3.5">
          <Bar pct={pct} tone="sea" />
        </div>
      </div>

      <div className="border-t border-border bg-background">
        {groups.map((g) => (
          <CategoryGroup
            key={g.categoryId ?? `orphan:${g.category}`}
            checklistId={checklistId}
            categoryId={g.categoryId}
            category={g.category}
            items={g.items}
            editingId={editingId}
            onToggle={toggle}
            onStartEdit={setEditingId}
            onStopEdit={() => setEditingId(null)}
            onUpdate={update}
            onDelete={remove}
            onDeleteCategory={removeCategory}
          />
        ))}

        <div className="px-5 pt-4 pb-6">
          <AddCategoryRow onAdd={addCategory} />
        </div>
      </div>
    </section>
  )
}

function ChecklistName({
  name,
  slug,
  checklistId,
}: {
  name: string
  slug: string
  checklistId: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(name)
  const [current, setCurrent] = React.useState(name)
  const [pending, setPending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next = value.trim()
    if (!next || pending) return
    if (next === current) {
      setEditing(false)
      return
    }
    setPending(true)
    const result = await renameChecklist(checklistId, slug, next)
    setPending(false)
    if (!result.error) {
      setCurrent(next)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="mt-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setValue(current)
              setEditing(false)
            }
          }}
          disabled={pending}
          className="t-display w-full border-0 border-b border-rule bg-transparent text-[30px] text-foreground focus:border-sea focus:outline-none"
        />
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(current)
        setEditing(true)
      }}
      className="mt-1 block text-left"
      aria-label="Rename checklist"
    >
      <span className="t-display text-[30px] text-foreground">
        <em>{current}</em>
      </span>
    </button>
  )
}

interface CategoryGroupProps {
  checklistId: string
  categoryId: string | null
  category: string
  items: ChecklistItem[]
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
  onDeleteCategory: (id: string, name: string, count: number) => void
}

function CategoryGroup({
  checklistId,
  categoryId,
  category,
  items,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onDeleteCategory,
}: CategoryGroupProps) {
  const done = items.filter((i) => i.done).length
  return (
    <div className="border-b border-border px-5 pt-4 pb-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <Label>{category}</Label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {done} / {items.length}
          </span>
          {categoryId ? (
            <button
              type="button"
              onClick={() => onDeleteCategory(categoryId, category, items.length)}
              aria-label="Delete category"
              className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          isEditing={editingId === item.id}
          onToggle={() => onToggle(item.id)}
          onStartEdit={() => onStartEdit(item.id)}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      <AddItemRow checklistId={checklistId} category={category} />
    </div>
  )
}

function ItemRow({
  item,
  isEditing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
}: {
  item: ChecklistItem
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
        tone="sea"
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
  item: ChecklistItem
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
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-sea focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
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
  checklistId,
  category,
}: {
  checklistId: string
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
    const result = await addChecklistItem(checklistId, category, label)
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

function AddCategoryRow({
  onAdd,
}: {
  onAdd: (name: string) => Promise<{ error?: string }>
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
    const result = await onAdd(name)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    reset()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add category
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="py-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder="New category, e.g. Shelter"
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
