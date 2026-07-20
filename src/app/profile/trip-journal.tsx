import type {
  JournalExpense,
  JournalLocation,
  JournalRecord,
} from "@/lib/journal/journal-types"

function euro(cents: number): string {
  return (cents / 100).toFixed(0)
}

function span(loc: JournalLocation): string {
  if (!loc.startDate || !loc.endDate) return ""
  return ` · ${loc.startDate} – ${loc.endDate}`
}

function ExpenseLine({ e }: { e: JournalExpense }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
      <span className="text-muted-foreground">
        {e.title} · {e.category}
      </span>
      <span className="text-foreground">€{euro(e.amountCents)}</span>
    </div>
  )
}

function settleUpLine(
  record: JournalRecord,
  memberNames: Record<string, string>,
): string {
  const s = record.totals.settleUp
  if (!s.creditorUserId || !s.debtorUserId || s.netBalanceCents === 0) {
    return "Settled up"
  }
  const debtor = memberNames[s.debtorUserId] ?? "Someone"
  const creditor = memberNames[s.creditorUserId] ?? "Someone"
  return `${debtor} owes ${creditor} €${euro(s.netBalanceCents)}`
}

export function TripJournal({
  record,
  memberNames,
}: {
  record: JournalRecord
  memberNames: Record<string, string>
}) {
  return (
    <div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Journal
      </p>

      {record.preTrip.length > 0 ? (
        <div className="mt-2">
          <p className="font-serif text-[15px] italic text-foreground">
            Before you go
          </p>
          <div className="mt-1 flex flex-col gap-1">
            {record.preTrip.map((p, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
              >
                <span className="text-muted-foreground">{p.title}</span>
                <span className="text-foreground">€{euro(p.amountCents)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {record.locations.map((loc) => (
        <div key={loc.id} className="mt-3">
          <p className="font-serif text-[15px] italic text-foreground">
            {loc.name}
            <span className="text-muted-foreground">{span(loc)}</span>
          </p>
          {loc.events.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1">
              {loc.events.map((ev, i) => (
                <div key={i} className="text-[13px] text-foreground">
                  {ev.text}
                  {ev.rating !== undefined ? (
                    <span className="text-muted-foreground"> · {ev.rating}/5</span>
                  ) : null}
                  {ev.note ? (
                    <span className="text-muted-foreground"> — {ev.note}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {loc.expenses.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1">
              {loc.expenses.map((e, i) => (
                <ExpenseLine key={i} e={e} />
              ))}
            </div>
          ) : null}
        </div>
      ))}

      {record.unplacedSpend.length > 0 ? (
        <div className="mt-3">
          <p className="font-serif text-[15px] italic text-foreground">
            Other spend
          </p>
          <div className="mt-1 flex flex-col gap-1">
            {record.unplacedSpend.map((e, i) => (
              <ExpenseLine key={i} e={e} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-1.5">
        {record.totals.perCategoryCents.map((c) => (
          <div
            key={c.category}
            className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
          >
            <span className="text-foreground">{c.category}</span>
            <span className="text-muted-foreground">€{euro(c.amountCents)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 border-t border-rule pt-1.5 font-mono text-[11px]">
          <span className="text-foreground">Total spent</span>
          <span className="text-foreground">
            €{euro(record.totals.totalSpentCents)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
          <span className="text-muted-foreground">Settle up</span>
          <span className="text-muted-foreground">
            {settleUpLine(record, memberNames)}
          </span>
        </div>
      </div>
    </div>
  )
}
