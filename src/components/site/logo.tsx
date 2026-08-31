import * as React from "react";

/**
 * PerfectProperty logo — house icon (black roof + gold windows) + wordmark.
 * Uses the uploaded logo image as the icon.
 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <img
      src="/logo-icon.png"
      alt="PerfectProperty"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-black uppercase tracking-[0.01em] text-[#111827] ${className}`}
    >
      PERFECTPROPERTY
    </span>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 font-black uppercase ${className}`}>
      <LogoMark className="h-8 w-8 shrink-0" />
      <Wordmark />
    </span>
  );
}
