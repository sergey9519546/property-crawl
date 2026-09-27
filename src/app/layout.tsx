import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SeoSchema } from "@/components/site/seo-schema";

// Arcade loads fonts via Google WebFont loader (webfont.js):
//   families: ["Droid Serif:400,400italic,700,700italic","Geist Mono:400",
//              "Inter:300,400,500,600,700","Press Start 2P:300,400,500,600,700"]
// Inter + Geist Mono are self-hosted via next/font/google. Droid Serif is
// deprecated in next/font's font-data, so it stays on a Google Fonts CSS
// <link> (used by .font-serif-arcade testimonial quotes). Press Start 2P was
// never referenced by any component and is not loaded at all.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PerfectProperty — Find the opportunity that changed",
  description:
    "A private property-research workspace that connects source observations, evidence conflicts, saved criteria, Second Look reconsideration, and reproducible decision packets.",
  keywords: [
    "PerfectProperty",
    "distressed property",
    "foreclosure auctions",
    "sheriff sales",
    "HUD homes",
    "Fannie Mae HomePath",
    "Freddie Mac HomeSteps",
    "USDA REO",
    "VA REO",
    "IRS seized property",
    "Treasury forfeiture",
    "US Marshals",
    "GSA surplus",
    "deal scoring",
    "ARV",
    "off-market",
    "real estate investing",
  ],
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://property-crawl.com"),
  authors: [{ name: "PerfectProperty" }],
  icons: {
    icon: "/logo-icon.svg",
    apple: "/logo-icon.png",
  },
  openGraph: {
    title: "PerfectProperty — Find the opportunity that changed",
    description:
      "Follow source evidence, understand what changed, and bring passed properties back when the facts meet your rules.",
    siteName: "PerfectProperty",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PerfectProperty — Find the opportunity that changed",
    description:
      "Follow source evidence, understand what changed, and bring passed properties back when the facts meet your rules.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonces require a request. Static shells cannot carry a fresh nonce.
  await connection();
  const nonce = (await headers()).get("x-nonce");

  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable}`}>
      <head>
        {/* Droid Serif only — Inter and Geist Mono are self-hosted via next/font. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Droid+Serif:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
        <SeoSchema nonce={nonce} />
      </head>
      <body className="antialiased bg-[#F5F6F7] text-[#111827]">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
