"use client";

import * as React from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { ArrowLeft, Send, CheckCircle2, AlertCircle, Loader2, Mail, Building, User } from "lucide-react";

export default function ContactPage() {
  const { locale, messages: m, format } = useLocale();
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
        setResponseMsg(locale === "en" && data.message ? data.message : m.contact.savedNote);
        setName("");
        setEmail("");
        setCompany("");
        setMessage("");
      } else {
        setStatus("error");
        setResponseMsg(locale === "en" && data.error ? data.error : m.contact.errFallback);
      }
    } catch {
      setStatus("error");
      setResponseMsg(m.contact.errFallback);
    }
  }

  return (
    <div className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="px-5 pt-28 pb-8 sm:pt-32 sm:pb-10">
          <div className="mx-auto max-w-3xl">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" /> {m.infoPages.backToSite}
            </Link>
            <div className="mt-8">
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-label font-bold uppercase tracking-wider text-ink-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signature ring-1 ring-ink/20" />
                {m.contact.eyebrow}
              </p>
            </div>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
              {m.contact.title}
            </h1>
            <p className="mt-5 max-w-[620px] text-pretty text-lg leading-8 text-ink-2">
              {`${m.contact.lead} ${m.contact.savedNote}`}
            </p>
          </div>
        </section>

        <section className="px-5 pb-12 sm:pb-16">
          <div className="mx-auto max-w-3xl">
            <div>
              {status === "success" ? (
                <div className="rounded-card border border-go/30 bg-go-wash p-8 text-center space-y-4 shadow-card">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-go-fill/20 text-go">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h2 className="text-xl font-bold text-go">{m.contact.successTitle}</h2>
                  <p className="text-sm text-ink-2 max-w-md mx-auto">{responseMsg}</p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setStatus("idle")}
                      className="rounded-control bg-go px-5 py-2.5 text-sm font-semibold text-white hover:bg-go/90 transition"
                    >
                      {m.contact.sendAnother}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6 rounded-card border border-line bg-card p-6 sm:p-8 shadow-card">
                  {status === "error" && (
                    <div className="flex items-center gap-2 rounded-control border border-catch/30 bg-catch-wash p-4 text-xs font-medium text-catch-ink">
                      <AlertCircle className="h-4 w-4 shrink-0 text-catch-ink" />
                      <span>{responseMsg}</span>
                    </div>
                  )}

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                        {m.contact.nameLabel} <span className="text-catch-ink">*</span>
                      </label>
                      <div className="relative mt-2">
                        <User className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-3" />
                        <input
                          id="contact-name"
                          type="text"
                          required
                          maxLength={200}
                          placeholder={m.contact.namePlaceholder}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full rounded-control border border-line-strong pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="contact-email" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                        {m.contact.emailLabel} <span className="text-catch-ink">*</span>
                      </label>
                      <div className="relative mt-2">
                        <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-3" />
                        <input
                          id="contact-email"
                          type="email"
                          required
                          maxLength={320}
                          placeholder={m.contact.emailPlaceholder}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full rounded-control border border-line-strong pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-company" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                      {m.contact.companyLabel}
                    </label>
                    <div className="relative mt-2">
                      <Building className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-3" />
                      <input
                        id="contact-company"
                        type="text"
                        maxLength={200}
                        placeholder={m.contact.companyPlaceholder}
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        className="w-full rounded-control border border-line-strong pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-message" className="block text-xs font-bold uppercase tracking-wide text-ink-2">
                      {m.contact.messageLabel} <span className="text-catch-ink">*</span>
                    </label>
                    <div className="relative mt-2">
                      <textarea
                        id="contact-message"
                        required
                        rows={5}
                        maxLength={5000}
                        placeholder={m.contact.messagePlaceholder}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="w-full rounded-control border border-line-strong p-4 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      />
                    </div>
                    <p className="mt-1 text-right text-label text-ink-3">
                      {format(m.contact.charCount, { count: message.length })}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={status === "submitting"}
                    className="flex w-full items-center justify-center gap-2 rounded-control bg-ink px-6 py-3.5 text-sm font-semibold text-white shadow-card hover:bg-ink-2 disabled:opacity-50 transition"
                  >
                    {status === "submitting" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> {m.contact.sendingBtn}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" /> {m.contact.sendBtn}
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
