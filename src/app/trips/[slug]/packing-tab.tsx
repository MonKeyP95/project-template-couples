"use client"

import * as React from "react"

import { CheckRow, Coord, Label, SuggestionCard, TopoBg } from "@/components/together"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { createClient } from "@/lib/supabase/client"
import {
  addPackingCategory,
  addPackingItem,
  copyPackingFromTrip,
  deletePackingCategory,
  deletePackingItem,
  reorderPackingCategories,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
import {
  groupPackingItems,
  partitionByOwner,
  type OwnerScope,
  type PackingCategory,
  type PackingItem,
} from "@/lib/trips/packing-types"

export interface MemberToneEntry {
  initial: string
  displayName: string
  tone: "sea" | "clay"
}

export interface PackingTabProps {
  tripId: string
  tripSlug: string
  currentUserId: string
  partnerId: string | null
  initialItems: PackingItem[]
  initialCategories: PackingCategory[]
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
  owner_id: string | null
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
    ownerId: row.owner_id,
    createdAt: row.created_at,
  }
}

type View = "mine" | "shared" | "partner"

export function PackingTab({
  tripId,
  tripSlug,
  currentUserId,
  partnerId,
  initialItems,
  initialCategories,
  members,
  daysOut,
}: PackingTabProps) {
  const [items, setItems] = React.useState<PackingItem[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [categories, setCategories] =
    React.useState<PackingCategory[]>(initialCategories)
  const [lastCategories, setLastCategories] = React.useState(initialCategories)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<View>("shared")
  const [partnerUnlocked, setPartnerUnlocked] = React.useState(false)

  // Sync local state when the server re-fetches (RefreshOnVisible after the tab
  // returns from background, where Realtime may have missed events).
  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setItems(initialItems)
  }
  if (initialCategories !== lastCategories) {
    setLastCategories(initialCategories)
    setCategories(initialCategories)
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
  }, [tripId])

  async function toggle(id: string) {
    const current = items.find((i) => i.id === id)
    if (!current) return
    const next = !current.done
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: next } : i)))
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

  async function addCategory(
    name: string,
    owner: string | null,
  ): Promise<{ error?: string }> {
    const result = await addPackingCategory(tripId, tripSlug, name, owner)
    if (result.error) return { error: result.error }
    if (result.category) {
      const created = result.category
      setCategories((prev) => [...prev, created])
    }
    return {}
  }

  async function removeCategory(
    categoryId: string,
    name: string,
    count: number,
    owner: string | null,
  ) {
    const msg =
      count > 0
        ? `Delete '${name}' and its ${count} item${count === 1 ? "" : "s"}?`
        : `Delete '${name}'?`
    if (!window.confirm(msg)) return

    const catSnapshot = categories
    const itemSnapshot = items
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    setItems((prev) =>
      prev.filter((i) => !(i.category === name && i.ownerId === owner)),
    )

    const result = await deletePackingCategory(categoryId, tripSlug)
    if (result.error) {
      setCategories(catSnapshot)
      setItems(itemSnapshot)
    }
  }

  const [, startReorder] = React.useTransition()

  function reorder(owner: string | null, orderedIds: string[]) {
    const snapshot = categories
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]))
    const reorderedScope = categories
      .filter((c) => c.ownerId === owner)
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
    let k = 0
    const next = categories.map((c) =>
      c.ownerId === owner ? reorderedScope[k++] : c,
    )
    setCategories(next)
    startReorder(async () => {
      const result = await reorderPackingCategories(tripSlug, orderedIds)
      if (result.error) setCategories(snapshot)
    })
  }

  const parts = partitionByOwner(categories, items, currentUserId, partnerId)
  const partnerName = partnerId ? members[partnerId]?.displayName ?? "Partner" : null
  const daysOutLabel = daysOut == null ? null : `${Math.max(0, daysOut)} days out`

  function openPartner() {
    if (!partnerName) return
    if (partnerUnlocked) {
      setView("partner")
      return
    }
    if (window.confirm(`This is ${partnerName}'s list — open it?`)) {
      setPartnerUnlocked(true)
      setView("partner")
    }
  }

  const active: { scope: OwnerScope; owner: string | null; readOnly: boolean } =
    view === "mine"
      ? { scope: parts.mine, owner: currentUserId, readOnly: false }
      : view === "partner"
        ? { scope: parts.partner, owner: partnerId, readOnly: true }
        : { scope: parts.shared, owner: null, readOnly: false }

  return (
    <section>
      <div className="relative overflow-hidden bg-clay-tint px-5 pt-6 pb-4">
        <TopoBg tone="clay" opacity={0.1} />
        <div className="relative flex items-start justify-between">
          <Label>Packing</Label>
          {daysOutLabel ? <Coord>{daysOutLabel}</Coord> : null}
        </div>
        <div className="relative mt-3 flex gap-1.5">
          <SegBtn active={view === "mine"} onClick={() => setView("mine")}>
            My list
          </SegBtn>
          <SegBtn active={view === "shared"} onClick={() => setView("shared")}>
            Shared
          </SegBtn>
          {partnerName ? (
            <SegBtn active={view === "partner"} onClick={openPartner}>
              {partnerName}&rsquo;s list
            </SegBtn>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border bg-background">
        <PackingList
          key={view}
          tripId={tripId}
          owner={active.owner}
          readOnly={active.readOnly}
          categories={active.scope.categories}
          items={active.scope.items}
          members={members}
          editingId={editingId}
          onToggle={toggle}
          onStartEdit={setEditingId}
          onStopEdit={() => setEditingId(null)}
          onUpdate={update}
          onDelete={remove}
          onAddCategory={addCategory}
          onRemoveCategory={removeCategory}
          onReorder={reorder}
          onCopyShared={(src) => copyPackingFromTrip(tripId, src, tripSlug)}
        />
      </div>
    </section>
  )
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors " +
        (active
          ? "border-clay bg-clay text-background"
          : "border-rule bg-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  )
}

interface PackingListProps {
  tripId: string
  owner: string | null
  readOnly: boolean
  categories: PackingCategory[]
  items: PackingItem[]
  members: Record<string, MemberToneEntry>
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
  onAddCategory: (name: string, owner: string | null) => Promise<{ error?: string }>
  onRemoveCategory: (
    id: string,
    name: string,
    count: number,
    owner: string | null,
  ) => void
  onReorder: (owner: string | null, orderedIds: string[]) => void
  onCopyShared: (sourceTripId: string) => Promise<{ error?: string }>
}

function PackingList({
  tripId,
  owner,
  readOnly,
  categories,
  items,
  members,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onAddCategory,
  onRemoveCategory,
  onReorder,
  onCopyShared,
}: PackingListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  const dndId = React.useId()

  const groups = groupPackingItems(categories, items)
  const sortableGroups = groups.filter((g) => g.categoryId)
  const orphanGroups = groups.filter((g) => !g.categoryId)

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = sortableGroups.map((g) => g.categoryId as string)
    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(owner, arrayMove(ids, oldIndex, newIndex))
  }

  if (readOnly) {
    if (groups.length === 0) {
      return (
        <div className="px-5 py-10 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          Nothing here yet
        </div>
      )
    }
    return (
      <>
        {groups.map((g) => (
          <CategoryGroup
            key={g.categoryId ?? `orphan:${g.category}`}
            tripId={tripId}
            owner={owner}
            readOnly
            categoryId={g.categoryId}
            category={g.category}
            items={g.items}
            members={members}
            editingId={editingId}
            onToggle={onToggle}
            onStartEdit={onStartEdit}
            onStopEdit={onStopEdit}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onDeleteCategory={onRemoveCategory}
          />
        ))}
      </>
    )
  }

  return (
    <>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={sortableGroups.map((g) => g.categoryId as string)}
          strategy={verticalListSortingStrategy}
        >
          {sortableGroups.map((g) => (
            <SortableCategoryGroup
              key={g.categoryId as string}
              id={g.categoryId as string}
              tripId={tripId}
              owner={owner}
              readOnly={false}
              categoryId={g.categoryId}
              category={g.category}
              items={g.items}
              members={members}
              editingId={editingId}
              onToggle={onToggle}
              onStartEdit={onStartEdit}
              onStopEdit={onStopEdit}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onDeleteCategory={onRemoveCategory}
            />
          ))}
        </SortableContext>
      </DndContext>

      {orphanGroups.map((g) => (
        <CategoryGroup
          key={`orphan:${g.category}`}
          tripId={tripId}
          owner={owner}
          readOnly={false}
          categoryId={null}
          category={g.category}
          items={g.items}
          members={members}
          editingId={editingId}
          onToggle={onToggle}
          onStartEdit={onStartEdit}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDeleteCategory={onRemoveCategory}
        />
      ))}

      <div className="px-5 pt-4">
        <AddCategoryRow onAdd={(name) => onAddCategory(name, owner)} />
      </div>

      {owner === null ? (
        <div className="px-5 pt-2">
          <ImportFromTripControl
            tripId={tripId}
            label="Copy packing from another trip"
            onCopy={onCopyShared}
          />
        </div>
      ) : null}

      <div className="px-5 pt-4 pb-6">
        <SuggestionCard label="/ suggested for Rinjani" expandable>
          Nights drop to 4°C at the crater.{" "}
          <span className="font-serif italic text-foreground">
            Consider a packable down layer + thermal liner.
          </span>
        </SuggestionCard>
      </div>
    </>
  )
}

interface CategoryGroupProps {
  tripId: string
  owner: string | null
  readOnly: boolean
  categoryId: string | null
  category: string
  items: PackingItem[]
  members: Record<string, MemberToneEntry>
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
  onDeleteCategory: (
    id: string,
    name: string,
    count: number,
    owner: string | null,
  ) => void
  dragHandle?: React.ReactNode
}

function CategoryGroup({
  tripId,
  owner,
  readOnly,
  categoryId,
  category,
  items,
  members,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onDeleteCategory,
  dragHandle,
}: CategoryGroupProps) {
  const done = items.filter((i) => i.done).length
  return (
    <div className="border-b border-border px-5 pt-4 pb-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {dragHandle}
          <Label>{category}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {done} / {items.length}
          </span>
          {categoryId && !readOnly ? (
            <button
              type="button"
              onClick={() =>
                onDeleteCategory(categoryId, category, items.length, owner)
              }
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
          member={members[item.addedBy]}
          readOnly={readOnly}
          isEditing={editingId === item.id}
          onToggle={() => onToggle(item.id)}
          onStartEdit={() => onStartEdit(item.id)}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      {readOnly ? null : (
        <AddItemRow tripId={tripId} owner={owner} category={category} />
      )}
    </div>
  )
}

function SortableCategoryGroup({
  id,
  ...rest
}: CategoryGroupProps & { id: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }

  const handle = (
    <button
      type="button"
      aria-label="Drag to reorder category"
      className="cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <CategoryGroup {...rest} dragHandle={handle} />
    </div>
  )
}

function ItemRow({
  item,
  member,
  readOnly,
  isEditing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
}: {
  item: PackingItem
  member?: MemberToneEntry
  readOnly: boolean
  isEditing: boolean
  onToggle: () => void
  onStartEdit: () => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: () => void
}) {
  if (isEditing && !readOnly) {
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
        onToggle={readOnly ? undefined : onToggle}
      />
      {readOnly ? null : (
        <>
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
        </>
      )}
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
  owner,
  category,
}: {
  tripId: string
  owner: string | null
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
    const result = await addPackingItem(tripId, category, label, owner)
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
          placeholder="New category, e.g. Medicines"
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
