import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "Repaso movil",
  description: "Mini app instalable para repaso movil",
  applicationName: "Repaso movil",
  manifest: "/mobile-review.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Repaso movil",
  },
  icons: {
    icon: [
      { url: "/mobile-review-icon.svg", type: "image/svg+xml" },
      { url: "/mobile-review-icon-maskable.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/mobile-review-icon.svg" }],
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f1e4a9",
}

export default function MobileReviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
