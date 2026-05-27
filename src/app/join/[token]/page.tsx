import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { acceptInvite } from "@/lib/workspace/actions"
import { getInvitePreview } from "@/lib/invites/preview"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const preview = await getInvitePreview(token)

  if (!preview) {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight">This invite doesn&apos;t exist.</h1>
        <Home />
      </Shell>
    )
  }

  if (!preview.valid) {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight">This invite has expired.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ask {preview.workspaceName ? `the owner of ${preview.workspaceName}` : "the inviter"} for a fresh link.
        </p>
        <Home />
      </Shell>
    )
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (userData.user) {
    const result = await acceptInvite(token)
    if (result.error) {
      return (
        <Shell>
          <h1 className="font-serif text-4xl tracking-tight">Can&apos;t join this workspace.</h1>
          <p className="mt-3 text-sm text-muted-foreground">{result.error}</p>
          <Home />
        </Shell>
      )
    }
    redirect("/home")
  }

  // Unauthenticated + valid token → sign-up/sign-in card.
  return (
    <Shell>
      <h1 className="font-serif text-4xl tracking-tight">
        You&apos;ve been invited to join{" "}
        <span className="italic text-primary">{preview.workspaceName}</span>.
      </h1>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href={`/signup?invite=${token}`} className={cn(buttonVariants({ size: "lg" }), "flex-1")}>
          Sign up
        </Link>
        <Link
          href={`/signin?invite=${token}`}
          className={cn(buttonVariants({ size: "lg", variant: "outline" }), "flex-1")}
        >
          Sign in
        </Link>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">{children}</div>
    </main>
  )
}

function Home() {
  return (
    <Link
      href="/"
      className="mt-8 inline-block font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
    >
      Go home
    </Link>
  )
}
