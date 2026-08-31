"use client";

import { GsapReveal } from "./gsap-reveal";

export function Testimonial() {
  return (
    <section className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[900px] text-center">
          <p
            className="font-serif-arcade text-[26px] leading-[1.35] text-[#111827] sm:text-[32px] lg:text-[36px]"
            style={{ fontStyle: "italic", fontWeight: 400 }}
          >
            &ldquo;PerfectProperty&rsquo;s special sauce: the speed to find deals
            before they hit the MLS. We closed three off-market parcels last month
            that our competitors never even saw.&rdquo;
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F172A]/10 text-[14px] font-bold text-[#0F172A]">
              JM
            </div>
            <div className="text-left">
              <p className="text-[15px] font-semibold text-[#111827]">Jake Martinez</p>
              <p className="text-[13px] text-[#6B7280]">
                Acquisitions Lead, BlueLine Capital
              </p>
            </div>
          </div>
        </GsapReveal>
      </div>
    </section>
  );
}
