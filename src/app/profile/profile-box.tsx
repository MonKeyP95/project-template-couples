/** One titled card on the couple profile. */
export function ProfileBox({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}
