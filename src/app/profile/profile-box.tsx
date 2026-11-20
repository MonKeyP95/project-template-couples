/** How filled-in a box is: clay while there is something left to add. */
export interface BoxStatus {
  label: string
  done: boolean
}

/** One titled card on the couple profile, with an optional status marker. */
export function ProfileBox({
  title,
  status,
  children,
}: {
  title: string
  status?: BoxStatus
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
        {status ? (
          <span
            className={
              status.done
                ? "text-xs text-muted-foreground"
                : "text-xs text-clay"
            }
          >
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}
