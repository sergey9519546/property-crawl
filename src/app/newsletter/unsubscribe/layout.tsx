import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Unsubscribe | PerfectProperty",
  description: "Remove an email address from the PerfectProperty coverage notes newsletter.",
  robots: { index: false },
};

export default function UnsubscribeLayout({ children }: { children: ReactNode }) {
  return children;
}
