import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { AnyAddressUnderwriter } from "@/components/workspace/any-address-underwriter";
import { getRequestLocale } from "@/lib/i18n/server";
import { getMessages } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = getMessages(locale);
  return {
    title: m.meta.underwriteTitle,
    description: m.meta.underwriteDescription,
  };
}

export default function UnderwritePage() {
  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="outline-none">
        <AnyAddressUnderwriter />
      </main>
    </WorkspaceShell>
  );
}
