import * as React from "react"
import {
  CloudFogIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  SunIcon,
} from "lucide-react"

/** Maps a WMO weather code (Open-Meteo's scheme) to a condition icon. */
function iconFor(code: number) {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnowIcon
  if (code >= 95) return CloudLightningIcon
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRainIcon
  if (code === 45 || code === 48) return CloudFogIcon
  if (code === 0) return SunIcon
  if (code === 1 || code === 2) return CloudSunIcon
  return CloudIcon
}

/** A weather-reflective color (oklch) for a WMO code, applied to the icon. */
function colorFor(code: number): string {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return "oklch(0.78 0.07 220)" // snow -- icy blue
  if (code >= 95) return "oklch(0.56 0.14 285)" // storm -- indigo
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return "oklch(0.60 0.13 240)" // rain -- blue
  if (code === 45 || code === 48) return "oklch(0.66 0.02 240)" // fog -- gray
  if (code === 0) return "oklch(0.80 0.14 85)" // clear -- gold
  if (code === 1 || code === 2) return "oklch(0.74 0.10 75)" // mostly clear -- warm
  return "oklch(0.62 0.035 240)" // cloudy -- slate
}

export interface WeatherIconProps {
  /** WMO weather code. */
  code: number
  className?: string
}

/** The one weather glyph: same icon and color everywhere a code is shown. */
export function WeatherIcon({ code, className }: WeatherIconProps) {
  return React.createElement(iconFor(code), {
    className,
    strokeWidth: 2,
    color: colorFor(code),
    "aria-hidden": true,
  })
}
