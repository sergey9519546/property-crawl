"use client";

import * as React from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { ArrowLeft, Send, CheckCircle2, AlertCircle, Loader2, Mail, Building, User, MessageSquare } from "lucide-react";

export default function ContactPage() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "submitting" | "success" | "error">("idle");
  const [responseMsg, setResponseMsg] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;

    setStatus("submitting");
    setResponseMsg("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim() || undefined,
          message: message.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("success");
        setResponseMsg(data.message || "Message received.");
        setName("");
        setEmail("");
        setCompany("");
        setMessage("");
      } else {
        setStatus("error");
        setResponseMsg(data.error || "We couldn't send your message. Please try again.");
      }
    } catch {
      setStatus("error");
      setResponseMsg("Connection problem. Please try again in a moment.");
    }
  }

  return (
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink">
      <SiteHeader />

      <section className="px-5 pt-40 pb-10 sm:pt-48 sm:pb-12">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Back to PerfectProperty
          </Link>
          <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-2">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signature ring-1 ring-ink/20" />
            Get in touch
          </p>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
            Contact PerfectProperty
          </h1>
          <p className="mt-5 max-w-[620px] text-pretty text-lg leading-8 text-ink-2">
            Tell us about a listing that looks wrong, a county you want added, a question about membership, or a team
            that wants to use PerfectProperty. Your message is saved and read. We can&apos;t promise a reply time.
          </p>
        </div>
      </section>

      <section className="px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-3xl">
      <div>
        {status === "success" ? (
          <div className="rounded-3xl border border-go/30 bg-go-wash p-8 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-go-fill/20 text-go">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-go">Message received</h2>
            <p className="text-sm text-ink-2 max-w-md mx-auto">{responseMsg}</p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="rounded-xl bg-go px-5 py-2.5 text-sm font-semibold text-white hover:bg-go/90 transition"
              >
                Send another message
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-line bg-card p-6 sm:p-8 shadow-sm">
            {status === "error" && (
              <div className="flex items-center gap-2 rounded-xl border border-catch/30 bg-catch-wash p-4 text-xs font-medium text-catch-ink">
                <AlertCircle className="h-4 w-4 shrink-0 text-catch-ink" />
                <span>{responseMsg}</span>
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="contact-name" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                  Your name <span className="text-catch-ink">*</span>
                </label>
                <div className="relative mt-2">
                  <User className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-3" />
                  <input
                    id="contact-name"
                    type="text"
                    required
                    maxLength={200}
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-line-strongpl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="contact-email" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                  Your email <span className="text-catch-ink">*</span>
                </label>
                <div className="relative mt-2">
                  <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-3" />
                  <input
                    id="contact-email"
                    type="email"
                    required
                    maxLength={320}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-line-strongpl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="contact-company" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                Company (optional)
              </label>
              <div className="relative mt-2">
                <Building className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-3" />
                <input
                  id="contact-company"
                  type="text"
                  maxLength={200}
                  placeholder="Your company or team"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full rounded-xl border border-line-strongpl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="contact-message" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                Your message <span className="text-catch-ink">*</span>
              </label>
              <div className="relative mt-2">
                <textarea
                  id="contact-message"
                  required
                  rows={5}
                  maxLength={5000}
                  placeholder="Tell us what you need: a county, a listing, or a question about membership."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-xl border border-line-strongp-4 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
              <p className="mt-1 text-right text-[11px] text-ink-3">
                {message.length} / 5000 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={status === "submitting"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3.5 text-sm font-semibold text-white shadow hover:bg-ink-2 disabled:opacity-50 transition"
            >
              {status === "submitting" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send message
                </>
              )}
            </button>
          </form>
        )}
      </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
