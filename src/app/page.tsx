import React from "react";
import { GrainOverlay } from "@/components/site/grain-overlay";
import { BottomBlur } from "@/components/site/bottom-blur";
import { SiteHeader } from "@/components/site/site-header";
import { Hero } from "@/components/site/hero";
import { AuroraDivider } from "@/components/site/aurora-divider";
import { SocialProof } from "@/components/site/social-proof";
import { Storyteller } from "@/components/site/storyteller";
import { InteractiveTerminal } from "@/components/terminal/interactive-terminal";
import { AiComparison } from "@/components/site/ai-comparison";
import { Testimonial } from "@/components/site/testimonial";
import { AiKnows } from "@/components/site/ai-knows";
import { FastestWay } from "@/components/site/fastest-way";
import { Gtm } from "@/components/site/gtm";
import { Integrations } from "@/components/site/integrations";
import { CaseStudies } from "@/components/site/case-studies";
import { FinalCta } from "@/components/site/final-cta";
import { SiteFooter } from "@/components/site/site-footer";

export default function PerfectPropertyPage() {
  return (
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-[#F5F6F7] text-[#111827]">
      {/* Global Grain Overlay */}
      <GrainOverlay />

      {/* Floating Two-Layer Capsule Header */}
      <SiteHeader />

      {/* Hero with Unicorn Studio Shader */}
      <Hero />

      {/* Rotating Aurora Dividers */}
      <AuroraDivider index={0} />
      <SocialProof />

      <AuroraDivider index={1} />
      <Storyteller />

      {/* Live Interactive Property Triage Terminal */}
      <AuroraDivider index={2} />
      <InteractiveTerminal />

      <AuroraDivider index={3} />
      <AiComparison />

      <AuroraDivider index={4} />
      <Testimonial />

      <AuroraDivider index={0} />
      <AiKnows />

      <AuroraDivider index={1} />
      <FastestWay />

      <AuroraDivider index={2} />
      <Gtm />

      <AuroraDivider index={3} />
      <Integrations />

      <AuroraDivider index={4} />
      <CaseStudies />

      <AuroraDivider index={0} />
      <FinalCta />

      {/* Footer */}
      <SiteFooter />

      {/* Bottom Progressive Backdrop Blur */}
      <BottomBlur />
    </main>
  );
}
