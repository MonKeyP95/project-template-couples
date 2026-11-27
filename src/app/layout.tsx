import type { Metadata } from "next"
import {
  Fredoka,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Instrument_Serif,
} from "next/font/google"
import "./globals.css"

import { VoyageSceneBg, WorldMapBg } from "@/components/together"
import { TimezoneCookie } from "@/components/timezone-cookie"
import { ServiceWorker } from "@/components/offline/service-worker"
import { AiModeProvider } from "@/components/ai-mode"
import { MoneyProvider } from "@/components/money-context"
import { getMoney } from "@/lib/money-server"
import { getTheme } from "@/lib/theme"

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

const voyage = Fredoka({
  variable: "--font-voyage",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
  const theme = await getTheme()
  const { locale } = await getMoney()
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable} ${voyage.variable} h-full antialiased${theme === "light" ? "" : ` ${theme}`}`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <TimezoneCookie />
        <ServiceWorker />
        <WorldMapBg className="fixed inset-0 -z-10 text-foreground/[0.07] voyage:hidden" />
        <VoyageSceneBg className="fixed inset-0 -z-10 hidden voyage:block" />
        <MoneyProvider locale={locale}>
          <AiModeProvider initialEnabled={false}>
            {children}
          </AiModeProvider>
        </MoneyProvider>
      </body>
    </html>
  )
}
