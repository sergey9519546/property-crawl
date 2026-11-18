import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.contactTitle || "Contact PerfectProperty | PerfectProperty",
    description: t.contactDesc,
    alternates: {
      canonical: "/contact",
    },
    openGraph: {
      title: t.contactTitle,
      description: t.contactDesc,
      url: "/contact",
      siteName: "PerfectProperty",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: t.contactTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t.contactTitle,
      description: t.contactDesc,
      images: ["/og-image.png"],
    },
  };
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
