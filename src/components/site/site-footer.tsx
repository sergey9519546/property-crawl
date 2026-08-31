"use client";

import * as React from "react";
import Link from "next/link";
import { Logo } from "./logo";
import { ArrowRight } from "lucide-react";

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
      { label: "Deal Stacks", href: "#live-feed" },
      { label: "Shadow Mode", href: "#product" },
      { label: "Prophecy", href: "#product" },
      { label: "Monitoring", href: "#live-feed" },
      { label: "Accuracy", href: "#proof" },
      { label: "Integrations", href: "#integrations" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Acquisitions", href: "#solutions" },
      { label: "Disposition", href: "#solutions" },
      { label: "Underwriting", href: "#solutions" },
      { label: "Capital", href: "#solutions" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/resources#blog" },
      { label: "Knowledge Base", href: "/resources#knowledge-base" },
      { label: "Guides", href: "/resources#guides" },
      { label: "Changelog", href: "/resources#changelog" },
      { label: "Accuracy Report", href: "#proof" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Customers", href: "#customers" },
      { label: "Careers", href: "/contact#careers" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export function SiteFooter() {
  const [email, setEmail] = React.useState("");
  const [newsletterStatus, setNewsletterStatus] = React.useState("");

  const handleNewsletterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    window.localStorage.setItem("perfectproperty:newsletter-preview", normalizedEmail);
    setNewsletterStatus(
      "Saved on this device. Email delivery will be connected before launch.",
    );
  };

  return (
    <footer id="resources" className="relative isolate overflow-hidden bg-[#EEF2F7]">
      <div id="contact" className="bg-[#E7EDF5]">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-6 py-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)] lg:items-center lg:gap-20 lg:py-16">
          <div className="max-w-[600px]">
            <p className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#111827] sm:text-[28px]">
              Subscribe to the PerfectProperty accuracy report
            </p>
            <p className="mt-2 max-w-[520px] text-[15px] leading-6 text-[#5B6472]">
              Monthly updates on valuation spreads, model releases, and new scrapers.
            </p>
          </div>
          <form
            onSubmit={handleNewsletterSubmit}
            className="w-full"
          >
            <label htmlFor="footer-email" className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#697386]">
              Work email
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="footer-email"
                type="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setNewsletterStatus("");
                }}
                aria-describedby="newsletter-status"
                placeholder="you@company.com"
                className="h-12 min-w-0 flex-1 rounded-[12px] border border-[#CBD5E1] bg-white px-4 text-[14px] text-[#111827] shadow-sm placeholder:text-[#9CA3AF] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0F172A]/20"
              />
              <button
                type="submit"
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-[12px] bg-[#0F172A] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1E293B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
              >
                Subscribe
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
              </button>
            </div>
            <p id="newsletter-status" aria-live="polite" className="mt-2 min-h-5 text-[12px] font-medium text-[#526071]">
              {newsletterStatus}
            </p>
          </form>
        </div>
      </div>

      {/* Link columns */}
      <div className="mx-auto max-w-[1240px] px-6 pb-10 pt-16 sm:px-8 lg:pb-12 lg:pt-20">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-4 lg:grid-cols-[1.6fr_repeat(4,1fr)] lg:gap-x-12">
          {/* Brand column */}
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center" aria-label="PerfectProperty home">
              <Logo className="text-[16px]" />
            </Link>
            <p className="mt-4 max-w-[230px] text-[14px] leading-6 text-[#647084]">
              Find, compare, and underwrite distressed property opportunities in one focused workspace.
            </p>
            <div className="mt-5 flex items-center gap-3">
              {[
                {
                  label: "PerfectProperty on GitHub",
                  href: "https://github.com/sergey9519546/property-crawl",
                  Icon: GithubIcon,
                },
              ].map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#6B7280] transition-colors hover:bg-[#F5F6F7] hover:text-[#111827]"
                  aria-label={label}
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
        <div className="mt-16 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-[13px] text-[#9CA3AF]">
            &copy; {new Date().getFullYear()} PerfectProperty. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827]">
              Terms
            </Link>
            <Link href="/privacy" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827]">
              Privacy
            </Link>
            <Link href="/security" className="text-[13px] font-medium text-[#6B7280] hover:text-[#111827]">
              Security
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
