import { TripChat } from "./trip-chat"

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <>
      {children}
      <TripChat tripSlug={slug} />
    </>
  )
}
