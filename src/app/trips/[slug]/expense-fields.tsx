"use client"

import * as React from "react"

import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { CategorySelect } from "./category-select"
import type { MemberToneEntry } from "./packing-tab"
import type { ItineraryLocation } from "@/lib/trips/location-types"

export interface ExpenseFieldsProps {
  title: string
  onTitleChange: (value: string) => void
  titleRef?: React.Ref<HTMLInputElement>
  amount: string
  onAmountChange: (value: string) => void
  dayDate: string | null
  onDayDateChange: (value: string | null) => void
  categories: ExpenseCategoryRow[]
  category: string
  onCategoryChange: (value: string) => void
  tripId: string
  tripSlug: string
  paidBy: string
  onPaidByChange: (value: string) => void
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  locationId: string | null
  onLocationChange: (value: string | null) => void
  disabled: boolean
}

/**
 * Shared controlled fields for an expense (title + amount/day/category/paid-by).
 * Used by both the add form (LogExpenseRow) and the inline edit form (LedgerRow)
 * so the two stay in visual lockstep.
 */
export function ExpenseFields({
  title,
  onTitleChange,
  titleRef,
  amount,
  onAmountChange,
  dayDate,
  onDayDateChange,
  categories,
  category,
  onCategoryChange,
  tripId,
  tripSlug,
  paidBy,
  onPaidByChange,
  members,
  locations,
  locationId,
  onLocationChange,
  disabled,
}: ExpenseFieldsProps) {
  const memberEntries = Object.entries(members)
  const usePillToggle = memberEntries.length === 2

  return (
    <>
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Add an expense…"
        disabled={disabled}
        className="w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Amount
          </span>
          <div className="mt-1 flex items-baseline gap-1.5 border-b border-rule pb-1 focus-within:border-clay">
            <span className="font-mono text-[14px] text-muted-foreground">€</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="0.00"
              disabled={disabled}
              className="t-num w-full border-0 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
          </div>
        </label>

        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Date
          </span>
          <input
            type="date"
            value={dayDate ?? ""}
            onChange={(e) =>
              onDayDateChange(e.target.value === "" ? null : e.target.value)
            }
            disabled={disabled}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <div className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Category
          </span>
          <CategorySelect
            categories={categories}
            value={category}
            onChange={onCategoryChange}
            tripId={tripId}
            tripSlug={tripSlug}
            disabled={disabled}
          />
        </div>

        <div className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Paid by
          </span>
          {usePillToggle ? (
            <div className="mt-1 inline-flex rounded-full border border-border bg-background p-0.5">
              {memberEntries.map(([userId, m]) => {
                const active = userId === paidBy
                return (
                  <button
                    key={userId}
                    type="button"
                    onClick={() => onPaidByChange(userId)}
                    disabled={disabled}
                    aria-pressed={active}
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                      active
                        ? m.tone === "sea"
                          ? "bg-sea text-background"
                          : "bg-clay text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.initial}
                  </button>
                )
              })}
            </div>
          ) : (
            <Select
              value={paidBy}
              onValueChange={(value) => {
                if (value) onPaidByChange(value)
              }}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue>
                  {(value: string | null) =>
                    memberEntries.find(([id]) => id === value)?.[1]
                      .displayName ?? ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {memberEntries.map(([userId, m]) => (
                  <SelectItem key={userId} value={userId}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Location
          </span>
          <Select<string | null>
            value={locationId}
            onValueChange={(value) => onLocationChange(value)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue>
                {(value: string | null) =>
                  value === null
                    ? "Auto (by date)"
                    : (locations.find((l) => l.id === value)?.name ??
                      "Auto (by date)")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Auto (by date)</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </>
  )
}
