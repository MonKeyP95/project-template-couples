/** The home page's start point. What you type opens the new trip form with it
 * as the note; dates or no dates decide later whether it is a trip or a dream. */
export function NewBox({ className = "" }: { className?: string }) {
  return (
    <form
      action="/trips/new"
      className={`flex items-center gap-1.5 rounded-[10px] border border-transparent bg-sea-tint py-2 pr-2.5 pl-4 ${className}`}
    >
      <label
        htmlFor="new-adventure"
        className="mr-1.5 shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-foreground"
      >
        New adventure
      </label>
      <input
        id="new-adventure"
        name="note"
        type="text"
        placeholder="Where next?"
        className="w-0 min-w-0 flex-1 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full border border-transparent bg-clay-tint px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground transition-colors hover:border-rule"
      >
        Start
      </button>
    </form>
  )
}
