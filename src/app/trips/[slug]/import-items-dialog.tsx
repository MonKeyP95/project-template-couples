"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  copyChecklistToPacking,
  copyPackingFromTrip,
  getImportableChecklists,
  getImportableTrips,
  type ImportableTrip,
} from "@/lib/trips/actions"

type Step = "choose" | "trip" | "checklist"
type Scope = "mine" | "shared"

export function ImportItemsDialog({
  open,
  onOpenChange,
  tripId,
  tripSlug,
  currentUserId,
  defaultTarget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripId: string
  tripSlug: string
  currentUserId: string
  defaultTarget: Scope
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import items</DialogTitle>
        </DialogHeader>
        {open ? (
          <ImportItemsBody
            tripId={tripId}
            tripSlug={tripSlug}
            currentUserId={currentUserId}
            defaultTarget={defaultTarget}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ImportItemsBody({
  tripId,
  tripSlug,
  currentUserId,
  defaultTarget,
  onDone,
}: {
  tripId: string
  tripSlug: string
  currentUserId: string
  defaultTarget: Scope
  onDone: () => void
}) {
  const [step, setStep] = React.useState<Step>("choose")
  const [target, setTarget] = React.useState<Scope>(defaultTarget)
  const [trips, setTrips] = React.useState<ImportableTrip[]>([])
  const [checklists, setChecklists] = React.useState<ImportableTrip[]>([])
  const [selected, setSelected] = React.useState("")
  const [sourceMine, setSourceMine] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function chooseTrip() {
    setStep("trip")
    setError(null)
    startTransition(async () => {
      const list = await getImportableTrips(tripId)
      setTrips(list)
      setSelected(list[0]?.id ?? "")
    })
  }

  function chooseChecklist() {
    setStep("checklist")
    setError(null)
    startTransition(async () => {
      const list = await getImportableChecklists()
      setChecklists(list)
      setSelected(list[0]?.id ?? "")
    })
  }

  function back() {
    setStep("choose")
    setSelected("")
    setError(null)
  }

  function runImport() {
    if (!selected) return
    setError(null)
    const targetOwner = target === "mine" ? currentUserId : null
    startTransition(async () => {
      const result =
        step === "trip"
          ? await copyPackingFromTrip(
              tripId,
              selected,
              sourceMine ? currentUserId : null,
              targetOwner,
              tripSlug,
            )
          : await copyChecklistToPacking(tripId, selected, targetOwner, tripSlug)
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  if (step === "choose") {
    return (
      <div className="grid gap-2">
        <ChoiceButton onClick={chooseTrip}>From a trip</ChoiceButton>
        <ChoiceButton onClick={chooseChecklist}>From a checklist</ChoiceButton>
      </div>
    )
  }

  const sources = step === "trip" ? trips : checklists
  const emptyText =
    step === "trip"
      ? "No other trips to copy from."
      : "No checklists to copy from."

  return (
    <div className="grid gap-3">
      <ScopeToggle
        label="To"
        value={target}
        options={[
          { value: "mine", label: "My list" },
          { value: "shared", label: "Shared" },
        ]}
        onChange={setTarget}
      />

      {sources.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          {isPending ? "Loading…" : emptyText}
        </p>
      ) : (
        <Select
          value={selected}
          onValueChange={(v) => setSelected(v ?? "")}
          disabled={isPending}
        >
          <SelectTrigger className="mt-0 w-full text-[13px]">
            <SelectValue>
              {(value: string | null) =>
                sources.find((s) => s.id === value)?.name ?? ""
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {step === "trip" ? (
        <ScopeToggle
          label="From"
          value={sourceMine ? "mine" : "shared"}
          options={[
            { value: "shared", label: "Shared" },
            { value: "mine", label: "My list" },
          ]}
          onChange={(v) => setSourceMine(v === "mine")}
        />
      ) : null}

      {error ? (
        <p className="font-mono text-[10px] text-clay">{error}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={isPending}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          back
        </button>
        <button
          type="button"
          onClick={runImport}
          disabled={isPending || !selected}
          className="rounded-md border-0 bg-clay px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "import"}
        </button>
      </div>
    </div>
  )
}

function ChoiceButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-rule px-4 py-3 text-left text-[14px] text-foreground hover:border-clay hover:bg-clay-tint"
    >
      {children}
    </button>
  )
}

function ScopeToggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Scope
  options: { value: Scope; label: string }[]
  onChange: (value: Scope) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={
              "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors " +
              (value === o.value
                ? "border-clay bg-clay text-background"
                : "border-rule bg-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
