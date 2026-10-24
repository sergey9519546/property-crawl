"use client";

import { GsapReveal } from "./gsap-reveal";

// Plain-text list of the public source types we read. No logos: these are
// agencies and sale types, not partners.
const SOURCES: string[] = [
  "HUD homes",
  "Fannie Mae and Freddie Mac bank-owned homes",
  "Sheriff sales",
  "Trustee sales",
  "County tax sales",
  "IRS and Treasury seizures",
  "USDA and VA homes",
  "GSA and US Marshals sales",
  "Land banks",
];

export function SocialProof() {
  return (
    <section id="proof" className="pt-12 pb-16">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="text-center">
          <h2 className="text-[20px] font-semibold text-[#111827]">Where listings come from</h2>
          <p className="mx-auto mt-3 max-w-[720px] text-[15px] leading-6 text-[#4B5563]">
            We read public sale notices and government listings, then put them in one place.
          </p>
          <ul className="mx-auto mt-6 flex max-w-[860px] flex-wrap justify-center gap-2">
            {SOURCES.map((name) => (
              <li
                key={name}
                className="rounded-full border border-[rgba(17,24,39,0.10)] bg-white px-3 py-1.5 text-[14px] font-medium text-[#111827]"
              >
                {name}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-5 max-w-[720px] text-[13px] leading-5 text-[#5B6472]">
            Coverage varies by county. These names are for reference only, not endorsements.
          </p>
        </GsapReveal>
      </div>
    </section>
  );
}
