"use client";

import Link from "next/link";
import { Logo } from "./logo";
import { ArrowRight } from "lucide-react";

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.34a1.65 1.65 0 0 0-1.66 1.66 1.66 1.66 0 0 0 1.66 1.66 1.65 1.65 0 0 0 1.65-1.66 1.65 1.65 0 0 0-1.65-1.66" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Deal Stacks", href: "#" },
      { label: "Shadow Mode", href: "#" },
      { label: "Prophecy", href: "#" },
      { label: "Monitoring", href: "#" },
      { label: "Accuracy", href: "#" },
      { label: "Integrations", href: "#" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Acquisitions", href: "#" },
      { label: "Disposition", href: "#" },
      { label: "Underwriting", href: "#" },
      { label: "Capital", href: "#" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "#" },
      { label: "Knowledge Base", href: "#" },
      { label: "Guides", href: "#" },
      { label: "Changelog", href: "#" },
      { label: "Accuracy Report", href: "#" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Customers", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative isolate border-t border-[#E5E7EB] bg-white overflow-hidden">
      {/* Giant watermark behind footer content — subtle luxury */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 select-none text-center font-black uppercase leading-none tracking-[-0.04em] text-[#111827] opacity-[0.035]"
        style={{
          fontSize: "clamp(80px, 18vw, 220px)",
          transform: "translateY(15%)",
        }}
      >
        PERFECTPROPERTY
      </div>

      {/* Newsletter band */}
      <div className="border-b border-[#F3F4F6] bg-[#F5F6F7]">
        <div className="mx-auto flex max-w-[1080px] flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center lg:px-8">
          <div>
            <p className="text-[15px] font-semibold text-[#111827]">
              Subscribe to the PerfectProperty accuracy report
            </p>
            <p className="text-[13px] text-[#6B7280]">
              Monthly updates on valuation spreads, model releases, and new scrapers.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              alert("Thank you for subscribing!");
            }}
            className="flex w-full max-w-[360px] items-center gap-2"
          >
            <input
              type="email"
              required
              placeholder="you@company.com"
              className="h-10 flex-1 rounded-[12px] border border-[#D1D5DB] bg-white px-3.5 text-[14px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/20"
            />
            <button
              type="submit"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-[12px] bg-[#0F172A] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1E293B]"
              style={{ boxShadow: "0 0 0 1px rgb(15,23,42)" }}
            >
              Subscribe
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>

      {/* Link columns */}
      <div className="mx-auto max-w-[1080px] px-5 py-14 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center" aria-label="PerfectProperty home">
              <Logo className="text-[16px]" />
            </Link>
            <div className="mt-4 flex items-center gap-3">
              {[TwitterIcon, LinkedinIcon, GithubIcon].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#6B7280] transition-colors hover:bg-[#F5F6F7] hover:text-[#111827]"
                  aria-label="Social link"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF]">
                {col.title}
              </p>
              <ul className="mt-3 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-[14px] font-medium text-[#4B5563] transition-colors hover:text-[#111827]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Legal row */}
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-[#F3F4F6] pt-6 sm:flex-row sm:items-center">
          <p className="text-[13px] text-[#9CA3AF]">
            &copy; {new Date().getFullYear()} PerfectProperty. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="#" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827]">
              Terms
            </Link>
            <Link href="#" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827]">
              Privacy
            </Link>
            <Link href="#" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827]">
              Security
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom padding to account for the absolute wordmark behind */}
      <div className="relative z-10 h-8" />
    </footer>
  );
}
