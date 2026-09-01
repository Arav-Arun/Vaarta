import type { Metadata } from "next";
import { Geist, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const DESCRIPTION =
  "Vaarta builds you a pixel world that speaks the language you are learning. Walk it, talk to the people in it, and earn every clue by making yourself understood.";
const SOCIAL_DESCRIPTION = "Learn languages through play.";

const SOCIAL_IMAGE = {
  url: "/vaarta-opengraph.webp",
  width: 1734,
  height: 907,
  alt: `Vaarta — ${SOCIAL_DESCRIPTION}`,
};

/**
 * Absolute base for social-card URLs.
 *
 * `NEXT_PUBLIC_SITE_URL` wins when it is set; Vercel supplies its own host for
 * preview deploys; localhost is the last resort so `next build` does not warn.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Vaarta: learn a language by living in a world that speaks it",
    template: "%s · Vaarta",
  },
  description: DESCRIPTION,
  applicationName: "Vaarta",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
  },
  keywords: [
    "language learning",
    "speaking practice",
    "Hindi",
    "Marathi",
    "Tamil",
    "Telugu",
    "Bengali",
    "Kannada",
    "Malayalam",
    "Gujarati",
    "Punjabi",
    "Odia",
  ],
  openGraph: {
    type: "website",
    siteName: "Vaarta",
    title: "Vaarta",
    description: SOCIAL_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vaarta",
    description: SOCIAL_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased font-sans",
        geist.variable,
        bricolage.variable
      )}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
