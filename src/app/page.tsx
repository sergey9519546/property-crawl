import React from "react";
import { GrainOverlay } from "@/components/site/grain-overlay";
import { BottomBlur } from "@/components/site/bottom-blur";
import { SiteHeader } from "@/components/site/site-header";
import { Hero } from "@/components/site/hero";
import { AuroraDivider } from "@/components/site/aurora-divider";
import { SocialProof } from "@/components/site/social-proof";
import { CatchReveal } from "@/components/site/catch-reveal";
import { Storyteller } from "@/components/site/storyteller";
import { SectionHeading } from "@/components/site/section-heading";
import { InteractiveTerminal } from "@/components/terminal/interactive-terminal";
import { DataModeBanner } from "@/components/site/data-mode-banner";
import { SecondLookShowcase } from "@/components/site/second-look-showcase";
import { AiComparison } from "@/components/site/ai-comparison";
import { Faq } from "@/components/site/faq";
import { FinalCta } from "@/components/site/final-cta";
import { SiteFooter } from "@/components/site/site-footer";

/**
 * The page reads as one story:
 *   promise (hero) -> proof it's real (sources, live counts) -> the signature
 *   (the catch, on a real listing) -> how to use it (four steps) -> try it
 *   (live search) -> why members pay (price drops, pricing) -> doubts (FAQ) -> go.
 */
export default function PerfectPropertyPage() {
  return (
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink">
      <GrainOverlay />
      <SiteHeader />

      <Hero />
      <SocialProof />

      <AuroraDivider index={0} />
      <CatchReveal />

      <AuroraDivider index={1} />
      <Storyteller />

      <AuroraDivider index={2} />
      <section id="live-search" className="scroll-mt-24 px-5 pt-20 pb-4 lg:px-8">
        <SectionHeading eyebrow="Try it" title="Search every listing we have.">
          Filter by state, sale type and price. Open any listing to see its catch.
        </SectionHeading>
      </section>
      {/* The honesty banner sits directly above the feed. A visitor meeting deals
          here for the first time must be told if part of the inventory is past
          its source's refresh cadence. */}
      <DataModeBanner />
      <InteractiveTerminal />

      <AuroraDivider index={3} />
      <SecondLookShowcase />

      <AiComparison />

      <AuroraDivider index={4} />
      <Faq />

      <FinalCta />
      <SiteFooter />
      <BottomBlur />
    </main>
  );
}
