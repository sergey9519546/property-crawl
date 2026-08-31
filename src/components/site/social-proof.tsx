"use client";

import { GsapReveal } from "./gsap-reveal";

// Heterogeneous logo marks — different visual treatments, not uniform text
const LOGOS: { name: string; style: "bold" | "mono" | "light" | "boxed" }[] = [
  { name: "Scrapy", style: "bold" },
  { name: "Zyte", style: "mono" },
  { name: "Realie", style: "light" },
  { name: "Attom", style: "boxed" },
  { name: "PropStream", style: "bold" },
  { name: "BatchLeads", style: "mono" },
  { name: "Census", style: "light" },
  { name: "Zillow", style: "boxed" },
  { name: "Redfin", style: "bold" },
  { name: "FHFA", style: "mono" },
];

export function SocialProof() {
  return (
    <section className="pt-12 pb-16">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="text-center">
          {/* Arcade: tiny caption + "30k companies" in a small bordered chip */}
          <p className="text-[16px] font-medium text-[#4B5563]">
            More than{" "}
            <span className="inline-flex items-center rounded-md border border-[rgba(17,24,39,0.10)] bg-white px-1.5 py-0.5 text-[14px] font-semibold text-[#111827]">
              2k flippers
            </span>{" "}
            choose PerfectProperty to find better deals
          </p>
        </GsapReveal>
      </div>
      {/* Logo marquee with edge-fade mask */}
      <div
        className="mt-8 overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
        }}
      >
        <div className="logo-marquee-track gap-12">
          {[...LOGOS, ...LOGOS].map((logo, i) => (
            <LogoMark key={i} name={logo.name} style={logo.style} />
          ))}
        </div>
      </div>
    </section>
  );
}

function LogoMark({ name, style }: { name: string; style: string }) {
  // Heterogeneous visual treatment — different weights/sizes, not uniform text
  const base = "flex items-center justify-center whitespace-nowrap opacity-50 grayscale transition-all duration-200 hover:opacity-100 hover:grayscale-0";
  if (style === "bold") {
    return <span className={`${base} text-[18px] font-extrabold tracking-tight text-[#111827]`}>{name}</span>;
  }
  if (style === "mono") {
    return <span className={`${base} text-[15px] font-mono-arcade font-medium text-[#374151]`}>{name}</span>;
  }
  if (style === "light") {
    return <span className={`${base} text-[17px] font-light tracking-wide text-[#4B5563]`}>{name}</span>;
  }
  // boxed
  return (
    <span className={`${base} text-[13px] font-bold tracking-tight text-[#111827]`}>
      <span className="rounded border border-[#9CA3AF] px-1.5 py-0.5">{name}</span>
    </span>
  );
}
