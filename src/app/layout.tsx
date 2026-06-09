import type { Metadata } from "next"
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Instrument_Serif,
} from "next/font/google"
import "./globals.css"

import { WorldMapBg } from "@/components/together"
import { isDarkTheme } from "@/lib/theme"

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
})

const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
})

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Together — Plan trips together",
  description:
    "A calm shared space for couples and families to plan trips: itineraries, packing lists, ideas, dreams.",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const dark = await isDarkTheme()
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable} h-full antialiased${dark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <WorldMapBg className="fixed inset-0 -z-10 text-foreground/[0.07]" />
        {children}
      </body>
    </html>
  )
}
