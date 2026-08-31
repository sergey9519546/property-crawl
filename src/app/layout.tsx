import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Arcade loads fonts via Google WebFont loader (webfont.js):
//   families: ["Droid Serif:400,400italic,700,700italic","Geist Mono:400",
//              "Inter:300,400,500,600,700","Press Start 2P:300,400,500,600,700"]
// Inter is available via next/font/google. Droid Serif is deprecated in
// next/font's font-data, so we load it (plus Geist Mono + Press Start 2P) via
// the same <link> approach arcade's WebFont loader uses.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PerfectProperty — Every distressed deal in America, in one feed",
  description:
    "11 federal, GSE, and county sources — HUD, Fannie, Freddie, VA, USDA, IRS, Treasury, sheriff sales, and more. AI reads the legal notice, scores the deal, and tells you what the catch is before you put up the deposit.",
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
  authors: [{ name: "PerfectProperty" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "PerfectProperty — Every distressed deal in America, in one feed",
    description:
      "11 federal, GSE, and county sources. AI reads the legal notice, scores the deal, and tells you what the catch is — before you put up the deposit.",
    siteName: "PerfectProperty",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PerfectProperty — Every distressed deal in America, in one feed",
    description:
      "11 federal, GSE, and county sources. AI reads the legal notice, scores the deal, and tells you what the catch is — before you put up the deposit.",
  },
};

import { SeoSchema } from "@/components/site/seo-schema";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Exact font families arcade loads, via Google Fonts CSS (same as WebFont loader) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Droid+Serif:ital,wght@0,400;0,700;1,400;1,700&family=Geist+Mono:wght@400&family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
        <SeoSchema />
      </head>
      <body className="antialiased bg-[#F5F6F7] text-[#111827]">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
