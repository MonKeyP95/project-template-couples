"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createWorkspaceWithPeople } from "@/lib/workspace/actions"
import { StepShell } from "../../trips/profile-fields"

const STEPS = ["Name", "Travellers", "Review"]

const inputClass =
  "w-full rounded-md border border-rule bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground"

const pillButton =
  "rounded-full border border-rule px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40"

const solidButton =
  "rounded-full border-0 bg-foreground px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"

export function NewWorkspaceForm() {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [name, setName] = React.useState("")
  const [travellers, setTravellers] = React.useState<string[]>([""])
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const named = name.trim().length > 0
  const namedTravellers = travellers.map((t) => t.trim()).filter(Boolean)

  function setTraveller(i: number, value: string) {
    setTravellers((prev) => prev.map((t, j) => (j === i ? value : t)))
  }

  function removeTraveller(i: number) {
    setTravellers((prev) => prev.filter((_, j) => j !== i))
  }

  function create() {
    setError(null)
    startTransition(async () => {
      const result = await createWorkspaceWithPeople({ name, travellers })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push("/home")
      router.refresh()
    })
  }

  return (
    <div className="mt-7">
      <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {step + 1} of {STEPS.length} · {STEPS[step]}
      </div>

      {step === 0 ? (
        <StepShell
          title="Name this workspace"
          hint="who it is for, not where you are going"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Sarah & Mom"
            className={inputClass}
          />
        </StepShell>
      ) : null}

      {step === 1 ? (
        <StepShell
          title="Who else is travelling?"
          hint="people who will not use the app"
        >
          {travellers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={t}
                onChange={(e) => setTraveller(i, e.target.value)}
                maxLength={40}
                placeholder="Mom"
                className={inputClass}
              />
              {travellers.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeTraveller(i)}
                  aria-label={`Remove traveller ${i + 1}`}
                  className="text-[15px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setTravellers((prev) => [...prev, ""])}
            className="self-start font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            + another
          </button>

          <p className="mt-1 text-[13px] text-muted-foreground">
            Travelling with someone who wants their own login? Leave this empty
            and send them an invite from the workspace once it exists.
          </p>
        </StepShell>
      ) : null}

      {step === 2 ? (
        <StepShell title="Ready to create">
          <div className="rounded-lg border border-rule px-4 py-3">
            <div className="flex justify-between text-[14px]">
              <span className="text-muted-foreground">Name</span>
              <span className="text-foreground">{name.trim() || "—"}</span>
            </div>
            <div className="mt-1 flex justify-between text-[14px]">
              <span className="text-muted-foreground">Travellers</span>
              <span className="text-foreground">
                {namedTravellers.length > 0
                  ? namedTravellers.join(", ")
                  : "just you"}
              </span>
            </div>
          </div>
          {error ? (
            <p className="font-mono text-[10px] text-clay">{error}</p>
          ) : null}
        </StepShell>
      ) : null}

      <div className="mt-7 flex items-center justify-between border-t border-rule pt-4">
        <button
          type="button"
          onClick={() => (step === 0 ? router.back() : setStep(step - 1))}
          disabled={isPending}
          className={pillButton}
        >
          {step === 0 ? "cancel" : "back"}
        </button>

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            disabled={!named}
            className={solidButton}
          >
            next
          </button>
        ) : (
          <button
            type="button"
            onClick={create}
            disabled={!named || isPending}
            className={solidButton}
          >
            {isPending ? "…" : "create workspace"}
          </button>
        )}
      </div>
    </div>
  )
}
