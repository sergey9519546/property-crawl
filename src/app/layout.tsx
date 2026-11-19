import type { Metadata } from "next";
import { Inter, Geist_Mono, Noto_Sans_Armenian } from "next/font/google";
import { connection } from "next/server";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SeoSchema } from "@/components/site/seo-schema";
import { NonceProvider } from "@/components/security/nonce-context";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { LOCALE_META } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

// Arcade loads fonts via Google WebFont loader (webfont.js):
//   families: ["Droid Serif:400,400italic,700,700italic","Geist Mono:400",
//              "Inter:300,400,500,600,700","Press Start 2P:300,400,500,600,700"]
// Inter + Geist Mono + Noto Sans Armenian are self-hosted via next/font/google.
// Droid Serif is deprecated in next/font's font-data, so it stays on a Google Fonts
// CSS <link> (used by .font-serif-arcade testimonial quotes).
const inter = Inter({
  subsets: ["latin", "cyrillic"],
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

const notoSansArmenian = Noto_Sans_Armenian({
  subsets: ["armenian"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-armenian",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);

  return {
    title: locale === "en" ? "Distressed Property & Sheriff Sales | PerfectProperty" : m.meta.homeTitle,
    description: m.meta.homeDescription,
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
    metadataBase: new URL((process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_ORIGIN || "https://perfectproperty.bid").replace(/\/+$/, "")),
    alternates: {
      canonical: "/",
    },
    authors: [{ name: "PerfectProperty" }],
    category: "Real Estate",
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    icons: {
      icon: "/logo-icon.svg",
      apple: "/logo-icon.png",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      title: locale === "en" ? "Distressed Property & Sheriff Sales | PerfectProperty" : m.meta.homeTitle,
      description: m.meta.homeDescription,
      url: "/",
      siteName: "PerfectProperty",
      locale: LOCALE_META[locale].ogLocale,
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "PerfectProperty - Distressed Property & Sheriff Sales Intelligence",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: locale === "en" ? "Distressed Property & Sheriff Sales | PerfectProperty" : m.meta.homeTitle,
      description: m.meta.homeDescription,
      images: ["/og-image.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonces require a request. Static shells cannot carry a fresh nonce.
  await connection();
  const nonce = (await headers()).get("x-nonce");
  const locale = await getRequestLocale();
  const m = getMessages(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${notoSansArmenian.variable}`}
    >
      <head>
        {/* Droid Serif only — Inter, Geist Mono, and Noto Sans Armenian are self-hosted via next/font. */}
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
        <SeoSchema nonce={nonce} locale={locale} />
      </head>
      <body className="antialiased bg-paper text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2 focus:text-xs focus:font-bold focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {locale === "en" ? "Skip to main content" : m.common.skipToContent}
        </a>
        <NonceProvider nonce={nonce}>
          <LocaleProvider initialLocale={locale}>
            {children}
            <Toaster />
          </LocaleProvider>
        </NonceProvider>
      </body>
    </html>
  );
}
