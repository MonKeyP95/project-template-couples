"use client"

import * as React from "react"

import {
  LocalCategoryEditor,
  OptionRow,
  StepShell,
  type LocalCategory,
} from "./profile-fields"
import { TRIP_TRANSPORT, TRIP_VIBES } from "@/lib/trips/trip-profile-types"

const PROFILE_STEP_COUNT = 4

export interface ProfileWalkthroughValue {
  idea: string
  vibe: string[]
  vibeNote: string
  transport: string[]
  categories: LocalCategory[]
}

function toggled(list: string[], tag: string): string[] {
  return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
}

/** The trip-profile questions as a stepper — one question per screen, back and
 * next. Controlled: the parent holds every value and owns the save, so create
 * and edit each keep their own single submit. `extraStep` appends a final
 * screen, `footerAside` sits beside the nav on every step, and `finalAction`
 * replaces "next" once the last screen is showing. */
export function ProfileWalkthrough({
  value,
  onChange,
  disabled = false,
  extraStep,
  footerAside,
  finalAction,
}: {
  value: ProfileWalkthroughValue
  onChange: (patch: Partial<ProfileWalkthroughValue>) => void
  disabled?: boolean
  extraStep?: React.ReactNode
  footerAside?: React.ReactNode
  finalAction?: React.ReactNode
}) {
  const [step, setStep] = React.useState(0)
  const stepCount = PROFILE_STEP_COUNT + (extraStep ? 1 : 0)
  const onLastStep = step === stepCount - 1

  return (
    <div className="rounded-xl border border-rule p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          step {step + 1} of {stepCount}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: stepCount }).map((_, i) => (
            <span
              key={i}
              className={`h-1 w-6 rounded-full ${
                i <= step ? "bg-foreground" : "bg-rule"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 min-h-[220px]">
        {step === 0 ? (
          <StepShell title="Describe this trip in a few words">
            <textarea
              value={value.idea}
              onChange={(e) => onChange({ idea: e.target.value })}
              placeholder="e.g. 2 weeks surfing in Portugal"
              rows={3}
              disabled={disabled}
              className="w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </StepShell>
        ) : null}

        {step === 1 ? (
          <StepShell title="What's the vibe?" hint="Pick any that apply">
            {TRIP_VIBES.map((v) => (
              <OptionRow
                key={v}
                label={v}
                selected={value.vibe.includes(v)}
                onClick={() => onChange({ vibe: toggled(value.vibe, v) })}
              />
            ))}
            <input
              type="text"
              value={value.vibeNote}
              onChange={(e) => onChange({ vibeNote: e.target.value })}
              placeholder="In your own words…"
              maxLength={500}
              disabled={disabled}
              className="mt-3 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell
            title="What's this trip made of?"
            hint="Your categories — they shape the budget too"
          >
            <LocalCategoryEditor
              categories={value.categories}
              onChange={(categories) => onChange({ categories })}
              disabled={disabled}
            />
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell title="How will you get around?" hint="Pick any that apply">
            {TRIP_TRANSPORT.map((t) => (
              <OptionRow
                key={t}
                label={t}
                selected={value.transport.includes(t)}
                onClick={() =>
                  onChange({ transport: toggled(value.transport, t) })
                }
              />
            ))}
          </StepShell>
        ) : null}

        {step === PROFILE_STEP_COUNT ? extraStep : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || disabled}
          className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          back
        </button>
        <div className="flex items-center gap-2">
          {footerAside}
          {onLastStep && finalAction ? (
            finalAction
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(stepCount - 1, s + 1))}
              disabled={onLastStep || disabled}
              className="rounded-full border-0 bg-foreground px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
