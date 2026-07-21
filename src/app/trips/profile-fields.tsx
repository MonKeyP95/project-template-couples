"use client"

import * as React from "react"

export function OptionRow({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-[15px] transition-colors ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-rule text-foreground hover:border-foreground"
      }`}
    >
      {label}
      <span
        className={`font-mono text-[13px] ${
          selected ? "text-background" : "text-muted-foreground"
        }`}
      >
        {selected ? "✓" : "+"}
      </span>
    </button>
  )
}

/** One category card: a header (name toggles expand, the cross removes it) and,
 * when expanded, its detail tags as removable chips plus an add input. Owns the
 * add-detail input's text state. Presentational only — the caller supplies the
 * name/details and the mutation callbacks (live actions or local state). */
export function CategoryCard({
  name,
  details,
  expanded,
  pending,
  onToggle,
  onRemove,
  onAddDetail,
  onRemoveDetail,
}: {
  name: string
  details: string[]
  expanded: boolean
  pending: boolean
  onToggle: () => void
  onRemove: () => void
  onAddDetail: (item: string) => void
  onRemoveDetail: (item: string) => void
}) {
  const [detail, setDetail] = React.useState("")

  function add() {
    const t = detail.trim()
    if (!t || pending) return
    if (!details.includes(t)) onAddDetail(t)
    setDetail("")
  }

  return (
    <div className="rounded-xl border border-rule">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left text-[15px] text-foreground"
        >
          {name}
          {details.length ? (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
              · {details.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={pending}
          aria-label={`Delete ${name}`}
          className="font-mono text-[15px] text-muted-foreground hover:text-clay disabled:opacity-50"
        >
          ×
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-rule px-4 py-3">
          {details.length ? (
            <div className="flex flex-wrap gap-1.5">
              {details.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => onRemoveDetail(d)}
                    disabled={pending}
                    aria-label={`Remove ${d}`}
                    className="text-muted-foreground hover:text-clay disabled:opacity-50"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="add specific…"
            disabled={pending}
            className="mt-2 w-full rounded-lg border border-dashed border-rule bg-transparent px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </div>
      ) : null}
    </div>
  )
}

export type LocalCategory = { name: string; details: string[] }

/** Browser-only category editor used at create time (no trip row exists yet, so
 * nothing writes until the page's single submit). Controlled: the parent holds
 * the list; this manages the new-category input and which row is expanded. */
export function LocalCategoryEditor({
  categories,
  onChange,
  disabled = false,
}: {
  categories: LocalCategory[]
  onChange: (next: LocalCategory[]) => void
  disabled?: boolean
}) {
  const [name, setName] = React.useState("")
  const [expanded, setExpanded] = React.useState<number | null>(null)

  function addCategory() {
    const t = name.trim()
    if (!t || disabled) return
    if (categories.some((c) => c.name === t)) {
      setName("")
      return
    }
    onChange([...categories, { name: t, details: [] }])
    setName("")
  }

  function removeCategory(i: number) {
    onChange(categories.filter((_, idx) => idx !== i))
    setExpanded(null)
  }

  function setDetails(i: number, details: string[]) {
    onChange(categories.map((c, idx) => (idx === i ? { ...c, details } : c)))
  }

  return (
    <div className="flex flex-col gap-2">
      {categories.map((c, i) => (
        <CategoryCard
          key={`${c.name}-${i}`}
          name={c.name}
          details={c.details}
          expanded={expanded === i}
          pending={disabled}
          onToggle={() => setExpanded((e) => (e === i ? null : i))}
          onRemove={() => removeCategory(i)}
          onAddDetail={(item) => setDetails(i, [...c.details, item])}
          onRemoveDetail={(item) =>
            setDetails(
              i,
              c.details.filter((d) => d !== item),
            )
          }
        />
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCategory()
            }
          }}
          placeholder="Add a category…"
          disabled={disabled}
          className="flex-1 rounded-xl border border-dashed border-rule bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addCategory}
          disabled={disabled || !name.trim()}
          className="rounded-xl border-0 bg-foreground px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          add
        </button>
      </div>
    </div>
  )
}
