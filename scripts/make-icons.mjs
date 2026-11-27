// Renders the install icons into public/. Run: node scripts/make-icons.mjs
import { writeFile } from "node:fs/promises"
import { createElement as h } from "react"
import { ImageResponse } from "next/og.js"

for (const size of [192, 512]) {
  const icon = h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#00576a",
        color: "#f5efe7",
        fontSize: size * 0.62,
        fontFamily: "serif",
      },
    },
    "T",
  )
  const res = new ImageResponse(icon, { width: size, height: size })
  await writeFile(`public/icon-${size}.png`, Buffer.from(await res.arrayBuffer()))
}
