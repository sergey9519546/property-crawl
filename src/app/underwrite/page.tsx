import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { AnyAddressUnderwriter } from "@/components/workspace/any-address-underwriter";

export const metadata: Metadata = {
  title: "Off-Platform Underwriter | PerfectProperty",
  description:
    "Underwrite any distressed US address or courthouse notice with HUD SAFMR rent ceilings, county assessor ratios, statutory title risk, and verbatim notice citations.",
};

export default function UnderwritePage() {
  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="outline-none">
        <AnyAddressUnderwriter />
      </main>
    </WorkspaceShell>
  );
}
