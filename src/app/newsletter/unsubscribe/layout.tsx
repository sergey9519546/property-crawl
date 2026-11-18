import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.unsubscribeTitle || "Unsubscribe | PerfectProperty",
    description: t.unsubscribeDesc,
    robots: { index: false },
  };
}

export default function UnsubscribeLayout({ children }: { children: ReactNode }) {
  return children;
}
