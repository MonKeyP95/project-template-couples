"use client"

import * as React from "react"

const ExpenseSavedContext = React.createContext<(() => void) | null>(null)

/** Called by expense forms after a successful save; null outside a closing box. */
export function useExpenseSaved(): (() => void) | null {
  return React.useContext(ExpenseSavedContext)
}

/** Closes the surrounding `<details>` box whenever an expense form inside it saves. */
export function CloseOnExpenseSaved({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const close = React.useCallback(() => {
    const box = ref.current?.closest("details")
    if (box) box.open = false
  }, [])
  return (
    <ExpenseSavedContext value={close}>
      <div ref={ref}>{children}</div>
    </ExpenseSavedContext>
  )
}
