# Collapsible itinerary empty-day ranges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold a run of consecutive empty days inside an open itinerary location into a single collapsible range row (e.g. `08 Jun – 11 Jun · 4 empty days`), collapsed by default, that expands to the existing per-date empty buttons.

**Architecture:** Pure rendering change in one client component. After the existing date-sorted `items` array is built inside the open-location block, coalesce neighbouring `empty` items into runs; render length-1 runs as the current single button and length-≥2 runs as a chevron-toggled range row. One `Set<string>` of expanded run keys holds the toggle state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5. Single file: `src/app/trips/[slug]/itinerary-tab.tsx`. No DB, no actions, no helper changes.

**Note on testing:** This repo has no test suite (per `CLAUDE.md` — do not invent a test command). Each task is verified with `pnpm build` and `pnpm lint`, plus a manual viewing step at the end. Commit after each task.

**Spec:** `docs/superpowers/specs/2026-06-09-itinerary-empty-day-ranges-design.md`

---

### Task 1: Extract `EmptyDayButton` + add run-expand state

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

The single empty-day button markup is currently inlined in the open-location render. Extract it to a small component so both the length-1 case and the expanded length-≥2 case reuse it. Also add the expand-state set and its toggle, alongside the existing `collapsed` set / `toggleCollapse`.

- [ ] **Step 1: Add the `expandedRuns` state and `toggleRun`**

Find the existing collapse state and toggle (around lines 224 and 335):

```tsx
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
```

Add an `expandedRuns` set right after it:

```tsx
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [expandedRuns, setExpandedRuns] = React.useState<Set<string>>(new Set())
```

Then find `toggleCollapse`:

```tsx
  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
```

Add `toggleRun` immediately after it:

```tsx
  function toggleRun(key: string) {
    setExpandedRuns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
```

- [ ] **Step 2: Add the `EmptyDayButton` component**

At the top level of the file (after the `DaySegmentView` function, before `interface DayCardProps`), add:

```tsx
function EmptyDayButton({
  date,
  onFill,
}: {
  date: string
  onFill: (date: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onFill(date)}
      className="my-1 flex w-full items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2 text-left transition-colors hover:border-foreground"
    >
      <span className="t-num w-12 flex-shrink-0 font-mono text-[11px] text-muted-foreground">
        {formatShortDate(date)}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        empty
      </span>
      <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground/70">
        +
      </span>
    </button>
  )
}
```

(This is the exact markup currently inlined for an empty date, lifted verbatim, with the `onClick` body passed in via `onFill`.)

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds (the new component is unused for now — that is fine, the next task wires it in; if lint flags it as unused, complete Task 2 before re-running).

Run: `pnpm lint`
Expected: no errors. If `EmptyDayButton` is reported as unused-but-defined, proceed to Task 2 (it gets used there) and re-lint at the end of Task 2.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): EmptyDayButton component + run-expand state"
```

---

### Task 2: Coalesce empties into runs and render range rows

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (the open-location render block, currently ~643–725)

The block builds a date-sorted `items` array of `seg`/`empty` items, then maps each to JSX. Replace the tail of that IIFE: after `items` is sorted, coalesce adjacent `empty` items into runs and render runs (length 1 → `EmptyDayButton`; length ≥ 2 → collapsible range row).

- [ ] **Step 1: Replace the render tail of the open-location IIFE**

Find this exact block (the sorted `items` builder followed by `return items.map(...)`):

```tsx
                      const items: Item[] = [
                        ...segs.map((seg) => ({
                          kind: "seg" as const,
                          key: seg.days[0].dayDate,
                          seg,
                        })),
                        ...empties.map((date) => ({
                          kind: "empty" as const,
                          key: date,
                          date,
                        })),
                      ].sort((a, b) =>
                        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
                      )

                      return items.map((item) => {
                        if (item.kind === "empty") {
                          const gd = item.date
                          return (
                            <button
                              type="button"
                              key={`empty-${gd}`}
                              onClick={() => {
                                setAddDayDate(gd)
                                setAddDayFor(group.key)
                              }}
                              className="my-1 flex w-full items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2 text-left transition-colors hover:border-foreground"
                            >
                              <span className="t-num w-12 flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                                {formatShortDate(gd)}
                              </span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                                empty
                              </span>
                              <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground/70">
                                +
                              </span>
                            </button>
                          )
                        }
                        const seg = item.seg
                        return (
                          <DaySegmentView
                            key={seg.groupId ?? seg.days[0].id}
                            seg={seg}
                            tripId={tripId}
                            tripSlug={tripSlug}
                            lastDayId={last.id}
                            editingId={editingId}
                            setEditingId={setEditingId}
                            locations={locations}
                          />
                        )
                      })
```

Replace it with this — same `items` builder, then a coalescing pass into `rows`, then a render over `rows`:

```tsx
                      const items: Item[] = [
                        ...segs.map((seg) => ({
                          kind: "seg" as const,
                          key: seg.days[0].dayDate,
                          seg,
                        })),
                        ...empties.map((date) => ({
                          kind: "empty" as const,
                          key: date,
                          date,
                        })),
                      ].sort((a, b) =>
                        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
                      )

                      // Adjacent empty items in the date-sorted list are always
                      // calendar-consecutive (any occupied date is a seg between
                      // them), so neighbours coalesce into one run.
                      type Row =
                        | { kind: "seg"; seg: (typeof segs)[number] }
                        | { kind: "emptyRun"; dates: string[] }
                      const rows: Row[] = []
                      for (const item of items) {
                        if (item.kind === "empty") {
                          const tail = rows[rows.length - 1]
                          if (tail && tail.kind === "emptyRun") {
                            tail.dates.push(item.date)
                          } else {
                            rows.push({ kind: "emptyRun", dates: [item.date] })
                          }
                        } else {
                          rows.push({ kind: "seg", seg: item.seg })
                        }
                      }

                      const fillEmpty = (date: string) => {
                        setAddDayDate(date)
                        setAddDayFor(group.key)
                      }

                      return rows.map((row) => {
                        if (row.kind === "emptyRun") {
                          const { dates } = row
                          if (dates.length === 1) {
                            return (
                              <EmptyDayButton
                                key={`empty-${dates[0]}`}
                                date={dates[0]}
                                onFill={fillEmpty}
                              />
                            )
                          }
                          const runKey = `${group.key}:${dates[0]}`
                          const expanded = expandedRuns.has(runKey)
                          const label = `${formatShortDate(dates[0])} – ${formatShortDate(
                            dates[dates.length - 1],
                          )}`
                          return (
                            <div key={`emptyrun-${dates[0]}`} className="my-1">
                              <button
                                type="button"
                                onClick={() => toggleRun(runKey)}
                                aria-expanded={expanded}
                                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2 text-left transition-colors hover:border-foreground"
                              >
                                <span className="t-num flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                                  {label}
                                </span>
                                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                                  {dates.length} empty days
                                </span>
                                <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground">
                                  {expanded ? "⌄" : "›"}
                                </span>
                              </button>
                              {expanded ? (
                                <div className="pl-4">
                                  {dates.map((d) => (
                                    <EmptyDayButton
                                      key={d}
                                      date={d}
                                      onFill={fillEmpty}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )
                        }
                        const seg = row.seg
                        return (
                          <DaySegmentView
                            key={seg.groupId ?? seg.days[0].id}
                            seg={seg}
                            tripId={tripId}
                            tripSlug={tripSlug}
                            lastDayId={last.id}
                            editingId={editingId}
                            setEditingId={setEditingId}
                            locations={locations}
                          />
                        )
                      })
```

- [ ] **Step 2: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds. If it fails on JSX nesting, re-check the IIFE close (`})()}`) further down is untouched — only the inner `return` was replaced.

Run: `pnpm lint`
Expected: no errors. `EmptyDayButton` is now used. The original `Item` type (defined just above the replaced block) is still used by the `items` builder.

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): fold consecutive empty days into a collapsible range"
```

---

### Task 3: Manual verification + docs

**Files:** manual, then `docs/TODO.md`.

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev`
Open a trip's itinerary tab at http://localhost:3000 and open a location that has a multi-day gap (or a wide date span with few days).

- [ ] **Step 2: Verify the range row**

Confirm a run of 2+ consecutive empty days shows as ONE dashed row labelled `{first} – {last} · {n} empty days` with a `›` chevron, collapsed by default. Click it: it expands to the individual dated empty buttons, chevron becomes `⌄`. Click again: it collapses.

- [ ] **Step 3: Verify fill still works**

With a range expanded, click one dated empty button. Confirm the add-day form opens pre-filled to that date and saving adds the day there.

- [ ] **Step 4: Verify single empties unchanged**

Confirm a lone empty day (a one-date gap) still renders as the plain dashed `date · empty · +` button with no chevron.

- [ ] **Step 5: Update docs**

Add a row to `docs/TODO.md` noting collapsible empty-day ranges are done, referencing the spec.

```bash
git add docs/TODO.md
git commit -m "docs: record collapsible itinerary empty-day ranges done"
```

---

## Self-Review

- **Spec coverage:** Fold runs into a collapsible range (Task 2), collapsed-by-default via `expandedRuns` set (Task 1+2), single empties unchanged (Task 2 length-1 branch), European date label via `formatShortDate` (Task 2), reused dashed/chevron styling (Task 1 component + Task 2 row). All spec behaviours mapped. ✓
- **Placeholder scan:** every code step shows the full code; no TBD/TODO. ✓
- **Type consistency:** `EmptyDayButton({ date, onFill })` defined in Task 1 and called with those props in Task 2; `toggleRun`/`expandedRuns` defined in Task 1 and used in Task 2; `Row` type local to the IIFE; `Item` type (pre-existing, just above) still used. ✓
- **No DB/actions:** confirmed pure rendering; no schema or server-action edits. ✓
