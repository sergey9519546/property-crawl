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
            Every sale starts with a public notice. Every bid should start with the facts.
          </p>
        </GsapReveal>
      </div>
    </section>
  );
}
