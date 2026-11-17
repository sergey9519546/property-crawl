import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact PerfectProperty | PerfectProperty",
  description:
    "Contact PerfectProperty to report a listing issue, request county coverage, or ask about membership and team access.",
  alternates: {
    canonical: "/contact",
  },
  openGraph: {
    title: "Contact PerfectProperty | PerfectProperty",
    description:
      "Contact PerfectProperty to report a listing issue, request county coverage, or ask about membership and team access.",
    url: "/contact",
    siteName: "PerfectProperty",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Contact PerfectProperty | PerfectProperty",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Contact PerfectProperty | PerfectProperty",
    description:
      "Contact PerfectProperty to report a listing issue, request county coverage, or ask about membership and team access.",
    images: ["/og-image.png"],
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
