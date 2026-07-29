import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { acceptInvite } from "@/lib/workspace/actions"
import { getInvitePreview } from "@/lib/invites/preview"
import { SignUpForm } from "@/app/signup/signup-form"

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

  // Unauthenticated + valid token → the invitation and the fields on one screen.
  return (
    <Shell>
      <h1 className="font-serif text-4xl tracking-tight">
        You&apos;ve been invited to join{" "}
        <span className="italic text-primary">{preview.workspaceName}</span>.
      </h1>
      <div className="mt-8 text-left">
        <SignUpForm invite={token} submitLabel="join" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/signin?invite=${token}`}
          className="text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
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
